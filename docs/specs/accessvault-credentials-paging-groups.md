# AccessVault — Credentials table pagination + Groups placement

- **Feature:** Paginate the AccessVault systems/credentials table and relocate the Groups panel to the top of the left rail.
- **Status:** Implemented — tsc + build clean
- **Module:** AccessVault (credential management)
- **Date:** 2026-07-17

## 1. Summary
Two UI fixes on the AccessVault page (`AccessVaultPage` in
[frontend/src/pages/DashboardPage.tsx](../../frontend/src/pages/DashboardPage.tsx)):
1. Add client-side pagination to the systems/credentials table.
2. Groups panel stays at the **bottom** of the left navigation rail (below the
   module navigation) — pagination keeps the systems table short so the groups
   are no longer pushed far down the page.

## 2. Motivation
- The credentials table ([SystemTable.tsx](../../frontend/src/components/systems/SystemTable.tsx))
  renders every system via a plain `.map()` — with many systems the list grows
  unbounded and there is no paging.
- The Groups list is passed to `Sidebar` as `extraContent` and rendered *after*
  all navigation sections ([Sidebar.tsx:159](../../frontend/src/components/layout/Sidebar.tsx#L159)),
  so it appears far down the page and is easy to miss.

## 3. Phase 0 — current behaviour (verified)
- `AccessVaultPage` renders `SystemFilters` + an "AccessVault Systems" panel
  containing `SystemTable systems={systems}`; no page state.
- `SystemTable` maps all `systems` into `<tbody>` rows; no pagination controls.
- `AppShell(sidebarContent=sidebar)` → `Sidebar(extraContent=sidebar)`. The
  sidebar content = `GroupList` + "Add System" button. In `Sidebar.tsx` the
  `<nav>` (module sections) renders first, then
  `{extraContent && !isCollapsed ? <div className="mt-6 border-t …">…</div>}`
  at the bottom.
- Only `AccessVaultPage` passes `sidebarContent`; all other pages call
  `AppShell` without it — so a Sidebar change here affects only AccessVault.
- The existing paginated tables (VM Center, device tables) use a 10/25/50 rows
  selector + Prev/Next + "Page X of Y" — the pattern to match.

## 4. Design — resolved decisions (§7)
### 4a. Pagination (credentials table)
- Client-side pagination in `AccessVaultPage` over the already-fetched
  `systems` array (same approach as `VirtualMachinesPage`).
- `PAGE_SIZE_OPTIONS = [10, 25, 50]`, default **10**.
- Controls under the table: rows-per-page selector, `Prev` / `Next`,
  `Page X of Y`, and a "Showing a-b of N" caption.
- Reset to page 1 when the group filter / search / access filter changes.
- Clamp current page when the filtered count shrinks (e.g. after delete).
- Implementation: keep `SystemTable` presentational; slice the array in
  `AccessVaultPage` and pass the page slice + render controls in the panel
  (mirrors VM Center), OR add optional pagination props to `SystemTable`.
  Prefer slicing in the page to keep `SystemTable` unchanged.

### 4b. Groups placement
- Groups panel stays at the **bottom** of the left rail (existing
  `extraContent` position in `Sidebar.tsx`, below `<nav>`). No layout change —
  pagination alone resolves the "groups pushed too far down" symptom by
  bounding the systems table height.
- No change to `GroupList` behaviour.

## 5. Acceptance criteria
- Credentials table shows at most `pageSize` rows; selector switches 10/25/50.
- Prev/Next + "Page X of Y" + "Showing a-b of N" work and disable at bounds.
- Changing group/search/access filter resets to page 1; deleting the last row
  on a page does not strand the user on an empty page.
- Groups panel appears at the top of the left rail, above module nav; group
  selection still filters the table; collapse hides it as before.
- No other page's sidebar layout changes.

## 6. Test / verification
- `npx tsc --noEmit` + `npm run build` clean.
- Manual: seed >10 systems in a group, verify paging math and filter resets;
  verify group click filters + resets to page 1; verify collapse behaviour;
  spot-check another module page's sidebar is unchanged.

## 7. Resolved decisions
- **Groups placement:** Left rail, **bottom** (unchanged) — pagination bounds
  the table so groups are no longer pushed down.
- **Page size:** 10 / 25 / 50 selector, default 10, Prev/Next + Page X of Y
  (matches VM Center).

## 8. Rollout
- Frontend-only; no API, schema, or migration changes. Ships with the next
  frontend build/deploy.
