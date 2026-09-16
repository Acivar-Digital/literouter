# Advisor MVP Login Checklist

When user is back / ready:
- Login URL placeholder: `https://example.com/oauth/authorize?client_id=<CLIENT>&redirect_uri=http://localhost:8765/callback&scope=read`
- What we collect: session state (NOT tokens) saved to `~/.advisor_tools/`; refresh loop active; disable on `invalid_grant`.
- What we do NOT collect/store: real OAuth tokens, `.env.local`, `.env`, repo secrets, `<REDACTED>` placeholders.

Verification:
- [ ] `advisor/auth/capture.ts` exists and `bun typecheck` clean.
- [ ] `advisor/fetch/views.sh` + `views.py` exist; no secrets embedded.
- [ ] `~/.advisor_tools/` exists (outside repo); session files not committed.
- [ ] `.gitignore` excludes `.env*`; no `.env.local` edited.
- [ ] `advisor/MVP_CHECKLIST.md` exists with login URL placeholder and zero real tokens.
