---
name: github-projects
description: Use when querying, updating, or managing GitHub Projects v2, linking epics to beads, or auditing repository dependency graphs.
---

# GitHub Projects (v2) & Dependency Intelligence Playbook

Standard operating guide for AI agents interacting with GitHub Projects (v2 / "Memex") and the GitHub Dependency Graph.

---

## 1. Architectural Philosophy: Tiered Hybrid Tracking

Do NOT mirror micro-tasks 1:1 between Beads (`bd`) and GitHub Projects. That creates API rate limit exhaustion and pollutes human dashboards.

```
┌────────────────────────────────────────────────────────────────────────┐
│             Level 1: GitHub Projects v2 (Cloud / Human)                │
│    Track: Epics, Architecture Milestones, Public Features, PRs        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ 1 Epic links to N child beads
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 Level 2: Beads bd (Local / Agent)                      │
│    Track: Implementation slices, TDD cycles, test fixtures, bugs       │
└────────────────────────────────────────────────────────────────────────┘
```

- **GitHub Projects**: High-level visibility, roadmap planning, stakeholder status (`Todo`, `In Progress`, `Done`).
- **Beads (`bd`)**: Sub-millisecond local execution, zero-token overhead, scratchpad memory (`bd remember`), failure quarantine.
- **Contract**: When all child beads for an Epic are closed and quality gates pass, update the GitHub Project item to `Done`.

---

## 2. Authentication & Prerequisites

GitHub Projects v2 requires the OAuth `project` scope.
```bash
# Check if project scope is active
gh auth status

# If missing, grant project scope
gh auth refresh -s project,read:project
```

---

## 3. Core CLI Recipes (`gh project`)

Projects v2 is powered by GraphQL. Every entity has a unique Node ID.

### A. Discovery & Schema Inspection
```bash
# List projects for the organization
gh project list --owner Acivar-Digital --format json

# View project fields and option IDs
gh project field-list <project-number> --owner Acivar-Digital --format json

# List items (issues, PRs, drafts) currently on the project
gh project item-list <project-number> --owner Acivar-Digital --format json
```

### B. Adding Items to a Project
```bash
# Add an existing repository Issue or PR to the project
gh project item-add <project-number> --owner Acivar-Digital --url https://github.com/Acivar-Digital/literouter/issues/42

# Create a native Draft Issue directly in the project
gh project item-create <project-number> --owner Acivar-Digital --title "Epic Title" --body "Detailed spec..."
```

### C. Updating Fields (Status, Priority, Domain)
Updating single-select fields requires Node IDs (`project-id`, `item-id`, `field-id`, and `single-select-option-id`):
```bash
gh project item-edit \
  --project-id "<PROJECT_NODE_ID>" \
  --id "<ITEM_NODE_ID>" \
  --field-id "<FIELD_NODE_ID>" \
  --single-select-option-id "<OPTION_NODE_ID>"
```

---

## 4. LiteRouter Project 3 Schema Reference

For repository `Acivar-Digital/literouter`:
- **Project URL**: `https://github.com/orgs/Acivar-Digital/projects/3`
- **Project ID**: `PVT_kwDOEOE8EM4BoWbI`

### Field & Option IDs:
- **Status Field ID**: `PVTSSF_lADOEOE8EM4BoWbIzhm28Z4`
  - `Todo`: `f75ad846`
  - `In Progress`: `47fc9ee4`
  - `Done`: `98236657`
- **Priority Field ID**: `PVTSSF_lADOEOE8EM4BoWbIzhm28pw`
  - `P0`: `f25c013c` | `P1`: `d319f44f` | `P2`: `d8b37872` | `P3`: `b8dd66bc`
- **Domain Field ID**: `PVTSSF_lADOEOE8EM4BoWbIzhm28p0`
  - `Core`: `865f0297` | `Network`: `ac39c26b` | `Handlers`: `94825e56` | `Eval`: `624a025d` | `Infra`: `b5e20f80`

---

## 5. Dependency Graph Intelligence & Supply Chain Checks

Never guess dependency versions or manual manifests. Use the live GitHub endpoints:

### A. Query Resolved SBOM (Cross-Language)
```bash
gh api repos/Acivar-Digital/literouter/dependency-graph/sbom \
  --jq '.sbom.packages[] | {name: .name, version: .versionInfo, spdxId: .SPDXID}'
```

### B. Audit Active Security Vulnerabilities (Dependabot Alerts)
```bash
gh api repos/Acivar-Digital/literouter/dependabot/alerts \
  --jq '.[] | {package: .dependency.package.name, severity: .security_advisory.severity, summary: .security_advisory.summary}'
```

### C. Local Dependency Graph Inspection
- Bun: `bun pm ls`
- uv: `uv tree`

---

## 6. Safety & Hygiene Rules for LLMs

1. **Never Create Duplicate Items**: Run `gh project item-list` before creating a new epic or draft.
2. **Never Put Micro-Tasks on GitHub**: Beads is the execution engine; GitHub is the portfolio dashboard.
3. **Handle Missing Scopes Gracefully**: If `gh project` returns code 1 (`missing required scopes`), stop and alert the user with the exact `gh auth refresh` command.
