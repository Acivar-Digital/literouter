---
name: agy-ide
description: Guide and operational playbook for installing, upgrading, configuring, and maintaining Google Antigravity IDE in WSL2 user space without sudo.
---

# Skill: agy-ide

# Antigravity IDE (WSL2 User-Space Playbook)

## Quick Start & Commands
- **Launch IDE in Current Directory:** `antigravity-ide .` or `antigravity .`
- **Check Engine & Commit Info:** `antigravity-ide --version`
- **Inspect Product & Release Metadata:** 
  ```bash
  python3 -c "import json; data=json.load(open('$HOME/.local/share/antigravity-ide/resources/app/product.json')); print('Distro Commit:', data.get('commit'), 'Build Date:', data.get('date'), 'VSCode Base:', data.get('version'))"
  ```
- **Inspect Extension Info:**
  ```bash
  python3 -c "import json; data=json.load(open('$HOME/.local/share/antigravity-ide/resources/app/extensions/antigravity/package.json')); print('Antigravity Ext:', data.get('name'), data.get('version'))"
  ```

---

## ⛔ CRITICAL ARCHITECTURE MANDATE: USER-SPACE FIRST (NO SUDO)

### 1. User-Space Philosophy
- **NEVER install or update Antigravity IDE in `/opt/` or `/usr/share/`** unless explicitly requested by the user.
- User-space installation (`~/.local/share/antigravity-ide`) allows automated upgrades, agent tooling, and script execution without requiring interactive `sudo` password prompts.
- All user data, extensions, and configurations remain isolated in `$HOME`.

### 2. Path Layout & Structure
| Purpose | Path | Description |
| :--- | :--- | :--- |
| **App Root** | `~/.local/share/antigravity-ide/` | Extracted Electron & VS Code application files |
| **CLI Wrapper** | `~/.local/bin/antigravity-ide` | Executable wrapper with WSL flags |
| **CLI Symlink** | `~/.local/bin/antigravity` | Short alias symlinked to `antigravity-ide` |
| **Desktop Entry** | `~/.local/share/applications/antigravity-ide.desktop` | WSLg / Linux desktop launcher |
| **User Extensions**| `~/.antigravity-ide/` | User-installed extensions and marketplace cache |
| **Flags Config** | `~/.config/antigravity-ide-flags.conf` | Chromium rendering flags for WSLg |

---

## Installation & Upgrade Protocol (Step-by-Step)

When a new release package (`Antigravity IDE.tar.gz`) is downloaded (e.g. in `/mnt/c/Users/<USER>/Downloads/`):

### Step 1: Prepare User Directory & Extract
```bash
# Ensure target directory exists
mkdir -p ~/.local/share/antigravity-ide

# Extract tarball directly with --strip-components=1
tar -xzf "/mnt/c/Users/$(whoami | sed 's/wsl$//')/Downloads/Antigravity IDE.tar.gz" -C ~/.local/share/antigravity-ide --strip-components=1
```
*(Adjust the download path if the archive is located elsewhere).*

### Step 2: Create Executable Wrapper
Create `~/.local/bin/antigravity-ide` to bypass the default WSL interactive warning prompt (`DONT_PROMPT_WSL_INSTALL=1`):
```bash
mkdir -p ~/.local/bin

cat << 'EOF' > ~/.local/bin/antigravity-ide
#!/usr/bin/env bash
export DONT_PROMPT_WSL_INSTALL=1
exec "$HOME/.local/share/antigravity-ide/bin/antigravity-ide" "$@"
EOF

chmod +x ~/.local/bin/antigravity-ide
ln -sf ~/.local/bin/antigravity-ide ~/.local/bin/antigravity
```

### Step 3: Configure Desktop Integration
Create `~/.local/share/applications/antigravity-ide.desktop` for Windows Subsystem for Linux GUI (WSLg) integration:
```bash
mkdir -p ~/.local/share/applications

cat << 'EOF' > ~/.local/share/applications/antigravity-ide.desktop
[Desktop Entry]
Name=Antigravity IDE
Comment=Code Editing. Redefined.
GenericName=Text Editor
Exec=/home/yapilwsl/.local/bin/antigravity-ide %F
Icon=/home/yapilwsl/.local/share/antigravity-ide/resources/app/resources/linux/code.png
Type=Application
StartupNotify=false
StartupWMClass=Antigravity IDE
Categories=TextEditor;Development;IDE;
MimeType=text/plain;inode/directory;
Keywords=vscode;antigravity;ide;
Actions=new-empty-window;

[Desktop Action new-empty-window]
Name=New Empty Window
Exec=/home/yapilwsl/.local/bin/antigravity-ide --new-window %F
Icon=/home/yapilwsl/.local/share/antigravity-ide/resources/app/resources/linux/code.png
EOF
```

### Step 4: Verify Installation
```bash
# Verify PATH resolution
which antigravity-ide
which antigravity

# Verify CLI execution
antigravity-ide --version
```

---

## Versioning & Metadata Verification

### Understanding Version Numbers
- **Product Version (e.g. 2.5.5):** The branding / release tag of the Google Antigravity IDE distribution.
- **VSCode OSS Engine Version (e.g. 1.107.0):** The base Microsoft VS Code engine on which Antigravity is built.
- Running `antigravity-ide --version` outputs the **VS Code Engine version** + **Commit Hash** + **Architecture** by default.

### Verifying Release Freshness
To inspect the release timestamp and commit directly from the extracted package:
```bash
python3 -c "import json; data=json.load(open('$HOME/.local/share/antigravity-ide/resources/app/product.json')); print('Name:', data.get('nameLong'), '| Base:', data.get('version'), '| Commit:', data.get('commit'), '| Built:', data.get('date'))"
```

---

## Legacy System Clean-Up Protocol

If previous versions were installed system-wide in `/opt/` or `/usr/share/`, they should be removed to free disk space (~1.2 GB+ per obsolete build):

```bash
# Cleanup script for obsolete system paths
TARGETS=(
  "/opt/antigravity-ide"
  "/usr/share/antigravity"
  "/usr/local/bin/antigravity"
  "/usr/local/bin/antigravity-ide"
  "/usr/bin/antigravity"
)
sudo rm -rf "${TARGETS[@]}"
```
*(This requires sudo once to clean up past root-owned system files. All future updates remain rootless in `~/.local/`).*
