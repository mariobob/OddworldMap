#!/usr/bin/env python3
"""
Draft "What's New" entries from git history for changelog.json.

Reads the commit log, drops obvious internal churn (refactors, tooling,
CI, docs) and prints a curation draft: a ready-to-paste JSON stub per
surviving commit, with the full commit message shown above it as context.

  python3 changelog.py                 # commits newer than the newest changelog.json date
  python3 changelog.py --since 27a94af  # commits after a revision
  python3 changelog.py --since 2026-07-15   # commits on/after a date

This prints a DRAFT to stdout; it never writes changelog.json. Copy the
good entries in, rewrite the titles as player-facing headlines, and fill
in each "detail" from the commit context. The commit messages themselves
are authoring aids and are never shipped.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent          # tools/
ROOT = HERE.parent                              # repo root (the static site)

# git log record: hash, short date, subject, body, separated by 0x1f, record-terminated by 0x1e
FMT = "%H%x1f%ad%x1f%s%x1f%b%x1e"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PREFIX_RE = re.compile(r"^[A-Z][A-Za-z0-9]+: +")   # "Search: ", "Ruler: " → stripped from titles
TRAILER_RE = re.compile(r"^(Co-authored-by|Signed-off-by|Reviewed-by|Change-Id):", re.I)

# internal commits that should not reach players
NOISE_PREFIXES = ("Builder:", "cam2rgba:", "README:")
NOISE_LEADING = {"Extract", "Move", "Rename", "Bump"}
NOISE_CONTAINS = ("refactor", "eslint", "unit test", "test suite", "claude.md",
                  "license", "static.yml", "ci.yml")

def is_noise(subject):
    if subject.startswith(NOISE_PREFIXES):
        return True
    if subject.split(None, 1)[0] in NOISE_LEADING:
        return True
    s = subject.lower()
    return any(k in s for k in NOISE_CONTAINS)

def clean_title(subject):
    t = PREFIX_RE.sub("", subject).strip()
    return t[:1].upper() + t[1:] if t else subject

def guess_tag(subject):
    s = subject.lower()
    if s.startswith(("fix", "guard")) or " fix" in s:
        return "fixed"
    if s.startswith(("add", "support", "introduce", "new")):
        return "new"
    return "improved"

def clean_body(body):
    lines = [ln.rstrip() for ln in body.splitlines() if not TRAILER_RE.match(ln)]
    while lines and not lines[-1].strip():
        lines.pop()
    return lines

def newest_date(changelog):
    try:
        entries = json.loads(changelog.read_text())["entries"]
        return max((e["date"] for e in entries), default=None)
    except (OSError, ValueError, KeyError):
        return None

def git_log(range_args):
    out = subprocess.run(["git", "log", "--no-merges", "--date=short", f"--format={FMT}", *range_args],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        h, date, subject, body = rec.split("\x1f", 3)
        yield h, date, subject, body

def main():
    ap = argparse.ArgumentParser(description="Draft What's New entries for changelog.json from git history.")
    ap.add_argument("--since", help="revision (commits after it) or YYYY-MM-DD (commits on/after it). "
                                     "Default: newer than the newest changelog.json date, else the last N commits.")
    ap.add_argument("--limit", type=int, default=30, help="how many recent commits to scan when --since is unset "
                                                          "and changelog.json is empty (default 30)")
    ap.add_argument("--changelog", default=str(ROOT / "changelog.json"), help="changelog.json used for the default --since")
    args = ap.parse_args()

    if args.since:
        range_args = ["--since", args.since] if DATE_RE.match(args.since) else [f"{args.since}..HEAD"]
    elif (since := newest_date(Path(args.changelog))):
        range_args = ["--since", since]
    else:
        range_args = ["-n", str(args.limit)]

    kept, filtered = [], 0
    for h, date, subject, body in git_log(range_args):
        if is_noise(subject):
            filtered += 1
            continue
        kept.append((h, date, subject, body))

    if not kept:
        print(f"# No candidate commits in range ({filtered} filtered as internal). Nothing to draft.")
        return

    print(f"# {len(kept)} candidate entries drafted from git ({filtered} internal commits filtered).")
    print("# Curate into changelog.json: rewrite titles as player-facing headlines, fill in each 'detail',")
    print("# drop anything not worth announcing. The commit context below each stub is NOT shipped.\n")
    for h, date, subject, body in kept:
        print("# " + "─" * 62)
        print(f"# {date}  {h[:7]}  {subject}")
        for ln in clean_body(body):
            print(f"#   {ln}" if ln else "#")
        print()
        entry = {"date": date, "tag": guess_tag(subject), "title": clean_title(subject), "detail": ""}
        print(json.dumps(entry, indent=1) + ",\n")

if __name__ == "__main__":
    main()
