# Releasing NetVerse AI

Versioning is [SemVer](https://semver.org); the single source of truth is the
repo-root **`VERSION`** file. Commits use conventional-commit prefixes
(`feat:`, `fix:`, `docs:`, …), which drive the auto-generated CHANGELOG.

## Version bump rules
- `fix:` / `perf:` → **patch** (0.2.0 → 0.2.1)
- `feat:` → **minor** (0.2.0 → 0.3.0)
- `feat!:` / `fix!:` / `BREAKING CHANGE` → **major** (0.2.0 → 1.0.0)

## Cut a release
```bash
scripts/release.sh 0.3.0
```
This bumps `VERSION`, prepends a CHANGELOG section (from
`git <last-tag>..HEAD`), commits `chore(release): v0.3.0`, annotated-tags
`v0.3.0`, then — after you confirm — pushes and creates the GitHub Release
(`gh`). Decline the prompt to keep everything local.

Preview the notes for a range without releasing:
```bash
python3 scripts/gen_changelog.py v0.2.0..HEAD
```

## Deploy
`deployments/deploy.sh` (same script for pre_pod and prod) bakes `VERSION` +
short git SHA + build date into the images (Docker build args → env + OCI
labels).

### Marking the environment (dev / pre_pod / prod)
The deploy stage is a **runtime** setting, not baked into the image — the same
image runs anywhere. Set `APP_ENV` in each host's `backend/.env.docker`:
```
APP_ENV=pre_pod    # on the pre-prod host
APP_ENV=prod       # on the prod host
```
No venv or rebuild change needed. It surfaces in `/api/v1/version` and as a
coloured chip in the UI footer (prod = green, pre_pod = amber, dev = slate).

## What's running where
Every build exposes its identity:
- API: `GET /api/v1/health` and `GET /api/v1/version` →
  `{version, environment, git_sha, build_date}`
- UI: environment chip + version + short SHA in the footer
- Image: `docker inspect <image>` → `org.opencontainers.image.*` labels

Use these to confirm exactly which commit is live on prepod/prod.
