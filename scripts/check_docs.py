#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# dependencies = []
# ///
"""check_docs: keep the agent docs true. Run from the repo root. Exit 1 on any error.

Usage: uv run scripts/check_docs.py   (or: python3 scripts/check_docs.py)

Errors: broken links, missing cited paths, pages no index links to, bad Status words,
rule rows without a valid status, ADR number clashes and one-way supersede links,
CLAUDE.md that is not exactly @AGENTS.md. Warnings: missing Verified lines, oversized files.
Set DOCS_SOURCE_ROOTS (comma-separated, "" = repo root) for folders cited paths are relative to.
"""
import glob, os, re, sys

SOURCE_ROOTS = os.environ.get("DOCS_SOURCE_ROOTS", ",src/").split(",")
SKIP_DIRS = {".git", "node_modules", "vendor", "dist", "build", ".next", ".venv", "venv", "target"}
GENERIC = {"docs/docs-standard.md"}            # generic rules page: its cited paths are examples
PAGE_WORDS = ("Built", "Partial", "Planned")
RULE_WORDS = ("Current", "Convention", "Planned")
EXT = "ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|cs|php|swift|json|css|scss|md|mdx|ya?ml|toml|sql|html|sh|lock|prisma|svg"
LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")
TICK = re.compile(r"`([A-Za-z0-9_@.\[\]/*-]+(?:\.(?:" + EXT + r")|/))`")

errors, warnings = [], []
err = lambda f, msg: errors.append(f"{f}: {msg}")
warn = lambda f, msg: warnings.append(f"{f}: {msg}")


def norm(p):
    return os.path.normpath(p).replace(os.sep, "/")


def agents_files():
    found = []
    for root, dirs, names in os.walk("."):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        found += [norm(os.path.join(root, "AGENTS.md"))] if "AGENTS.md" in names else []
    return found


docs = sorted(norm(f) for f in glob.glob("docs/**/*.md", recursive=True))
agents = agents_files()
files = sorted(set([f for f in ("README.md", "DESIGN.md") if os.path.exists(f)] + agents + docs))
text = {f: open(f, encoding="utf-8").read() for f in files}
prose = {f: re.sub(r"```.*?```|~~~~.*?~~~~", "", t, flags=re.S) for f, t in text.items()}


def links(f):
    """Resolved relative link targets in f."""
    out = []
    for m in LINK.finditer(prose[f]):
        t = m.group(1)
        if re.match(r"^[a-z][a-z0-9+.-]*:", t) or t.startswith("/"):
            continue
        out.append((t, norm(os.path.join(os.path.dirname(f), t))))
    return out


# 0. the router and the map exist
for need in ("AGENTS.md", "docs/index.md"):
    if not os.path.exists(need):
        err(need, "missing")

# 1. links and cited paths
for f in files:
    for raw, target in links(f):
        if not os.path.exists(target):
            err(f, f"broken link: {raw}")
    if f in GENERIC:
        continue
    for m in TICK.finditer(prose[f]):
        p = m.group(1)
        if p.startswith(("/", "~", "http")) or p.count("/") == 0 and p.endswith("/"):
            continue
        cands = [r + p for r in SOURCE_ROOTS] + [os.path.join(os.path.dirname(f), p)]
        if "/" not in p:                       # a bare name like `core.md`: any docs folder may hold it
            cands += [d + "/" + p for d in {os.path.dirname(x) for x in docs}]
        ok = any(glob.glob(c) for c in cands) if "*" in p else any(os.path.exists(c) for c in cands)
        if not ok:
            err(f, f"cited path not found: {p}")

# 2. every page is linked from its index (flat docs/ pages from docs/index.md)
for f in docs:
    if f == "docs/index.md":
        continue
    folder = os.path.dirname(f)
    index = "docs/index.md" if f.endswith("/index.md") or folder == "docs" else f"{folder}/index.md"
    if f.endswith("/index.md") and folder.count("/") > 1:
        index = f"{os.path.dirname(folder)}/index.md"
    if index not in text or f not in {t for _, t in links(index)}:
        err(f, f"not linked from {index}")

# 3. topic pages: Status (error) and Verified (warning)
SPECIAL = ("docs/invariants/", "docs/adrs/", "docs/flows/")
for f in docs:
    if f.endswith("/index.md") or f.startswith(SPECIAL) or f in GENERIC:
        continue
    top = "\n".join(text[f].splitlines()[:12])
    m = re.search(r"^\*\*Status:\*\*\s*([A-Za-z ]+)", top, re.M)
    if not m:
        err(f, "missing **Status:** line near the top")
    elif not m.group(1).strip().startswith(PAGE_WORDS):
        err(f, f"Status must start with {' | '.join(PAGE_WORDS)}, found: {m.group(1).strip()}")
    if not re.search(r"^\*\*Verified:\*\*\s*\d{4}-\d{2}-\d{2}", top, re.M):
        warn(f, "missing **Verified:** YYYY-MM-DD at <hash> line")

# 4. rule tables
for f in docs:
    if not f.startswith("docs/invariants/") or f.endswith("index.md"):
        continue
    col = None
    for line in prose[f].splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")] if line.lstrip().startswith("|") else None
        if not cells:
            col = None
            continue
        if "Status" in cells:
            col = cells.index("Status")
        elif col is not None and not set("".join(cells)) <= set("-: ") and len(cells) > col:
            status = cells[col].strip("`* ")
            if status not in RULE_WORDS:
                err(f, f"rule status must be {' | '.join(RULE_WORDS)}, found '{status}' in: {cells[0][:60]}")

# 5. ADRs
adrs = {}
for f in docs:
    m = re.match(r"docs/adrs/(\d{4})-.+\.md$", f)
    if not m:
        continue
    if m.group(1) in adrs:
        err(f, f"ADR number {m.group(1)} also used by {adrs[m.group(1)]}")
    adrs[m.group(1)] = f
    if not re.search(r"^- \*\*Status:\*\*", text[f], re.M):
        err(f, "missing '- **Status:**' line")
    if not re.search(r"^- \*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}", text[f], re.M):
        err(f, "missing '- **Date:** YYYY-MM-DD' line")
for num, f in adrs.items():
    for later in re.findall(r"Superseded by (?:\[?ADR )?\[?(\d{4})", text[f]):
        if later not in adrs:
            err(f, f"superseded by ADR {later}, which does not exist")
        elif num not in text[adrs[later]]:
            err(adrs[later], f"supersedes ADR {num} but does not mention it")

# 6. CLAUDE.md next to every AGENTS.md
for a in agents:
    c = norm(os.path.join(os.path.dirname(a), "CLAUDE.md"))
    if not os.path.exists(c):
        err(a, f"no sibling {c} containing @AGENTS.md")
    elif open(c, encoding="utf-8").read().strip() != "@AGENTS.md":
        err(c, "must contain exactly @AGENTS.md")

# 7. sizes
for f in files:
    n = text[f].count("\n") + 1
    if f.endswith("AGENTS.md") and n > 100:
        warn(f, f"{n} lines, keep AGENTS.md under 100")
    elif f.startswith("docs/") and f not in GENERIC and not f.startswith("docs/adrs/") and n > 150:
        warn(f, f"{n} lines, split pages past 150")

for e in errors:
    print(f"error  {e}")
for w in warnings:
    print(f"warn   {w}")
print(f"{len(files)} files checked, {len(errors)} errors, {len(warnings)} warnings")
sys.exit(1 if errors else 0)
