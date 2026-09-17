#!/usr/bin/env python3
"""
sync_opencode_nodes.py — OpenCode 2 Multi-Node Settings Aligner

Establishes the WSL2 development laptop as the SINGLE SOURCE OF TRUTH for:
  - Configuration (`config.json`, `schema.json`, `cli.json`)
  - Subagents (`agents/`)
  - Slash Commands (`command/`)
  - Skills (`skills/` and `~/.agents/skills/`)
  - Native Plugins (`plugins/`)

When you test, validate, or add models in WSL2, running this script idempotently
pushes and aligns all settings to:
  1. macOS Mini (`yapilymm` @ 10.32.34.109)
  2. VPS Server (`vps466a`  @ 10.32.34.243)

Path translations (e.g. /home/yapilwsl -> /Users/yapilymm or /home/vps466a)
are automatically computed and preserved per node.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

# ─────────────────────────────────────────────────────────────────────────────
# NODE DEFINITIONS
# ─────────────────────────────────────────────────────────────────────────────
LOCAL_SOURCE = {
    "name": "WSL2 Laptop (Source of Truth)",
    "home": Path.home(),
    "opencode2_dir": Path.home() / ".config" / "opencode2",
    "skills_dir": Path.home() / ".agents" / "skills",
}

REMOTE_TARGETS: Dict[str, Dict[str, Any]] = {
    "macos": {
        "name": "Mac Mini (yapilymm)",
        "ssh_host": "yapilymm",
        "home": "/Users/yapilymm",
        "opencode2_dir": "/Users/yapilymm/.config/opencode2",
        "legacy_link": "/Users/yapilymm/.config/opencode",
        "skills_dir": "/Users/yapilymm/.agents/skills",
    },
    "vps": {
        "name": "VPS Gateway (vps466a)",
        "ssh_host": "vps466a",
        "home": "/home/vps466a",
        "opencode2_dir": "/home/vps466a/.config/opencode2",
        "legacy_link": "/home/vps466a/.config/opencode",
        "skills_dir": "/home/vps466a/.agents/skills",
    },
}

SSH_BASE_OPTS = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "-o", "IdentitiesOnly=yes",
]


def log(msg: str, level: str = "INFO") -> None:
    badge = {
        "INFO": "\033[94m[INFO]\033[0m",
        "OK": "\033[92m[OK]\033[0m",
        "WARN": "\033[93m[WARN]\033[0m",
        "ERR": "\033[91m[ERR]\033[0m",
    }.get(level, "[LOG]")
    print(f"{badge} {msg}")


def run_cmd(cmd: List[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def translate_paths(obj: Any, src_home: str, dst_home: str) -> Any:
    """Recursively replaces src_home paths with dst_home paths in config dictionaries/lists."""
    if isinstance(obj, str):
        return obj.replace(src_home, dst_home)
    elif isinstance(obj, list):
        return [translate_paths(item, src_home, dst_home) for item in obj]
    elif isinstance(obj, dict):
        return {k: translate_paths(v, src_home, dst_home) for k, v in obj.items()}
    return obj


def verify_source_integrity() -> None:
    src_dir = LOCAL_SOURCE["opencode2_dir"]
    config_file = src_dir / "config.json"
    if not config_file.is_file():
        log(f"Source configuration file not found at: {config_file}", "ERR")
        sys.exit(1)

    try:
        with open(config_file, "r", encoding="utf-8") as f:
            json.load(f)
        log("Source config.json syntax verified valid JSON.", "OK")
    except Exception as e:
        log(f"Failed to parse source config.json: {e}", "ERR")
        sys.exit(1)


def sync_node(target_key: str, node: Dict[str, Any], dry_run: bool = False) -> bool:
    name = node["name"]
    host = node["ssh_host"]
    dst_home = node["home"]
    dst_opencode2 = node["opencode2_dir"]
    dst_skills = node["skills_dir"]
    src_home_str = str(LOCAL_SOURCE["home"])
    src_opencode2 = LOCAL_SOURCE["opencode2_dir"]
    src_skills = LOCAL_SOURCE["skills_dir"]

    log(f"Checking connectivity to {name} ({host})...")
    test_conn = subprocess.run(["ssh"] + SSH_BASE_OPTS + [host, "echo ok"], capture_output=True, text=True)
    if test_conn.returncode != 0:
        log(f"Cannot reach {host} over SSH. Skipping node.", "WARN")
        return False

    log(f"Connected to {name}. Preparing target directories...", "OK")
    if not dry_run:
        setup_script = f"mkdir -p {dst_opencode2} {dst_skills}"
        subprocess.run(["ssh"] + SSH_BASE_OPTS + [host, setup_script], check=True)

    # 1. Translate and push config.json
    log(f"Generating translated config.json for {name} ({src_home_str} -> {dst_home})...")
    with open(src_opencode2 / "config.json", "r", encoding="utf-8") as f:
        src_cfg = json.load(f)

    dst_cfg = translate_paths(src_cfg, src_home_str, dst_home)
    tmp_cfg_path = Path(f"/tmp/opencode_cfg_{target_key}.json")
    with open(tmp_cfg_path, "w", encoding="utf-8") as f:
        json.dump(dst_cfg, f, indent=2)

    if not dry_run:
        scp_cmd = ["scp"] + SSH_BASE_OPTS + [str(tmp_cfg_path), f"{host}:{dst_opencode2}/config.json"]
        run_cmd(scp_cmd)
        tmp_cfg_path.unlink(missing_ok=True)
        log(f"config.json synchronized to {host}:{dst_opencode2}/config.json", "OK")

    # 2. Sync schema.json and cli.json if present
    for fname in ["schema.json", "cli.json"]:
        src_file = src_opencode2 / fname
        if src_file.is_file():
            if not dry_run:
                scp_cmd = ["scp"] + SSH_BASE_OPTS + [str(src_file), f"{host}:{dst_opencode2}/{fname}"]
                run_cmd(scp_cmd)
                log(f"{fname} synchronized to {host}:{dst_opencode2}/{fname}", "OK")

    # 3. Sync directories via rsync: agents, command, plugins, skills
    rsync_base = [
        "rsync", "-avz", "--delete",
        "-e", f"ssh {' '.join(SSH_BASE_OPTS)}",
    ]

    for dname in ["agents", "command", "plugins", "skills", "tools"]:
        src_d = src_opencode2 / dname
        if src_d.is_dir():
            log(f"Synchronizing {dname}/ to {name}...")
            if not dry_run:
                cmd = rsync_base + [f"{str(src_d)}/", f"{host}:{dst_opencode2}/{dname}/"]
                run_cmd(cmd)

    # 4. Sync Global Skills (~/.agents/skills)
    if src_skills.is_dir():
        log(f"Synchronizing global ~/.agents/skills/ to {name}...")
        if not dry_run:
            cmd = rsync_base + [f"{str(src_skills)}/", f"{host}:{dst_skills}/"]
            run_cmd(cmd)

    # 5. Ensure symlinks and hygiene on remote
    if not dry_run:
        remote_hygiene = f"""
        # Symlink config.json -> opencode.json
        ln -sf {dst_opencode2}/config.json {dst_opencode2}/opencode.json 2>/dev/null || true
        # Symlink ~/.config/opencode -> ~/.config/opencode2 for backwards compatibility
        if [ ! -d "{node['legacy_link']}" ] || [ -L "{node['legacy_link']}" ]; then
            ln -sfn {dst_opencode2} {node['legacy_link']} 2>/dev/null || true
        fi
        """
        subprocess.run(["ssh"] + SSH_BASE_OPTS + [host, remote_hygiene], check=True)
        log(f"Remote symlinks and hygiene verified on {name}.", "OK")

    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Synchronize OpenCode 2 settings from WSL2 to all cluster nodes.")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing files.")
    parser.add_argument("--node", choices=list(REMOTE_TARGETS.keys()) + ["all"], default="all",
                        help="Select a specific node to synchronize (default: all).")
    args = parser.parse_args()

    print("═══════════════════════════════════════════════════════════════════════════")
    print("      LiteRouter OpenCode 2 Multi-Node Settings Aligner")
    print("      Source of Truth: WSL2 Laptop (~/.config/opencode2)")
    print("═══════════════════════════════════════════════════════════════════════════")

    verify_source_integrity()

    targets = list(REMOTE_TARGETS.keys()) if args.node == "all" else [args.node]
    success_count = 0

    for target_key in targets:
        node = REMOTE_TARGETS[target_key]
        print(f"\n--- Aligning: {node['name']} ---")
        if sync_node(target_key, node, dry_run=args.dry_run):
            success_count += 1

    print("\n═══════════════════════════════════════════════════════════════════════════")
    print(f"Alignment complete: {success_count}/{len(targets)} nodes synchronized successfully.")
    print("═══════════════════════════════════════════════════════════════════════════")


if __name__ == "__main__":
    main()
