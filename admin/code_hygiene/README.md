# Code Hygiene

Tooling to keep `ruff` lint debt from silently regrowing. The canonical
config and scripts live here; CI calls into them.

## What is enforced

`uv run ruff check .` must be clean. The rules and `line-length` are defined in
`pyproject.toml` (`[tool.ruff]`, `select = ["E", "F", "I"]`).

> Note: only `ruff check` is enforced. The repo is **not** wholesale
> `ruff format`-ted, so full formatting is intentionally *not* a CI failure.
> `ruff-format` is available via pre-commit (it reformats the files you touch),
> but enabling it repo-wide requires running `uv run ruff format .` first.

## Files

| File | Purpose |
|------|---------|
| `lint-gate.sh` | Single source of truth: exits non-zero if `ruff check` is not clean. Used by CI and local dev. |
| `pre-commit-config.yaml` | pre-commit hooks (`ruff` + `ruff-format`). Lives here; symlink or pass `--config`. |
| `../.github/workflows/lint.yml` | GitHub Actions: runs `lint-gate.sh` on every push / PR. |

## Local usage

Run the gate on the current tree:

```bash
bash admin/code_hygiene/lint-gate.sh
```

Or install the pre-commit hook so it runs automatically on every commit:

```bash
pip install pre-commit
pre-commit install --config admin/code_hygiene/pre-commit-config.yaml
# or symlink to repo root:
ln -s admin/code_hygiene/pre-commit-config.yaml .pre-commit-config.yaml
pre-commit install
```

Run on all files once:

```bash
pre-commit run --all-files --config admin/code_hygiene/pre-commit-config.yaml
```

## CI

`.github/workflows/lint.yml` runs `lint-gate.sh` on `push` and `pull_request`.
If `ruff check .` reports any error, the workflow fails and blocks the merge —
this is what prevents new lint debt from landing.

To fix a failing CI run locally:

```bash
uv run ruff check --fix .
bash admin/code_hygiene/lint-gate.sh   # should now pass
```
