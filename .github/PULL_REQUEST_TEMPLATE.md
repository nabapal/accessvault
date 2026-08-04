<!-- No direct commits to master — every change lands via this PR. -->

## Summary
<!-- What and why, in 1-3 lines. -->

## Linked spec
<!-- docs/specs/<feature>.md (link). Required for features/behaviour changes. -->

## Type
- [ ] feat
- [ ] fix
- [ ] docs
- [ ] refactor / chore

## Checklist
- [ ] Spec (SDD) added/updated and reflected here
- [ ] Frontend: `npx tsc --noEmit` and `npm run build` pass
- [ ] Backend: imports clean; Alembic **single head** (`alembic heads` → one); migrations additive
- [ ] Verified against real systems where relevant
- [ ] Docs updated in this PR (README, PRODUCT-OVERVIEW, API.md + openapi.json, CHANGELOG)
- [ ] No secrets committed; plaintext credential files removed
