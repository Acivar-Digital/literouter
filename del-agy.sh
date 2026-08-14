#!/usr/bin/env bash
set -e

echo "=== Antigravity IDE Old Versions Cleanup ==="

TARGETS=(
  "/opt/antigravity-ide"
  "/usr/share/antigravity"
  "/usr/local/bin/antigravity"
  "/usr/local/bin/antigravity-ide"
  "/usr/bin/antigravity"
)

echo "The following obsolete files and directories will be removed:"
for target in "${TARGETS[@]}"; do
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "  - $target ($(du -sh "$target" 2>/dev/null | cut -f1 || echo 'link'))"
  fi
done

echo ""
echo "Requesting sudo privileges to remove old system files..."
sudo rm -rf "${TARGETS[@]}"

echo " Cleanup complete! Old Antigravity versions have been removed."
echo "Active version remains intact at: ~/.local/share/antigravity-ide"
