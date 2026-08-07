# NetVerse AI — Engineering Practices

Conventions for version control, change control, docs, releases, and deploys.

## 1. Version control (git)
- **Conventional commits**: `type(scope): summary` — `feat` / `fix` / `docs` /
  `refactor` / `chore` / `perf`. This drives the auto-generated CHANGELOG.
- **One logical change per commit**; end messages with the
  `Co-Authored-By: Claude Opus 4.8 …` trailer when AI-assisted.
- **Always use a pull request — never commit directly to `master`.** Create a
  short-lived branch (`feat/…`, `fix/…`, `docs/…`), push it, and open a PR
  (`gh pr create`); `master` is updated only by merging the reviewed PR and
  stays deployable. `git pull --rebase` before pushing (multiple sessions push
  concurrently). See [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Update the docs in the same PR as the code** — README, PRODUCT-OVERVIEW, the
  feature SDD in `docs/specs/`, API.md + `openapi.json`, and CHANGELOG — not later.
- **Never commit secrets.** `.env*`, local DBs, logs, venvs are gitignored; only
  `*.env.example` templates are tracked. Delete plaintext credential files
  (e.g. `cpnr_vms.json`) after use — creds are stored Fernet-encrypted in the DB.

## 2. Versioning (SemVer)
- **`VERSION` file** at repo root is the single source of truth.
- Bump rule: `fix`/`perf` → **patch**, `feat` → **minor**, breaking → **major**.
- **Bump `VERSION` in the same PR as the change** (not only at release), so
  `VERSION` always reflects the latest merged state. When an API surface changes,
  **regenerate `docs/openapi.json` in that same PR** (see §5). Feature/fix and its
  version bump + OpenAPI snapshot land together — never as a follow-up.
- The running build self-identifies: `GET /api/v1/health` and `/version` →
  `{version, environment, git_sha, build_date}`; version shows in the UI footer.
- Version + git SHA + build date are baked into the container at build time
  (Docker build args → env + OCI labels).

## 3. Tags & releases
- Because PRs already bump `VERSION`, **`scripts/release.sh <x.y.z>` cuts a release
  at the current `VERSION`** (pass the value already in the file): it rolls the
  `[Unreleased]` CHANGELOG section under `vX.Y.Z`, commits `chore(release): vX.Y.Z`,
  annotated-tags, then (on confirm) pushes and creates the **GitHub Release**. It
  does not invent a new number — the per-PR bumps already did.
- **A tag == a deployable, known state.** Deploy tagged releases, not arbitrary
  `master`, so you always know exactly what's on prepod/prod.
- Notes format: [Keep a Changelog](https://keepachangelog.com) in `CHANGELOG.md`.

## 4. Change control (SDD-first)
- **No code without an SDD** in `docs/specs/<feature>.md`. This is the core rule.
- SDD sections: Summary · Motivation · **Phase 0 (probe live systems first)** ·
  Design · Resolved decisions · Acceptance · Test · Edge cases · Phases · Rollout.
- Status lifecycle: **Draft → Approved → Implemented**; resolve open decisions
  before building.
- **Verify against live data** before marking Implemented. Deliver in **phases**,
  commit per phase.

## 5. Documentation (update with the feature, not later)
- **README** (feature list, endpoints, onboarding) + **PRODUCT-OVERVIEW** per new
  module.
- **SDD** per feature in `docs/specs/`.
- **API**: live Swagger `/docs` + ReDoc `/redoc` are authoritative; `docs/API.md`
  guide + committed `docs/openapi.json` snapshot (regenerate at release).
- **CHANGELOG** (auto), **RELEASING.md**, this file.

## 6. Testing & verification (before every commit)
- Frontend: `npx tsc --noEmit` + `npm run build` must pass.
- Backend: imports clean; **Alembic single head applies**.
- Collectors verified against **live systems**; acceptance criteria met.

## 7. Database & migrations
- **Alembic**, one linear head; migrations **additive / non-destructive**
  (nullable columns, new tables); auto-applied at startup + by `deploy.sh`.
- Collectors are **idempotent**: upsert + delete-not-seen; natural keys, not
  server-local IDs.
- **Back up the prod DB before every deploy.**

## 8. Deployment
- `deployments/deploy.sh` (build-from-source): git pull → build (bakes version/
  sha/date) → `alembic upgrade head` → seed admin.
- **`APP_ENV`** per host in `backend/.env.docker` (`dev`/`pre_pod`/`prod`) — same
  image/script everywhere; shows as the UI footer chip.
- Runbook: back up DB → deploy in a maintenance window → verify `/api/v1/version`
  (correct version + env) after.

## 9. Security
- **Per-device encrypted credentials** (Fernet); secrets never logged.
- Collection is **read-only, least-privilege**; rotate any leaked credential.
- RBAC: admin-only for create/update/delete/sync/test.
- Background pollers are **config-gated** (`*_poller_enabled`).

## 10. Adding a new IPSE service module (the pattern)
Follow the CGNAT/CPNR template: Phase-0 probe → SDD → per-device onboarding with
encrypted creds → REST/SSH collector → resilient poller (config-gated, per-device
isolation) → Summary / List / Detail / Admin UI → docs + endpoints → verify live
→ release.
