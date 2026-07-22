#!/usr/bin/env bash
# Cut a release: bump VERSION, update CHANGELOG from conventional commits,
# commit, tag, and (after confirmation) push + create a GitHub Release.
#
# Usage: scripts/release.sh <version>     e.g. scripts/release.sh 0.3.0
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "usage: scripts/release.sh <version>  (e.g. 0.3.0)" >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must be X.Y.Z (SemVer)" >&2
  exit 1
fi

TAG="v$VERSION"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists" >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree not clean; commit or stash first" >&2
  exit 1
fi

LAST_TAG="$(git tag --sort=-creatordate | head -1)"
RANGE="${LAST_TAG:+$LAST_TAG..}HEAD"
DATE="$(date -u +%Y-%m-%d)"
echo "[release] $TAG  range=${RANGE}  date=${DATE}"

CHANGELOG_SECTION="$(python3 scripts/gen_changelog.py "$RANGE")"
export CHANGELOG_SECTION

echo "$VERSION" > VERSION

CHANGELOG_VERSION="$VERSION" CHANGELOG_DATE="$DATE" python3 - <<'PY'
import os, pathlib
version, date, section = os.environ["CHANGELOG_VERSION"], os.environ["CHANGELOG_DATE"], os.environ["CHANGELOG_SECTION"]
p = pathlib.Path("CHANGELOG.md")
text = p.read_text(encoding="utf-8")
marker = "## [Unreleased]"
idx = text.index(marker) + len(marker)
p.write_text(text[:idx] + f"\n\n## [{version}] - {date}\n\n{section}\n" + text[idx:], encoding="utf-8")
PY

git add VERSION CHANGELOG.md
git commit -m "chore(release): $TAG"
git tag -a "$TAG" -m "$TAG"
echo "[release] committed + tagged $TAG locally."
echo
echo "----- release notes -----"
printf '%s\n' "$CHANGELOG_SECTION"
echo "-------------------------"
echo

read -rp "Push $TAG and create the GitHub Release now? [y/N] " ans
if [[ "${ans:-}" =~ ^[Yy]$ ]]; then
  git push origin HEAD
  git push origin "$TAG"
  if command -v gh >/dev/null 2>&1; then
    printf '%s\n' "$CHANGELOG_SECTION" | gh release create "$TAG" --title "$TAG" --notes-file -
    echo "[release] GitHub Release $TAG created."
  else
    echo "[release] pushed; 'gh' not found — create the Release manually." >&2
  fi
else
  echo "[release] left local. To undo: git tag -d $TAG && git reset --hard HEAD~1"
fi
