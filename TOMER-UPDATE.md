# Update for Tomer — 2026-04-30

Hi Tomer,

We did a major stabilization pass on the project today. Here is what changed and what you need to do.

## What changed

### Backend is now on Railway (not Render)
- Staging frontend now calls Railway: `https://logivice-api-production.up.railway.app`
- All data (DB, pricelist files, generated invoices) now persists across deployments
- This fixes the bug where uploaded pricelists and invoices disappeared after every deploy

### Dead files were removed
The following were deleted from the repo (they were unused):
- `temp_qtyfiller.ts` and `temp_qtyfiller_old.ts` (temp copies, not the real file)
- `SHAREPOINT_SETUP.md` (SharePoint integration was removed long ago)
- `STAGING_WORKFLOW.md` (outdated, replaced by `WORKFLOW-GUIDE.md`)
- Old generated Excel files from `uploads/` folder
- Redundant bat scripts (kept only: `morning-pull.bat`, `evening-push.bat`)
- Vite scaffold leftover files (`src/counter.ts`, `src/main.ts`)

### Your billing rules are untouched
**Nothing was changed in `server/services/qtyFiller.ts`.**
Your Afimilk and AVT billing logic is exactly as you left it.

### Tests added
22 automated tests now run on every push to Test-Main.
Run them locally with: `npm test`

### Health endpoint improved
`https://logivice-api-production.up.railway.app/api/health`
Now returns the deployed commit hash, storage paths, and environment — useful for verifying what is live.

---

## What you need to do

### Step 1 — Pull the latest Test-Main into your branch
```bash
git checkout feature/tomer
git pull origin Test-Main
npm install
```
Run `npm install` because new packages were added (Vitest for testing).

### Step 2 — Resolve any merge conflicts
The only files that changed in your area are:
- `server/routes/tableau.ts` — minor fix, should auto-merge cleanly
- `server/server.ts` — health endpoint update, should auto-merge cleanly
- `package.json` — new test scripts added, may need manual merge

If you get a conflict in `package.json`, keep both sets of scripts and run `npm install` again.

### Step 3 — Re-upload your customer pricelist templates
Because the backend switched from Render to Railway, the Railway DB starts fresh.
Go to `https://logivice-staging.netlify.app` → Admin → Upload New Pricelist and re-upload:
- Afimilk NZ template
- AVT HKG template

These will now persist across all future deploys.

### Step 4 — Verify your work still functions
1. Go to staging, select your customer, pick a date range
2. Click Preview Mapping — confirm transactions load
3. Click Generate Invoice — confirm it generates
4. Click Download — confirm the Excel downloads correctly

---

## Going forward — per-customer rules ownership

We are planning (Phase 8) to split `qtyFiller.ts` into separate files per customer so we don't conflict:
```
server/rules/
  sensos.ts     ← Jacob owns
  afimilk.ts    ← Tomer owns
  avt.ts        ← Tomer owns
```

Until then: **do not edit Sensos sections** in `qtyFiller.ts`, and Jacob will not touch Afimilk/AVT sections.

---

## Key URLs

| What | URL |
|---|---|
| Staging app | https://logivice-staging.netlify.app |
| Backend health | https://logivice-api-production.up.railway.app/api/health |
| GitHub repo | https://github.com/yacov88b2-lab/Logivice-invoice-progrem- |

Questions? Ask Jacob.
