#!/usr/bin/env python3
"""Generate a CHANGELOG section from conventional commits in a git range.

Usage:
  python scripts/gen_changelog.py [<git-range>]      # section body to stdout
  python scripts/gen_changelog.py v0.1.0..HEAD

With no range, uses <last-tag>..HEAD, or the full history if there are no tags.
No third-party dependencies.
"""
from __future__ import annotations

import re
import subprocess
import sys

# Conventional-commit type -> section heading (ordered).
SECTIONS = [
    ("feat", "Features"),
    ("fix", "Fixes"),
    ("perf", "Performance"),
    ("refactor", "Refactoring"),
    ("docs", "Documentation"),
    ("test", "Tests"),
    ("build", "Build"),
    ("ci", "CI"),
    ("chore", "Chores"),
]
_TYPE_RE = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[^)]+)\))?(?P<bang>!)?:\s*(?P<desc>.+)$")


def _sh(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()


def _default_range() -> str:
    tags = _sh("tag", "--sort=-creatordate").splitlines()
    return f"{tags[0]}..HEAD" if tags else "HEAD"


def build_section(rng: str) -> str:
    log = _sh("log", "--no-merges", "--pretty=format:%s%x1e", rng)
    subjects = [s.strip() for s in log.split("\x1e") if s.strip()]
    buckets: dict[str, list[str]] = {key: [] for key, _ in SECTIONS}
    breaking: list[str] = []
    other: list[str] = []
    for subj in subjects:
        m = _TYPE_RE.match(subj)
        if not m:
            other.append(subj)
            continue
        entry = f"{m.group('scope')}: {m.group('desc')}" if m.group("scope") else m.group("desc")
        if m.group("bang"):
            breaking.append(entry)
        if m.group("type") in buckets:
            buckets[m.group("type")].append(entry)
        else:
            other.append(m.group("desc"))
    out: list[str] = []
    if breaking:
        out.append("### ⚠ BREAKING CHANGES")
        out += [f"- {e}" for e in breaking]
        out.append("")
    for key, heading in SECTIONS:
        if buckets[key]:
            out.append(f"### {heading}")
            out += [f"- {e}" for e in buckets[key]]
            out.append("")
    if other:
        out.append("### Other")
        out += [f"- {e}" for e in other]
        out.append("")
    return "\n".join(out).rstrip() + "\n" if out else "_No notable changes._\n"


if __name__ == "__main__":
    rng = sys.argv[1] if len(sys.argv) > 1 else _default_range()
    sys.stdout.write(build_section(rng))
