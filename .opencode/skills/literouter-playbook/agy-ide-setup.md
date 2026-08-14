# Antigravity IDE Setup & Upgrade Skill

> **Purpose**: This skill documents the complete procedure for upgrading Antigravity IDE and fixing the `jetski.cloudCodeUrl` nudging issue. Future LLMs can follow these deterministic steps without searching or guessing.

---

## 🔍 Problem Summary

**Symptoms**:
- Antigravity IDE shows persistent update/nudging prompts
- Binary reports v2.0.4 even after attempted upgrades
- `jetski.cloudCodeUrl: "http://127.0.0.1:18888"` in settings overrides the proper Google Cloud auth endpoint

**Root Cause**:
1. Local proxy override in `settings.json` pointing to `127.0.0.1:18888` (stale local proxy)
2. Old binary still in place (v2.0.4) instead of v2.1.1
3. Embedded `product.json` inside the IDE still referencing old commit/date

---

## 📦 Step 1: Download Antigravity IDE 2.1.1

```bash
# Create temp directory and download the correct tarball
mkdir -p /tmp/agiy-upgrade
cd /tmp/agiy-upgrade

# Download Antigravity IDE 2.1.1 from the official Google edge URL
wget -q "https://edgedl.me.gvt1.com/edgedl/release2/j0qc3/antigravity/stable/2.1.1-6123990880747520/linux-x64/Antigravity%20IDE.tar.gz" -O agyi.tar.gz

# Extract
tar -xzf agyi.tar.gz
```

**Expected**: A directory `Antigravity IDE/` containing `antigravity-ide`, `resources/`, `LICENSES.chromium.html`, etc.

---

## 🔧 Step 2: Backup & Replace the Binary

```bash
# Navigate to the IDE installation
cd /opt/antigravity-ide

# Kill any running antigravity processes (optional but recommended)
pkill -9 -f "antigravity" 2>/dev/null || true
sleep 2

# Backup the old binary (optional)
cp antigravity-ide antigravity-ide.bak.$(date +%Y%m%d%H%M%S)

# Remove the old binary
rm -f antigravity-ide

# Copy the new binary from the extracted tarball
cp /tmp/agiy-upgrade/"Antigravity IDE"/antigravity-ide /opt/antigravity-ide/antigravity-ide

# Make executable
chmod +x /opt/antigravity-ide/antigravity-ide

# Verify
ls -la /opt/antigravity-ide/antigravity-ide
# Should show: -rwxr-xr-x 1 root root 199855320 Aug 12 HH:MM
```

**Verify the date changed**: Old = Jun 2, New = Aug 12 (today's date)

---

## 📂 Step 3: Replace Embedded Resources (product.json)

The IDE bundles its own `product.json` inside the extracted tarball. This must be replaced too.

```bash
# Copy the new resources from the extracted tarball
cp -r /tmp/agiy-upgrade/"Antigravity IDE"/resources /opt/antigravity-ide/resources

# Verify the new product.json
python3 -c "
import json
with open('/opt/antigravity-ide/resources/app/product.json') as f:
    d = json.load(f)
print('version:', d.get('version'))
print('commit:', d.get('commit'))
print('date:', d.get('date'))
# Should show: version=1.107.0, commit=e0b7a2b, date=2026-06-17
# Old would show: commit=def9583, date=2026-06-02
"
```

---

## 🛠️ Step 4: Fix the `jetski.cloudCodeUrl` Setting

This is the critical fix that stops the persistent nudging.

```bash
# The settings file location
SETTINGS_FILE="/home/YOUR_USER/.config/Antigravity IDE/User/settings.json"

# Remove the jetski key entirely (the local proxy override)
# The key is a LITERAL dotted key: "jetski.cloudCodeUrl" (one key with a dot in its name)

python3 << 'PYEOF'
import json

settings_file = "$SETTINGS_FILE"

with open(settings_file, 'r') as f:
    data = json.load(f)

# Remove the jetski.cloudCodeUrl dotted key
if 'jetski.cloudCodeUrl' in data:
    del data['jetski.cloudCodeUrl']
    print("Removed 'jetski.cloudCodeUrl' from settings")

# Write back immediately with fsync
with open(settings_file, 'w') as f:
    json.dump(data, f, indent=4)
    import os
    f.flush()
    os.fsync(f.fileno())

# Verify removal
with open(settings_file, 'r') as f:
    verify = json.load(f)

print("jetski.cloudCodeUrl present after fix:", 'jetski.cloudCodeUrl' in verify)
PYEOF
```

**Alternative (sed-based, less reliable)**:
```bash
# Remove lines containing 'jetski' and fix any trailing comma issues
sed '/jetski/d' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
```

**Note**: The Python method is recommended — it handles the JSON structure properly and removes the key cleanly.

---

## ✅ Step 5: Verify Everything

Run all three checks:

```bash
python3 << 'PYEOF'
import json, os

print('=== VERIFICATION ===')
print()

# 1. Binary date
stat = os.stat('/opt/antigravity-ide/antigravity-ide')
date_str = __import__('datetime').datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M')
print('1. Binary date:', date_str)
print('   Expected: Aug 12 (2.1.1) -', 'PASS' if date_str == '2026-08-12 08:57' else 'FAIL')
print()

# 2. Product.json commit
with open('/opt/antigravity-ide/resources/app/product.json') as f:
    d = json.load(f)
commit = d.get('commit')
print('2. Product.json commit:', commit)
print('   Is new (e0b7a2b from Jun 17):', commit == 'e0b7a2bcf575cfba10528c4e7c10bd3ce2d7769a', '-', 'PASS' if commit == 'e0b7a2bcf575cfba10528c4e7c10bd3ce2d7769a' else 'FAIL')
print()

# 3. Settings - jetski removed
with open('/home/YOUR_USER/.config/Antigravity IDE/User/settings.json') as f:
    s = json.load(f)
has_jetski = 'jetski.cloudCodeUrl' in s
print('3. jetski.cloudCodeUrl in settings:', has_jetski)
print('   Status:', 'PASS' if not has_jetski else 'FAIL')
print()

# Summary
all_pass = (
    date_str == '2026-08-12 08:57' and
    commit == 'e0b7a2bcf575cfba10528c4e7c10bd3ce2d7769a' and
    not has_jetski
)
print('=== ALL CHECKS:', 'PASS' if all_pass else 'FAIL', '===')
PYEOF
```

**All three should output PASS**.

---

## 📋 Quick Reference Checklist

| Step | Action | Verify By |
|------|--------|-----------|
| 1 | Download tar.gz from edge URL | `ls /tmp/agiy-upgrade/"Antigravity IDE"/` |
| 2 | Replace binary at `/opt/antigravity-ide/antigravity-ide` | `ls -la` shows Aug 12 date |
| 3 | Copy new `resources/` including `product.json` | `python3 -c "import json; d=json.load(...)` shows commit=e0b7a2b |
| 4 | Remove `jetski.cloudCodeUrl` from settings | `python3 -c "import json; 'jetski.cloudCodeUrl' in s` returns False |
| 5 | Run all three verification checks | All PASS |

---

## ⚠️ Common Pitfalls & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| `cp: cannot create regular file: Text file busy` | Old binary still loaded by running processes | `pkill -9 -f "antigravity"` + retry |
| `jetski.cloudCodeUrl` still present after removal | Python dict delete didn't persist to disk | Use `os.fsync()` after write, or use `sed` + trailing comma fix |
| `product.json` still shows old commit | Only copied the binary, not the embedded resources | `cp -r /tmp/agiy-upgrade/"Antigravity IDE"/resources /opt/antigravity-ide/resources` |
| IDE won't start in WSL2 | Headless environment (no dbus/gpu) | This is expected — the upgrade is still in place; run in graphical env |
| JSON parse error after removing key | Trailing comma before `}` in the JSON file | Use Python `json.dump()` instead of sed (recommended) |

---

## 💡 Tips & Notes

- **Always use Python `json.dump()`** for settings file modifications — it handles the structure correctly and avoids trailing comma issues
- **Use `os.fsync()`** after writing settings to ensure the write is persisted to disk
- **Verify the binary date** changes from Jun 2 → Aug 12 to confirm the upgrade worked
- **The `product.json` inside the IDE** is separate from any system-level product.json — both must be updated
- **In headless WSL2**, the IDE binary will show dbus/gpu errors on startup — this is normal. The upgrade is still valid; run in a graphical environment for full functionality
- **Keep a backup**: `cp antigravity-ide antigravity-ide.bak.$(date +%Y%m%d%H%M%S)` before upgrading, in case you need to roll back