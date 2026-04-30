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

## Per-Customer Billing Rules
Each customer's billing logic lives in `server/services/qtyFiller.ts`.
- **Jacob** owns: Sensos NL rules
- **Tomer** owns: Afimilk NZ, AVT HKG rules
- Do not edit another developer's customer section without coordinating first
- Phase 8 will split these into separate files per customer
