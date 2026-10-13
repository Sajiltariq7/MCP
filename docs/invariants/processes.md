# Process invariants

For plans, git, ADRs, README, and docs. Read [core.md](core.md) first.

| Rule | Status | Enforced in |
| --- | --- | --- |
| Propose the change (explanation plus code or command) in chat before creating files, editing code, or running commands ([ADR 0009](../adrs/0009-proposal-first-workflow-and-stderr-logging.md)) | Convention | Review |
| Wait for explicit owner approval ("Approved", "Proceed") before any edit, new script, or command | Convention | Review |
| Never run commands or scripts autonomously | Convention | Review |
| Commit, push, or open a pull request only when the owner says so | Convention | Review |
| Commit messages and pull request descriptions carry no `Co-Authored-By:` trailer and no AI/tool attribution line | Convention | Review |
| Docs, ADRs, and flows change in the same change as the behaviour they describe | Convention | Review |
| The docs checker reports 0 errors: `uv run scripts/check_docs.py` | Current | `scripts/check_docs.py` |
| A new decision gets a new ADR; a reversed one gets a new ADR that supersedes it | Convention | Review |
| `AGENTS.md`, `CLAUDE.md`, and this file are owner-edited; an agent gives the owner the exact text instead | Convention | Review |
| `CLAUDE.md` contains exactly one line, @AGENTS.md | Current | `scripts/check_docs.py` |

## Before you finish

1. Run `uv run scripts/check_docs.py` and fix every error.
2. Update the pages, flows, and ADRs your change affects ([docs-standard.md](../docs-standard.md), section 7).
