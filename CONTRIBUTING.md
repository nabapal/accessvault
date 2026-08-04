# Contributing to NetVerse AI

Full conventions live in [docs/ENGINEERING-PRACTICES.md](docs/ENGINEERING-PRACTICES.md).
This is the short version.

## Golden rule: no direct commits to `master`
Every change lands via a **pull request**. `master` is always deployable and is
only updated by merging a reviewed PR.

## Workflow
1. **Spec first (SDD).** For a feature/change, add or update the spec in
   `docs/specs/<feature>.md` and get it agreed (Phase 0 → Approved) before coding.
2. **Branch.** `git checkout -b <type>/<short-name>` — `feat/…`, `fix/…`,
   `docs/…`, `refactor/…`, `chore/…`.
3. **Commit.** Conventional-commit messages (`type(scope): summary`), one logical
   change per commit, `Co-Authored-By: …` trailer when AI-assisted.
4. **Verify before pushing:** frontend `npx tsc --noEmit` + `npm run build`;
   backend imports clean + Alembic **single head** (`alembic heads` → one);
   collectors validated against real systems where relevant.
5. **Update docs in the same PR:** README, PRODUCT-OVERVIEW, the feature SDD,
   `docs/API.md` + `docs/openapi.json`, CHANGELOG.
6. **Open a PR:** `git push -u origin <branch>` then `gh pr create`. Fill in the
   PR template. Request review; merge only after approval.
7. **Never commit secrets.** Only `*.example` templates are tracked; delete any
   plaintext credential files after use.

## Releases
Cut from `master` after merge with `scripts/release.sh <x.y.z>` (SemVer:
fix→patch, feat→minor, breaking→major). See
[docs/RELEASING.md](docs/RELEASING.md).
