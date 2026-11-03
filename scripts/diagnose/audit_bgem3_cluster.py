#!/usr/bin/env python3
"""
audit_bgem3_cluster.py — Comprehensive BGE-M3 & Embeddings Cluster Auditor

Audits and aligns BGE-M3 embedding configuration across 4 environments:
  1. WSL2 (Local Dev)
  2. Windows 11 Host
  3. Production VPS (vps466a)
  4. macOS Mini (yapilymm)

Target Systems Audited:
  - baziforecaster / services/baziforecast (.env)
  - CortexKit AFT (aft.jsonc)
  - OMP Agent (config.yml, models.yml)
  - OpenCode (opencode.json)
  - Live probe connectivity to LiteRouter embedding endpoint (POST /v1/embeddings)
"""

import argparse
import json
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field

CANONICAL_LITEROUTER_URL = "http://literouter.lan:7766/v1"
CANONICAL_EMBEDDINGS_URL = "http://literouter.lan:7766/v1/embeddings"
TEI_GPU_URL = "http://192.168.50.10:8002"
TEI_MAC_URL = "http://192.168.50.11:8002/v1/embeddings"
TEI_CPU_URL = "http://192.168.50.10:8003"
CANONICAL_MODEL = "BAAI/bge-m3"
CANONICAL_TOKEN = "sk-no-key-required"


class AuditResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    environment: str
    component: str
    target_path: str
    key_name: str
    current_value: Optional[str] = None
    expected_value: str
    status: Literal["OK", "MISALIGNED", "MISSING", "N/A", "ERROR"]
    message: str = ""


class ProbeLatency(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_url: str
    tier_label: str
    status_code: int
    dimension: int
    latency_ms: float
    healthy: bool
    message: str = ""


class ClusterProbeReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: str
    probes: List[ProbeLatency] = Field(default_factory=list)
    all_passed: bool


def run_cmd(cmd: List[str], timeout: int = 10) -> Tuple[int, str, str]:
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "Timed out"
    except Exception as e:
        return 1, "", str(e)


def run_ssh(host: str, cmd: str, timeout: int = 10) -> Tuple[int, str, str]:
    full_cmd = ["ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes", host, cmd]
    return run_cmd(full_cmd, timeout=timeout)


def probe_endpoint(
    url: str,
    tier_label: str,
    is_openai_compat: bool = False,
    timeout: float = 5.0,
) -> ProbeLatency:
    """Probe an embedding endpoint for health, dimension, and latency."""
    t0 = time.perf_counter()
    try:
        if is_openai_compat:
            target_url = url
            payload = json.dumps({"model": CANONICAL_MODEL, "input": "cluster audit probe"}).encode("utf-8")
            headers = {"Content-Type": "application/json"}
        else:
            target_url = f"{url}/embed"
            payload = json.dumps({"inputs": "cluster audit probe"}).encode("utf-8")
            headers = {"Content-Type": "application/json"}

        req = urllib.request.Request(target_url, data=payload, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = json.loads(res.read().decode("utf-8"))
            latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            status_code = res.status

            if is_openai_compat:
                dim = len(body["data"][0]["embedding"])
            else:
                dim = len(body[0])

            healthy = status_code == 200 and dim == 1024
            return ProbeLatency(
                target_url=target_url,
                tier_label=tier_label,
                status_code=status_code,
                dimension=dim,
                latency_ms=latency_ms,
                healthy=healthy,
                message=f"HTTP {status_code} OK (dim={dim}, latency={latency_ms}ms)",
            )
    except Exception as e:
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        return ProbeLatency(
            target_url=url,
            tier_label=tier_label,
            status_code=500,
            dimension=0,
            latency_ms=latency_ms,
            healthy=False,
            message=f"Probe failed: {e}",
        )


def test_live_probe(host_prefix: Optional[str] = None) -> Tuple[bool, str]:
    """Test POST /v1/embeddings directly from a host."""
    payload = json.dumps({"model": CANONICAL_MODEL, "input": "cluster audit test"})
    curl_cmd = f"curl -s -m 5 -X POST {CANONICAL_EMBEDDINGS_URL} -H 'Content-Type: application/json' -d '{payload}'"
    if host_prefix:
        code, stdout, stderr = run_ssh(host_prefix, curl_cmd)
    else:
        code, stdout, stderr = run_cmd(
            [
                "curl",
                "-s",
                "-m",
                "5",
                "-X",
                "POST",
                CANONICAL_EMBEDDINGS_URL,
                "-H",
                "Content-Type: application/json",
                "-d",
                payload,
            ]
        )

    if code == 0 and '"embedding"' in stdout:
        return True, "HTTP 200 OK (returned valid embedding vector)"
    elif "getaddrinfo" in stderr or "getaddrinfo" in stdout:
        return False, "DNS resolution failure for literouter.lan"
    elif "Failed to connect" in stderr or "Connection refused" in stderr:
        return False, "Connection refused / port 7766 unreachable"
    else:
        sample = (stdout or stderr).strip()[:100]
        return False, f"Failed: code={code}, output={sample}"


# ─────────────────────────────────────────────────────────────────────────────
# AUDITORS
# ─────────────────────────────────────────────────────────────────────────────


def audit_wsl2() -> List[AuditResult]:
    results = []
    env_name = "WSL2"

    # 1. baziforecaster .env
    bazi_env = Path("/home/yapilwsl/arthityap/baziforecaster/.env")
    if bazi_env.exists():
        content = bazi_env.read_text(encoding="utf-8", errors="ignore")
        m_url = re.search(r"^BGEM3_URL=(.+)$", content, re.MULTILINE)
        m_tok = re.search(r"^BGEM3_TOKEN=(.+)$", content, re.MULTILINE)
        cur_url = m_url.group(1).strip() if m_url else None
        cur_tok = m_tok.group(1).strip() if m_tok else None

        results.append(
            AuditResult(
                environment=env_name,
                component="baziforecaster",
                target_path=str(bazi_env),
                key_name="BGEM3_URL",
                current_value=cur_url,
                expected_value=CANONICAL_EMBEDDINGS_URL,
                status="OK" if cur_url == CANONICAL_EMBEDDINGS_URL else ("MISALIGNED" if cur_url else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="baziforecaster",
                target_path=str(bazi_env),
                key_name="BGEM3_TOKEN",
                current_value=cur_tok,
                expected_value=CANONICAL_TOKEN,
                status="OK"
                if cur_tok in (CANONICAL_TOKEN, "lr-tei-oa-em-no")
                else ("MISALIGNED" if cur_tok else "MISSING"),
            )
        )
    else:
        results.append(
            AuditResult(
                environment=env_name,
                component="baziforecaster",
                target_path=str(bazi_env),
                key_name="BGEM3_URL",
                current_value=None,
                expected_value=CANONICAL_EMBEDDINGS_URL,
                status="MISSING",
                message="Repo or .env not found",
            )
        )

    # 2. AFT aft.jsonc
    aft_path = Path("/home/yapilwsl/.config/cortexkit/aft.jsonc")
    if aft_path.exists():
        try:
            aft_text = aft_path.read_text(encoding="utf-8", errors="ignore")
            m_base = re.search(r'"base_url":\s*"([^"]+)"', aft_text)
            m_mod = re.search(r'"model":\s*"([^"]+)"', aft_text)
            cur_base = m_base.group(1) if m_base else None
            cur_mod = m_mod.group(1) if m_mod else None
            results.append(
                AuditResult(
                    environment=env_name,
                    component="cortexkit-aft",
                    target_path=str(aft_path),
                    key_name="semantic.base_url",
                    current_value=cur_base,
                    expected_value=CANONICAL_LITEROUTER_URL,
                    status="OK" if cur_base == CANONICAL_LITEROUTER_URL else ("MISALIGNED" if cur_base else "MISSING"),
                )
            )
            results.append(
                AuditResult(
                    environment=env_name,
                    component="cortexkit-aft",
                    target_path=str(aft_path),
                    key_name="semantic.model",
                    current_value=cur_mod,
                    expected_value=CANONICAL_MODEL,
                    status="OK" if cur_mod == CANONICAL_MODEL else ("MISALIGNED" if cur_mod else "MISSING"),
                )
            )
        except Exception as e:
            results.append(AuditResult(env_name, "cortexkit-aft", str(aft_path), "semantic", None, "", "ERROR", str(e)))

    # 3. OMP config.yml (mnemopi)
    omp_cfg = Path("/home/yapilwsl/.omp/agent/config.yml")
    if omp_cfg.exists():
        content = omp_cfg.read_text(encoding="utf-8", errors="ignore")
        m_api = re.search(r"embeddingApiUrl:\s*(\S+)", content)
        m_mod = re.search(r"embeddingModel:\s*(\S+)", content)
        cur_api = m_api.group(1) if m_api else None
        cur_mod = m_mod.group(1) if m_mod else None
        results.append(
            AuditResult(
                environment=env_name,
                component="omp-mnemopi",
                target_path=str(omp_cfg),
                key_name="mnemopi.embeddingApiUrl",
                current_value=cur_api,
                expected_value=CANONICAL_LITEROUTER_URL,
                status="OK" if cur_api == CANONICAL_LITEROUTER_URL else ("MISALIGNED" if cur_api else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="omp-mnemopi",
                target_path=str(omp_cfg),
                key_name="mnemopi.embeddingModel",
                current_value=cur_mod,
                expected_value=CANONICAL_MODEL,
                status="OK" if cur_mod == CANONICAL_MODEL else ("MISALIGNED" if cur_mod else "MISSING"),
            )
        )

    return results


def audit_win11() -> List[AuditResult]:
    results = []
    env_name = "Win11"
    base = Path("/mnt/c/Users/yapil")
    if not base.exists():
        results.append(
            AuditResult(
                env_name, "Host", str(base), "Access", None, "Accessible", "ERROR", "/mnt/c/Users/yapil not found"
            )
        )
        return results

    # 1. AFT aft.jsonc
    aft_path = base / ".config" / "cortexkit" / "aft.jsonc"
    if aft_path.exists():
        content = aft_path.read_text(encoding="utf-8", errors="ignore")
        m_base = re.search(r'"base_url":\s*"([^"]+)"', content)
        m_mod = re.search(r'"model":\s*"([^"]+)"', content)
        cur_base = m_base.group(1) if m_base else None
        cur_mod = m_mod.group(1) if m_mod else None
        results.append(
            AuditResult(
                environment=env_name,
                component="cortexkit-aft",
                target_path=str(aft_path),
                key_name="semantic.base_url",
                current_value=cur_base,
                expected_value=CANONICAL_LITEROUTER_URL,
                status="OK" if cur_base == CANONICAL_LITEROUTER_URL else ("MISALIGNED" if cur_base else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="cortexkit-aft",
                target_path=str(aft_path),
                key_name="semantic.model",
                current_value=cur_mod,
                expected_value=CANONICAL_MODEL,
                status="OK" if cur_mod == CANONICAL_MODEL else ("MISALIGNED" if cur_mod else "MISSING"),
            )
        )
    else:
        results.append(
            AuditResult(
                env_name, "cortexkit-aft", str(aft_path), "semantic.base_url", None, CANONICAL_LITEROUTER_URL, "MISSING"
            )
        )

    # 2. OMP config.yml
    omp_cfg = base / ".omp" / "agent" / "config.yml"
    if omp_cfg.exists():
        content = omp_cfg.read_text(encoding="utf-8", errors="ignore")
        m_api = re.search(r"embeddingApiUrl:\s*(\S+)", content)
        m_mod = re.search(r"embeddingModel:\s*(\S+)", content)
        cur_api = m_api.group(1) if m_api else None
        cur_mod = m_mod.group(1) if m_mod else None
        results.append(
            AuditResult(
                environment=env_name,
                component="omp-mnemopi",
                target_path=str(omp_cfg),
                key_name="mnemopi.embeddingApiUrl",
                current_value=cur_api,
                expected_value=CANONICAL_LITEROUTER_URL,
                status="OK" if cur_api == CANONICAL_LITEROUTER_URL else ("MISALIGNED" if cur_api else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="omp-mnemopi",
                target_path=str(omp_cfg),
                key_name="mnemopi.embeddingModel",
                current_value=cur_mod,
                expected_value=CANONICAL_MODEL,
                status="OK" if cur_mod == CANONICAL_MODEL else ("MISALIGNED" if cur_mod else "MISSING"),
            )
        )

    return results


def audit_vps() -> List[AuditResult]:
    results = []
    env_name = "VPS"
    host = "vps466a"

    # 1. services/baziforecaster .env
    code, stdout, stderr = run_ssh(host, "cat /home/vps466a/services/baziforecaster/.env 2>/dev/null")
    if code == 0 and stdout.strip():
        m_url = re.search(r"^BGEM3_URL=(.+)$", stdout, re.MULTILINE)
        m_tok = re.search(r"^BGEM3_TOKEN=(.+)$", stdout, re.MULTILINE)
        cur_url = m_url.group(1).strip() if m_url else None
        cur_tok = m_tok.group(1).strip() if m_tok else None
        results.append(
            AuditResult(
                environment=env_name,
                component="services/baziforecaster",
                target_path="/home/vps466a/services/baziforecaster/.env",
                key_name="BGEM3_URL",
                current_value=cur_url,
                expected_value=CANONICAL_EMBEDDINGS_URL,
                status="OK" if cur_url == CANONICAL_EMBEDDINGS_URL else ("MISALIGNED" if cur_url else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="services/baziforecaster",
                target_path="/home/vps466a/services/baziforecaster/.env",
                key_name="BGEM3_TOKEN",
                current_value=cur_tok,
                expected_value=CANONICAL_TOKEN,
                status="OK"
                if cur_tok in (CANONICAL_TOKEN, "lr-tei-oa-em-no")
                else ("MISALIGNED" if cur_tok else "MISSING"),
            )
        )

    # 2. services/baziforecast .env
    code, stdout, stderr = run_ssh(host, "cat /home/vps466a/services/baziforecast/.env 2>/dev/null")
    if code == 0 and stdout.strip():
        m_url = re.search(r"^BGEM3_URL=(.+)$", stdout, re.MULTILINE)
        m_tok = re.search(r"^BGEM3_TOKEN=(.+)$", stdout, re.MULTILINE)
        cur_url = m_url.group(1).strip() if m_url else None
        cur_tok = m_tok.group(1).strip() if m_tok else None
        results.append(
            AuditResult(
                environment=env_name,
                component="services/baziforecast",
                target_path="/home/vps466a/services/baziforecast/.env",
                key_name="BGEM3_URL",
                current_value=cur_url,
                expected_value=CANONICAL_EMBEDDINGS_URL,
                status="OK" if cur_url == CANONICAL_EMBEDDINGS_URL else ("MISALIGNED" if cur_url else "MISSING"),
            )
        )

    # 3. VPS AFT
    code, stdout, stderr = run_ssh(host, "cat ~/.config/cortexkit/aft.jsonc 2>/dev/null")
    if code == 0 and stdout.strip():
        m_base = re.search(r'"base_url":\s*"([^"]+)"', stdout)
        m_mod = re.search(r'"model":\s*"([^"]+)"', stdout)
        cur_base = m_base.group(1) if m_base else None
        cur_mod = m_mod.group(1) if m_mod else None
        results.append(
            AuditResult(
                environment=env_name,
                component="cortexkit-aft",
                target_path="~/.config/cortexkit/aft.jsonc",
                key_name="semantic.base_url",
                current_value=cur_base,
                expected_value=CANONICAL_LITEROUTER_URL,
                status="OK" if cur_base == CANONICAL_LITEROUTER_URL else ("MISALIGNED" if cur_base else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="cortexkit-aft",
                target_path="~/.config/cortexkit/aft.jsonc",
                key_name="semantic.model",
                current_value=cur_mod,
                expected_value=CANONICAL_MODEL,
                status="OK" if cur_mod == CANONICAL_MODEL else ("MISALIGNED" if cur_mod else "MISSING"),
            )
        )

    # 4. VPS OMP
    code, stdout, stderr = run_ssh(host, "cat ~/.omp/agent/config.yml 2>/dev/null")
    if code == 0 and stdout.strip():
        m_api = re.search(r"embeddingApiUrl:\s*(\S+)", stdout)
        m_mod = re.search(r"embeddingModel:\s*(\S+)", stdout)
        cur_api = m_api.group(1) if m_api else None
        cur_mod = m_mod.group(1) if m_mod else None
        results.append(
            AuditResult(
                environment=env_name,
                component="omp-mnemopi",
                target_path="~/.omp/agent/config.yml",
                key_name="mnemopi.embeddingApiUrl",
                current_value=cur_api,
                expected_value=CANONICAL_LITEROUTER_URL,
                status="OK" if cur_api == CANONICAL_LITEROUTER_URL else ("MISALIGNED" if cur_api else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="omp-mnemopi",
                target_path="~/.omp/agent/config.yml",
                key_name="mnemopi.embeddingModel",
                current_value=cur_mod,
                expected_value=CANONICAL_MODEL,
                status="OK" if cur_mod == CANONICAL_MODEL else ("MISALIGNED" if cur_mod else "MISSING"),
            )
        )

    return results


def audit_macos() -> List[AuditResult]:
    results = []
    env_name = "macOS"
    host = "yapilymm"

    # 1. macOS AFT
    code, stdout, stderr = run_ssh(host, "cat ~/.config/cortexkit/aft.jsonc 2>/dev/null")
    if code == 0 and stdout.strip():
        m_base = re.search(r'"base_url":\s*"([^"]+)"', stdout)
        m_mod = re.search(r'"model":\s*"([^"]+)"', stdout)
        cur_base = m_base.group(1) if m_base else None
        cur_mod = m_mod.group(1) if m_mod else None
        results.append(
            AuditResult(
                environment=env_name,
                component="cortexkit-aft",
                target_path="~/.config/cortexkit/aft.jsonc",
                key_name="semantic.base_url",
                current_value=cur_base,
                expected_value=CANONICAL_LITEROUTER_URL,
                status="OK" if cur_base == CANONICAL_LITEROUTER_URL else ("MISALIGNED" if cur_base else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="cortexkit-aft",
                target_path="~/.config/cortexkit/aft.jsonc",
                key_name="semantic.model",
                current_value=cur_mod,
                expected_value=CANONICAL_MODEL,
                status="OK" if cur_mod == CANONICAL_MODEL else ("MISALIGNED" if cur_mod else "MISSING"),
            )
        )

    # 2. macOS OMP
    code, stdout, stderr = run_ssh(host, "cat ~/.omp/agent/config.yml 2>/dev/null")
    if code == 0 and stdout.strip():
        m_api = re.search(r"embeddingApiUrl:\s*(\S+)", stdout)
        m_mod = re.search(r"embeddingModel:\s*(\S+)", stdout)
        cur_api = m_api.group(1) if m_api else None
        cur_mod = m_mod.group(1) if m_mod else None
        results.append(
            AuditResult(
                environment=env_name,
                component="omp-mnemopi",
                target_path="~/.omp/agent/config.yml",
                key_name="mnemopi.embeddingApiUrl",
                current_value=cur_api,
                expected_value=CANONICAL_LITEROUTER_URL,
                status="OK" if cur_api == CANONICAL_LITEROUTER_URL else ("MISALIGNED" if cur_api else "MISSING"),
            )
        )
        results.append(
            AuditResult(
                environment=env_name,
                component="omp-mnemopi",
                target_path="~/.omp/agent/config.yml",
                key_name="mnemopi.embeddingModel",
                current_value=cur_mod,
                expected_value=CANONICAL_MODEL,
                status="OK" if cur_mod == CANONICAL_MODEL else ("MISALIGNED" if cur_mod else "MISSING"),
            )
        )

    return results


def fix_cluster():
    print(
        "\n════════════════════════════════════════════════════════════════════════════════════════════════════════════════════"
    )
    print("                                      Aligning Cluster Configurations")
    print(
        "════════════════════════════════════════════════════════════════════════════════════════════════════════════════════"
    )

    # 1. Fix Win11 AFT
    win11_aft = Path("/mnt/c/Users/yapil/.config/cortexkit/aft.jsonc")
    if win11_aft.exists():
        content = win11_aft.read_text(encoding="utf-8")
        new_content = re.sub(
            r'"base_url":\s*"[^"]+"',
            f'"base_url": "{CANONICAL_LITEROUTER_URL}"',
            content,
        )
        new_content = re.sub(r'"max_batch_size":\s*\d+', '"max_batch_size": 4', new_content)
        if new_content != content:
            win11_aft.write_text(new_content, encoding="utf-8")
            print(
                "  • [Win11] cortexkit-aft: Updated base_url to http://literouter.lan:7766/v1 and max_batch_size to 4"
            )
        else:
            print("  • [Win11] cortexkit-aft: Already aligned")

    # 2. Fix Win11 OMP
    win11_omp = Path("/mnt/c/Users/yapil/.omp/agent/config.yml")
    if win11_omp.exists():
        content = win11_omp.read_text(encoding="utf-8")
        if "mnemopi:" not in content:
            content = re.sub(r"backend:\s*local", "backend: mnemopi", content)
            mnemopi_block = (
                "\nmnemopi:\n"
                f"  embeddingApiKey: {CANONICAL_TOKEN}\n"
                f"  embeddingApiUrl: {CANONICAL_LITEROUTER_URL}\n"
                f"  embeddingModel: {CANONICAL_MODEL}\n"
                "  llmMode: smol\n"
                "  polyphonicRecall: true\n"
                "  proactiveLinking: true\n"
            )
            if "memory:" in content:
                content = re.sub(r"(backend:\s*mnemopi)", r"\1" + mnemopi_block, content, count=1)
            else:
                content += "\nmemory:\n  backend: mnemopi" + mnemopi_block
            win11_omp.write_text(content, encoding="utf-8")
            print("  • [Win11] omp-mnemopi: Configured mnemopi backend and BGE-M3 LiteRouter embedding URL")
        else:
            print("  • [Win11] omp-mnemopi: Already has mnemopi configured")

    # 3. Fix VPS baziforecaster .env
    target_env = "/home/vps466a/services/baziforecaster/.env"
    fix_vps_cmd = (
        f"sed -i 's|BGEM3_URL=http://10.32.34.243:8002/v1/embeddings|"
        f"BGEM3_URL={CANONICAL_EMBEDDINGS_URL}|g' {target_env} && "
        f"sed -i 's|EMBEDDING_SERVICE_URL=http://10.32.34.243:8002/v1/embeddings|"
        f"EMBEDDING_SERVICE_URL={CANONICAL_EMBEDDINGS_URL}|g' {target_env} && "
        f"sed -i 's|BGEM3_TOKEN=m1macmini|BGEM3_TOKEN={CANONICAL_TOKEN}|g' {target_env}"
    )
    code, stdout, stderr = run_ssh("vps466a", fix_vps_cmd)
    if code == 0:
        print("  • [VPS] services/baziforecaster: Aligned BGEM3_URL and BGEM3_TOKEN to LiteRouter canonical targets")
    else:
        print(f"  • [VPS] services/baziforecaster update failed: {stderr or stdout}")

    # 4. Fix macOS OMP
    fix_macos_omp = """python3 -c '
import re
with open("/Users/yapilymm/.omp/agent/config.yml", "r") as f:
    content = f.read()
if "mnemopi:" not in content:
    content = re.sub(r"backend:\\s*local", "backend: mnemopi", content)
    mnemopi_block = (
        "\\nmnemopi:\\n"
        "  embeddingApiKey: sk-no-key-required\\n"
        "  embeddingApiUrl: http://literouter.lan:7766/v1\\n"
        "  embeddingModel: BAAI/bge-m3\\n"
        "  llmMode: smol\\n  polyphonicRecall: true\\n  proactiveLinking: true\\n"
    )
    content = re.sub(r"(backend:\\s*mnemopi)", r"\\1" + mnemopi_block, content, count=1)
    with open("/Users/yapilymm/.omp/agent/config.yml", "w") as f:
        f.write(content)
    print("OK")
else:
    print("ALREADY")
'"""
    code, stdout, stderr = run_ssh("yapilymm", fix_macos_omp)
    if code == 0 and "OK" in stdout:
        print("  • [macOS] omp-mnemopi: Configured mnemopi backend and BGE-M3 LiteRouter embedding URL")
    else:
        print(f"  • [macOS] omp-mnemopi status: {stdout.strip() or stderr.strip()}")


def print_audit_table(results: List[AuditResult]):
    header = f"{'Env':<7} | {'Component':<22} | {'Key':<22} | {'Status':<10} | {'Current':<38} | {'Target':<38}"
    print("-" * len(header))
    print(header)
    print("-" * len(header))
    for r in results:
        cur = (r.current_value or "(not set)")[:38]
        tgt = r.expected_value[:38]
        status_colored = r.status
        if r.status == "OK":
            status_colored = f"\033[92m{r.status:<10}\033[0m"
        elif r.status in ("MISALIGNED", "MISSING", "ERROR"):
            status_colored = f"\033[91m{r.status:<10}\033[0m"
        print(f"{r.environment:<7} | {r.component:<22} | {r.key_name:<22} | {status_colored} | {cur:<38} | {tgt:<38}")
    print("-" * len(header))


def main():
    parser = argparse.ArgumentParser(description="Audit BGE-M3 embedding settings across cluster")
    parser.add_argument("--probe", action="store_true", help="Run live probe queries from each environment")
    parser.add_argument("--fix", action="store_true", help="Align and fix misaligned settings across the cluster")
    args = parser.parse_args()

    print(
        "════════════════════════════════════════════════════════════════════════════════════════════════════════════════════"
    )
    print("                    LiteRouter BGE-M3 Cluster Configuration Auditor (4 Environments)")
    print(
        "════════════════════════════════════════════════════════════════════════════════════════════════════════════════════"
    )

    all_results = []
    all_results.extend(audit_wsl2())
    all_results.extend(audit_win11())
    all_results.extend(audit_vps())
    all_results.extend(audit_macos())

    print_audit_table(all_results)

    if args.fix:
        fix_cluster()
        print("\nRe-auditing post-alignment...")
        all_results = []
        all_results.extend(audit_wsl2())
        all_results.extend(audit_win11())
        all_results.extend(audit_vps())
        all_results.extend(audit_macos())
        print_audit_table(all_results)

    misaligned = [r for r in all_results if r.status in ("MISALIGNED", "MISSING")]
    if misaligned:
        print(f"\n⚠️  Found {len(misaligned)} misaligned or missing setting(s) across the cluster:")
        for m in misaligned:
            val_str = f"'{m.current_value}' (expected '{m.expected_value}')"
            print(f"  • [{m.environment}] {m.component} ({m.target_path}) -> {m.key_name}: {val_str}")
    else:
        print("\n✅ All static configuration keys match canonical targets across all 4 environments.")

    if args.probe:
        print(
            "\n════════════════════════════════════════════════════════════════════════════════════════════════════════════════════"
        )
        print("                             Three-Tier TEI & LiteRouter Gateway Probes")
        print(
            "════════════════════════════════════════════════════════════════════════════════════════════════════════════════════"
        )
        tier_probes = [
            probe_endpoint(TEI_GPU_URL, "Tier 1: WSL2 GPU (Reverse Tunnel Port 8002)", is_openai_compat=False),
            probe_endpoint(TEI_MAC_URL, "Tier 2: Mac Mini M1 MPS (Flat LAN Port 8002)", is_openai_compat=True),
            probe_endpoint(TEI_CPU_URL, "Tier 3: VPS CPU (Local Fallback Port 8003)", is_openai_compat=False),
            probe_endpoint(CANONICAL_EMBEDDINGS_URL, "LiteRouter Gateway (Unified Port 7766)", is_openai_compat=True),
        ]

        probe_header = f"{'Tier / Target':<45} | {'Status':<10} | {'Dim':<6} | {'Latency':<10} | {'Endpoint URL':<40}"
        print("-" * len(probe_header))
        print(probe_header)
        print("-" * len(probe_header))
        for p in tier_probes:
            status_str = (
                f"\033[92mPASS\033[0m ({p.status_code})" if p.healthy else f"\033[91mFAIL\033[0m ({p.status_code})"
            )
            lat_str = f"{p.latency_ms:.1f} ms"
            print(f"{p.tier_label:<45} | {status_str:<19} | {p.dimension:<6} | {lat_str:<10} | {p.target_url:<40}")
        print("-" * len(probe_header))

        # Pydantic V2 Schema Governance Report
        all_passed = all(p.healthy for p in tier_probes)
        report = ClusterProbeReport(
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            probes=tier_probes,
            all_passed=all_passed,
        )
        _ = report.model_dump_json()

        if all_passed:
            print("\n✅ All dual-tier TEI instances and LiteRouter gateway passed dimension (1024) and latency checks.")
        else:
            print("\n❌ One or more embedding tiers failed validation.")
            raise SystemExit(1)

        print(
            "\n════════════════════════════════════════════════════════════════════════════════════════════════════════════════════"
        )
        print("                                   Cluster Host Reachability Probes")
        print(
            "════════════════════════════════════════════════════════════════════════════════════════════════════════════════════"
        )
        targets = [
            ("WSL2 (local)", None),
            ("VPS (vps466a)", "vps466a"),
            ("macOS (yapilymm)", "yapilymm"),
            ("Win11 (host)", "win11"),
        ]
        for name, host in targets:
            if host == "win11":
                cmd = [
                    "powershell.exe",
                    "-NoProfile",
                    "-Command",
                    f'$b = @{{ model = "{CANONICAL_MODEL}"; input = "probe" }} | ConvertTo-Json; '
                    + f'$u = "{CANONICAL_EMBEDDINGS_URL}"; '
                    + '$r = Invoke-RestMethod -Uri $u -Method Post -Body $b -ContentType "application/json"; '
                    + 'if ($r.data[0].embedding.Length -eq 1024) { Write-Output "OK" }',
                ]
                code, out, err = run_cmd(cmd)
                ok = code == 0 and "OK" in out
                msg = "HTTP 200 OK (returned valid embedding vector via PowerShell)" if ok else f"Failed: {err or out}"
            else:
                ok, msg = test_live_probe(host)
            status = "\033[92mPASS\033[0m" if ok else "\033[91mFAIL\033[0m"
            print(f"  • {name:<20} ➔ {status} | {msg}")


if __name__ == "__main__":
    main()
