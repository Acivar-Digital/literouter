# Repository Project Management & Dependency Graph Blueprint

> **Universal Template**: Provide this document to an AI agent in any repository to autonomously configure GitHub Projects (v2), the GitHub Dependency Graph, and local Beads issue tracking.

---

## 1. Architecture Overview: Tiered Hybrid Tracking

Modern engineering requires dual-speed tracking:
- **Level 1: GitHub Projects v2 (Human / Executive)**: Epics, architectural milestones, cross-repo dependencies, and PR tracking. Provides visual Kanban and Roadmap views.
- **Level 2: Beads `bd` (Autonomous Agent / TDD)**: Micro-task slicing, failure quarantine, test-driven iterations, subagent delegation. Stored locally in a high-speed Dolt SQL database (`.beads/`).

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

**The Boundary Rule**: Never mirror micro-tasks into GitHub Issues. Doing so creates noise, triggers API rate limits, and clutters team roadmaps. Only create GitHub Issues for user-facing features, architectural epics, or external bug reports.

---

## 2. GitHub Projects (v2) Setup

### Step 2.1: Verify Authentication Scopes
The GitHub CLI must have the `project` OAuth scope:
```bash
gh auth status
# If missing 'project':
gh auth refresh -s project,read:project
```

### Step 2.2: Create the Project
```bash
# For an Organization:
gh project create --owner <ORGANIZATION> --title "<PROJECT_NAME>" --format json

# Or for a Personal User Account:
gh project create --owner "@me" --title "<PROJECT_NAME>" --format json
```
*Note the returned `number` and Node ID (`id: "PVT_..."`).*

### Step 2.3: Link Repository to Project
```bash
gh project link <PROJECT_NUMBER> --owner <OWNER> --repo <OWNER>/<REPO_NAME>
```

### Step 2.4: Configure Custom Fields
Standard schema fields:
```bash
# Priority Field
gh project field-create <PROJECT_NUMBER> --owner <OWNER> \
  --name "Priority" --data-type "SINGLE_SELECT" --single-select-options "P0,P1,P2,P3"

# Domain / Module Field
gh project field-create <PROJECT_NUMBER> --owner <OWNER> \
  --name "Domain" --data-type "SINGLE_SELECT" --single-select-options "Core,API,Infra,UI,Test"
```

---

## 3. GitHub Dependency Graph & Supply Chain Setup

### The Lockfile Trap:
GitHub's web UI (`https://github.com/<OWNER>/<REPO>/network/dependencies`) uses static background parsers that recognize `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, and `requirements.txt`.
If your repo uses modern tools like **Bun** (`bun.lock`) or **uv** (`uv.lock`), the web UI will claim:
> *"To view your dependency graph, your repository must define dependencies in one of the supported manifest file types..."*

### The Universal Fix:
1. **For Bun / Node repos**: Keep a lightweight `package-lock.json` committed:
   ```bash
   npm i --package-lock-only
   ```
2. **For Python / uv repos**: Deploy the GitHub Dependency Submission Action in `.github/workflows/dependency_graph.yml`:

```yaml
name: Dependency Graph Submission

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write

jobs:
  dependency-submission:
    name: Submit Dependency Graph
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up uv
        uses: astral-sh/setup-uv@v5
        with:
          version: "latest"

      - name: Submit Python dependencies (uv.lock)
        uses: rmuir/uv-dependency-submission@v1
        continue-on-error: true

      - name: Submit Component Detection Snapshot
        uses: advanced-security/component-detection-dependency-submission-action@v0.0.4
        continue-on-error: true
```

---

## 4. Local Beads (`bd`) Integration

### Step 4.1: Initialize Beads
```bash
bd prime
```

### Step 4.2: Execution Loop
1. Agent reads GitHub Project Epic.
2. Agent breaks Epic into local beads:
   ```bash
   bd create "Slice 1: Implement data layer" -t task -p 2 --acceptance="1. Unit tests pass"
   bd update <id> --claim
   ```
3. Agent executes, runs test gates, and closes beads:
   ```bash
   bd close <id> --reason "Completed and verified"
   ```
4. When all child beads close, the agent marks the parent GitHub Project item as `Done`:
   ```bash
   gh project item-edit --project-id "<PROJECT_ID>" --id "<ITEM_ID>" \
     --field-id "<STATUS_FIELD_ID>" --single-select-option-id "<DONE_OPTION_ID>"
   ```

---

## 5. Agent Instructions (`AGENTS.md` Snippet)

Paste this block into the repository's `AGENTS.md`:

```markdown
## Project Management & Issue Tracking Protocol
- **Epics & Roadmaps**: Tracked in GitHub Projects v2 (Project #<NUMBER>).
- **Implementation Slices**: Tracked locally in Beads (`bd ready`, `bd claim`, `bd close`).
- **Dependencies & Supply Chain**:
  - Query full SBOM: `gh api repos/<OWNER>/<REPO>/dependency-graph/sbom`
  - Query CVE alerts: `gh api repos/<OWNER>/<REPO>/dependabot/alerts`
- **Agent Skill**: Refer to `skill://github-projects` for CLI and GraphQL operations.
```
