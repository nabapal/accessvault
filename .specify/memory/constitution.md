# NetVerse AI Constitution

Governing principles for spec-driven development in this repo (product: **NetVerse AI**;
repo/package: `accessvault`). These bind every `/speckit-*` workflow. They restate and
are kept consistent with [docs/ENGINEERING-PRACTICES.md](../../docs/ENGINEERING-PRACTICES.md),
which remains the human-readable source of truth.

## Core Principles

### I. Phase-0 Live-Data Validation (NON-NEGOTIABLE)
No design and no code before the target systems are probed and their **real data
validated**. Every spec MUST begin with a Phase-0 that queries the live systems it
touches (vCenter/APIC/A10/F5/CPNR/ISE/Nautobot/DB) and records the *actual* response
shapes, counts, and edge cases observed — not assumptions or vendor-doc guesses.
Design decisions cite the probed evidence. A feature is not `Implemented` until it is
**verified against live data** and acceptance criteria are met on real systems. If a
system cannot be reached, that is a blocker to resolve — never a reason to proceed on
assumption.

### II. SDD-First, One Spec per Feature
No code without an approved spec. Each feature has a spec covering Summary · Motivation ·
**Phase 0 (live probe)** · Design · Resolved decisions · Acceptance · Test · Edge cases ·
Phases · Rollout. Status flows Draft → Approved → Implemented; open decisions are resolved
before building. Deliver in phases, committing per phase. (Spec Kit specs under `specs/`
and the native SDDs under `docs/specs/` both satisfy this — do not fork the intent.)

### III. PR-Only; master Stays Deployable
Never commit directly to `master`. Work on a short-lived branch (`feat/`, `fix/`,
`docs/`, `chore/`), open a PR, and merge only after review. `git pull --rebase` before
pushing (sessions push concurrently). Conventional commits (`type(scope): summary`).
**Docs are updated in the same PR as the code** — never deferred.

### IV. Read-Only, Idempotent, Resilient Collection
Collectors are **read-only and least-privilege**; per-device credentials are stored
**Fernet-encrypted** and never logged. Collection is **idempotent**: upsert + delete-not-seen
keyed on natural keys (never server-local IDs). Background pollers are **config-gated**
(`*_poller_enabled`), interval-gated, per-device isolated, and survive transient
per-tick failures without dropping good data. A failed poll never overwrites good data.

### V. Additive Migrations, Traceable Releases
Alembic keeps **one linear head**; migrations are additive/non-destructive (nullable
columns, new tables) and auto-apply at startup and on deploy. Back up the prod DB before
every deploy. Versioning is **SemVer** via the root `VERSION` file (`fix`/`perf`→patch,
`feat`→minor, breaking→major). **Every feature/fix PR bumps `VERSION` and — when the API
surface changes — regenerates `docs/openapi.json`, in the same PR**, so `VERSION` and the
OpenAPI snapshot always track merged state. `release.sh` then cuts at the current
`VERSION`. The running build self-identifies (`/health`, `/version`); a tag == a known
deployable state.

## Quality Gates (before every commit)

- Frontend: `npx tsc --noEmit` and `npm run build` pass.
- Backend: imports clean; `alembic` resolves to a **single head**; migrations additive.
- Behaviour verified against **live systems** where relevant; acceptance criteria met.
- **`VERSION` bumped per SemVer in the same PR**; `docs/openapi.json` regenerated when the
  API surface changes.
- Docs updated in-PR: README, PRODUCT-OVERVIEW (per module), the feature spec, `docs/API.md`
  + regenerated `docs/openapi.json`, and CHANGELOG.

## Development Workflow

Phase-0 live probe → spec (Approved) → phased implementation on a branch → quality gates →
live verification → PR (docs included) → merge → tag/release when cutting a deployable state.
New IPSE service modules follow the CGNAT/CPNR pattern (probe → SDD → encrypted onboarding →
REST/SSH collector → resilient poller → Summary/List/Detail/Admin UI → docs → verify live).

## Governance

This constitution binds all `/speckit-*` runs and coexists with — does not replace —
[docs/ENGINEERING-PRACTICES.md](../../docs/ENGINEERING-PRACTICES.md); if the two ever
diverge, reconcile them in a single PR. Amendments are made by PR that updates both this
file and ENGINEERING-PRACTICES together, with the version bumped below. Every PR/review
verifies compliance; unjustified complexity is rejected (prefer the simplest design that
meets the probed requirements).

**Version**: 1.0.0 | **Ratified**: 2026-08-07 | **Last Amended**: 2026-08-07
