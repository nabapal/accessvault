# Versioning & Releases

- **Feature:** SemVer versioning, build traceability, auto-generated CHANGELOG, and GitHub Releases.
- **Status:** Implemented (Tiers 1–3) — backend import + tsc/build clean; first tag cut via scripts/release.sh
- **Date:** 2026-07-17

## 1. Summary
Introduce a single version source, bake build metadata into the containers,
expose it at runtime (API + UI footer), auto-generate a CHANGELOG from the
existing conventional commits, and cut tagged GitHub Releases. No CI required —
fits the current build-from-source deploy (`deployments/deploy.sh`).

## 2. Motivation
Today there are no tags, no CHANGELOG, no VERSION, the API version is the
hardcoded default `0.1.0`, and images carry no build metadata — so **there is
no way to tell what version/commit is running** on prepod/prod. Commits already
follow conventional-commit style, which makes changelog automation trivial.

## 3. Phase 0 (verified)
- `gh` CLI present (2.81.0) → use for GitHub Releases.
- `git-cliff` absent → use a small self-contained generator (git log +
  conventional-commit parse), no new binary dependency.
- `settings.app_name` exists; no version field. `main.py` includes `api_router`
  under `settings.api_v1_prefix`; no health/version route. Dockerfiles have no
  build ARGs. `docker-compose.yml` build blocks have no `args`. AppShell has no
  footer.

## 4. Design
### Tier 1 — Traceability
- **`VERSION`** file at repo root = SemVer (start `0.2.0`), single source of truth.
- **Backend:** `settings.app_version` resolves from `APP_VERSION` env, else the
  `VERSION` file, else `0.0.0-dev`; plus `git_sha` (`GIT_SHA` env, default `dev`)
  and `build_date` (`BUILD_DATE` env). `FastAPI(version=…)`. New
  `GET {api_v1}/health` → `{status:"ok", name, version, git_sha, build_date}`
  and `GET {api_v1}/version` (same payload).
- **Docker:** both Dockerfiles take `ARG VERSION/GIT_SHA/BUILD_DATE`, set them as
  `ENV APP_VERSION/GIT_SHA/BUILD_DATE`, and add OCI `LABEL`s.
- **compose:** build `args` map from `${VERSION}/${GIT_SHA}/${BUILD_DATE}`.
- **deploy.sh:** compute + export `VERSION=$(cat VERSION)`,
  `GIT_SHA=$(git rev-parse --short HEAD)`, `BUILD_DATE=$(date -u +%FT%TZ)` before
  `compose up --build`.
- **Frontend:** footer in AppShell fetches `{api}/version` and shows
  `NetVerse AI v<version> (<git_sha>)`. Single source; no rebuild to change.

### Tier 2 — CHANGELOG
- `CHANGELOG.md` in Keep-a-Changelog format.
- `scripts/gen_changelog.py`: parse `git log <range>` conventional commits,
  group by type (Features/Fixes/Docs/Refactor/Other), emit a version section.
  Seed the initial file from full history.

### Tier 3 — Tags + GitHub Releases
- `scripts/release.sh <version>`: validate clean tree; write `VERSION`;
  regenerate CHANGELOG section for the range since the last tag; commit
  (`chore(release): v<version>`); annotated tag `v<version>`; push; then
  `gh release create v<version>` with the section as notes.
- `docs/RELEASING.md`: the process + SemVer bump rules (feat→minor, fix→patch,
  breaking→major).

## 5. Acceptance criteria
- `GET /api/v1/health` and `/version` return version + git_sha + build_date.
- A freshly built image reports the deploy's VERSION/SHA/date (env-baked); local
  dev falls back to the VERSION file + `dev`.
- UI footer shows the running version + short SHA.
- `scripts/release.sh 0.2.0` produces a commit, tag `v0.2.0`, CHANGELOG section,
  and a GitHub Release.

## 6. Test / verification
- Backend imports + `/version` returns expected JSON locally (VERSION fallback).
- `docker compose build` with args → `docker inspect` shows LABELs; container
  env has APP_VERSION/GIT_SHA/BUILD_DATE.
- `gen_changelog.py` on a known range yields grouped entries.
- `tsc` + `npm run build` clean.

## 7. Resolved decisions
- Scope: Tiers 1–3 (no CI/registry — Tier 4 deferred).
- Changelog tooling: self-contained script (no git-cliff dependency).
- Starting version: `0.2.0` (pre-1.0; adjustable).
- Health/version under `/api/v1` (nginx proxies it; no separate root route).

## 8. Rollout
- Additive; no DB/migration. Ships with next build. First release tag cut with
  `scripts/release.sh 0.2.0` after merge.
