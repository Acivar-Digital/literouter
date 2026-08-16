---
name: opencode2-playbook
description: OpenCode 2 (Next/Beta) integration, deployment, and TLS connection guide for LiteRouter.
---

# OpenCode 2 (V2) Playbook for LiteRouter

This playbook documents the workflows, environment isolation, and TLS connection steps for running **OpenCode 2 (Next / Beta)** against LiteRouter's HTTPS endpoint.

---

## 1. Physical Isolation Architecture

| Dimension | OpenCode 1 (Stable) | OpenCode 2 (Next / Beta) |
|---|---|---|
| **CLI Command** | `opencode` | `opencode2` |
| **Global Config Root** | `~/.config/opencode/` | `~/.config/opencode2/` |
| **XDG Config Root** | `~/.config` | `~/.config/opencode2_xdg` (→ `~/.config/opencode2`) |
| **XDG Data Root** | `~/.local/share/opencode` | `~/.local/share/opencode2` |
| **XDG State Root** | `~/.local/state/opencode` | `~/.local/state/opencode2` |
| **XDG Cache Root** | `~/.cache/opencode` | `~/.cache/opencode2` |
| **Root CA File** | N/A (plain HTTP) | `~/.local/share/opencode2/mkcert/rootCA.pem` |

> **NEVER share state**: OpenCode 2's background daemon (`opencode2 serve --service`) must not collide with OpenCode 1's directories or sockets.

---

## 2. TLS Connection Setup

### Prerequisites
1. LiteRouter is running **with TLS enabled** (see [LiteRouter Playbook: TLS](/literouter-playbook)).
2. `mkcert` root CA is installed at `~/.local/share/opencode2/mkcert/rootCA.pem`.
3. Certificates exist: `certs/localhost.pem`, `certs/localhost-key.pem`.

### Environment Variables
These must be set **before** OpenCode 2 starts so `Node.js fetch()` trusts the localhost cert.

#### For OpenCode 2 (`~/.local/bin/opencode2` wrapper):
```bash
export NODE_EXTRA_CA_CERTS="${HOME}/.local/share/opencode2/mkcert/rootCA.pem"
export XDG_CONFIG_HOME="${HOME}/.config/opencode2_xdg"
export XDG_DATA_HOME="${HOME}/.local/share/opencode2"
export XDG_STATE_HOME="${HOME}/.local/state/opencode2"
export XDG_CACHE_HOME="${HOME}/.cache/opencode2"
```

#### For OpenCode 1 (`~/.local/bin/opencode` wrapper):
```bash
export NODE_EXTRA_CA_CERTS="${HOME}/.local/share/opencode2/mkcert/rootCA.pem"
export XDG_CONFIG_HOME="${HOME}/.config"
export XDG_DATA_HOME="${HOME}/.local/share"
```

### LiteRouter Configuration
In `~/.config/opencode2/config.json` or `~/.config/opencode2/opencode.json`:
```json
{
  "provider": {
    "literouter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LiteRouter",
      "options": {
        "baseURL": "https://localhost:7766/v1",
        "apiKey": "sk-lr-your-auth-key"
      }
    },
    "literouter-google": {
      "npm": "@ai-sdk/google",
      "name": "LiteRouter Google",
      "options": {
        "baseURL": "https://localhost:7766/v1beta",
        "apiKey": "sk-lr-your-auth-key"
      }
    }
  }
}
```

✅ **Symlink `opencode.json` → `config.json`** so both names are read consistently:
```bash
ln -sfn config.json ~/.config/opencode2/opencode.json
```

---

## 3. Service Restart Protocol (TLS Changes)

When any of the following occur, you **must** restart the OpenCode 2 service daemon:

- LiteRouter is restarted (TLS toggle, port change, env reload)
- `.env` / `.env.local` is modified
- Certificates are regenerated via `scripts/setup_certs.sh`
- `scripts/restart.sh` is run

### Reason
The `opencode2 serve --service` daemon caches the LiteRouter endpoint URL in memory. If LiteRouter switches from HTTP → HTTPS (or vice versa), the daemon holds a stale socket configuration and connections will `ECONNRESET`.

### Procedure
```bash
# 1. Verify LiteRouter TLS status
tmux capture-pane -pt literouter:0 | grep -E "TLS:|running on port"

# 2. Kill stale daemon
pkill -f "opencode2 serve --service"

# 3. (Optional) Clear model cache
rm -f ~/.cache/opencode2/models.json

# 4. Relaunch OpenCode 2 (fresh daemon spawns automatically)
opencode2

# 5. Verify connectivity
opencode2 run "hi"
```

---

## 4. Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `ECONNRESET: The socket connection was closed unexpectedly` | OpenCode 2 daemon cached old HTTP endpoint | `pkill -f "opencode2 serve --service"` then restart |
| `unable get local issuer certificate` | mkcert rootCA not in Node.js trust store | Ensure `NODE_EXTRA_CA_CERTS` is set in wrapper or environment |
| `401 Unauthorized` on health check | Health endpoint requires auth key | Expected; self-test catches as warning |
| `404 Not Found` on model | Model not registered in `models.json` with provider prefix | Use `provider/model` prefix (e.g., `openrouter/poolside/laguna-xs-2.1:free`) |

---

## 5. CLI Commands & Wrappers

| Command | Purpose |
|---|---|
| `which opencode` | Should resolve to `~/.local/bin/opencode` (v1) |
| `which opencode2` | Should resolve to `~/.local/bin/opencode2` (v2) |
| `opencode --version` | OpenCode v1 version (e.g., `3.20.x`) |
| `opencode2 --version` | OpenCode v2 version (e.g., `0.0.0-next-*`) |
| `opencode2 run "..."` | Run a non-interactive prompt against configured default model |
| `opencode2 serve --service` | Background daemon (auto-spawned on first `opencode2` invocation) |

### Wrapper Location
- **OpenCode 1**: `~/.local/bin/opencode`
- **OpenCode 2**: `~/.local/bin/opencode2`

Both scripts must export `NODE_EXTRA_CA_CERTS` (pointing to the mkcert rootCA) and set distinct XDG directories to avoid state collisions.

---

## 6. Cache Clearing Reference

If OpenCode 2 exhibits stale behavior or model errors after config changes:

```bash
# OpenCode 2 caches
rm -f ~/.cache/opencode2/models.json
rm -rf ~/.local/state/opencode2
rm -rf ~/.local/share/opencode2/opencode/packages

# OpenCode 1 caches
rm -f ~/.cache/opencode/models.json
rm -rf ~/.local/state/opencode
rm -rf ~/.local/share/opencode/opencode/packages
```

⚠️ **Never delete**: `~/.local/share/opencode2/mkcert/` (rootCA.pem), `~/.config/opencode2/config.json` (main config)

---

## 7. Debugging Checklist

When OpenCode 2 fails to connect to LiteRouter over HTTPS:

- [ ] LiteRouter is running with TLS enabled (`[TLS: ENABLED, ...]` in tmux logs)
- [ ] Certificates exist: `certs/localhost.pem` + `certs/localhost-key.pem`
- [ ] `mkcert` root CA exists: `~/.local/share/opencode2/mkcert/rootCA.pem`
- [ ] `opencode2` wrapper exports `NODE_EXTRA_CA_CERTS`
- [ ] `config.json` `baseURL` is `https://localhost:7766/v1`
- [ ] `opencode2 serve --service` was restarted after last config/LiteRouter change
- [ ] Manual test: `curl -sk --cacert ~/.local/share/opencode2/mkcert/rootCA.pem https://localhost:7766/v1/chat/completions -H "Authorization: Bearer sk-lr-..."`
