# Logivice Invoice Processor — Developer Workflow Guide

Last updated: 2026-04-30

## Environments

| Layer | URL | Platform |
|---|---|---|
| Frontend (staging) | https://logivice-staging.netlify.app | Netlify |
| Backend (staging + prod) | https://logivice-api-production.up.railway.app | Railway |
| Health + diagnostics | https://logivice-api-production.up.railway.app/api/health | Railway |

## Storage (Railway persistent volume)
All data survives deployments:
- DB: `/app/data/database.sqlite`
- Pricelist templates: `/app/data/uploads/pricelists/`
- Generated invoices: `/app/data/uploads/generated/`

## Branch Structure

```
main              ← Production (don't touch directly)
Test-Main         ← Staging — auto-deploys to Railway + Netlify on push
feature/jacob-*   ← Jacob's work
feature/tomer     ← Tomer's work
```

## Setup (One-time per developer)

### Jacob:
```bash
git checkout feature/jacob-sensos-qty
```

### Tomer:
```bash
git checkout feature/tomer
git pull origin Test-Main
npm install
```

## Daily Workflow

### Morning (start of day):
Double-click **`morning-pull.bat`**

This will:
1. Pull the latest code from Test-Main
2. Merge it into your feature branch
3. You now have everyone's latest changes

### During the day:
- Work on your feature branch only
- Commit as often as you like
- Commits stay local until evening push

### Evening (end of day):
Double-click **`evening-push.bat`**

This will:
1. Commit any uncommitted changes
2. Merge your branch into Test-Main
3. Push to GitHub → Railway + Netlify auto-deploy

## Rules
1. **NEVER work directly on Test-Main or main**
2. Always run morning-pull.bat to get latest changes before starting
3. Always run evening-push.bat to share your work
4. Each developer owns their customer's billing rules file (see Phase 8)
5. If you get a merge conflict, ask for help

## Running Tests
```bash
npm test
```
22 tests covering: DataMapper, TemplateAnalyzer, Tableau date parsing, live health endpoints.

## Verifying a Deployment
Hit the health endpoint to confirm what is deployed:
```
https://logivice-api-production.up.railway.app/api/health
```
Returns: commit hash, storage paths, environment name.

## Adding a New Customer

### Step 1 — Upload the template (always required)
Go to Admin UI → Upload New Pricelist → upload the customer's Excel template.
The app automatically reads: segment, clause, category, UOM, rate columns.
**No code needed for standard templates.**

### Step 2 — Does the customer need custom rules?
Ask: does the standard flow produce correct quantities?
- **Yes → done.** No code needed.
- **No → create a customer rule file** (see below).

Custom rules are needed when a customer has special billing logic, for example:
- Quantity = distinct order count (not raw row count)
- Storage = max pallet × sqm formula
- Template must preserve styles/formulas (XML patching required)
- Sheet names must be renamed by billing period

### Step 3 — Creating a customer rule file (only if needed)
1. Create `server/rules/<customername>.ts`
2. Import only from `server/rules/_base.ts` — never from another customer's file
3. Register the customer name in `server/rules/index.ts`
4. Write tests in `server/tests/`

**Rule: one customer = one file. Changes in that file cannot affect any other customer.**
Any developer can create or edit any customer file.

## Per-Customer Rule Files (current)
```
server/rules/
  _base.ts      ← shared utilities (no customer logic)
  afimilk.ts    ← Afimilk NZ billing rules
  sensos.ts     ← Sensos NL billing rules
  index.ts      ← reads customer name → calls right rule file
```
To add a new customer with custom logic: add `<customer>.ts` + one line in `index.ts`.
