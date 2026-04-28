# Daily Git Workflow Guide

## Setup (One-time for each developer)

### Jacob:
```bash
git checkout feature/jacob-sensos-qty
```

### Tomer:
```bash
git clone https://github.com/yacov88b2-lab/Logivice-invoice-progrem-.git
cd Logivice-invoice-progrem-
git checkout feature/tomer
npm install
```

## Daily Workflow

### Morning (Start of day):
Double-click **`morning-pull.bat`**

This will:
1. Pull the latest code from Test-Main
2. Merge it into your feature branch
3. You now have everyone's latest changes

### During the day:
- Work normally on your feature branch
- Commit as often as you like
- Your commits stay LOCAL (not deployed)

### Evening (End of day):
Double-click **`evening-push.bat`**

This will:
1. Commit any uncommitted changes
2. Merge your branch into Test-Main
3. Push to GitHub
4. Railway (backend) + Netlify (frontend) auto-deploy
5. Switch you back to your feature branch

## Branch Structure

```
main              ← Production (don't touch)
Test-Main         ← Staging/shared branch (auto-deploys)
feature/jacob-*   ← Jacob's work
feature/tomer     ← Tomer's work
```

## Rules
1. **NEVER work directly on Test-Main or main**
2. Always use morning-pull.bat to get latest changes
3. Always use evening-push.bat to share your work
4. If you get a merge conflict, ask for help

## URLs
- **Frontend (staging):** https://logivice-staging.netlify.app
- **Backend (Railway):** https://logivice-api-production.up.railway.app
- **Backend health:** https://logivice-api-production.up.railway.app/api/health
