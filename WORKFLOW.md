# Logivice Development Workflow

## 🎯 Goal
Clean, protected workflow for Jacob and Tomer to collaborate without breaking production.

---

## 📋 Rules

### 1. **All Development on Test-Main ONLY**
```bash
# CORRECT
git checkout Test-Main
# make changes
git add .
git commit -m "Your changes"
git push origin Test-Main

# INCORRECT ❌
git checkout main  # Never commit directly to main!
git commit -m "Changes"  # Don't do this!
```

### 2. **Pre-Commit Tests Run Automatically**
Before every commit, the following checks run:
- ✅ Must be on `Test-Main` branch (warning if not)
- ✅ TypeScript compilation (`npx tsc --noEmit`)
- ✅ No merge conflict markers (`<<<<<<<`)

**If tests fail, commit is blocked!**

### 3. **Only Jacob & Tomer Can Deploy to Production**
- Use the **🚀 Deploy to Production** button in Admin panel
- This merges Test-Main → Main and pushes to GitHub
- Production site auto-deploys from Main

---

## 🔄 Daily Workflow

### For Both Developers (Jacob & Tomer):

```bash
# 1. Start of day - sync latest
cd "c:\Dev - New\Windsurff invoice\invoice-processor"
git checkout Test-Main
git pull origin Test-Main

# 2. Run local dev server
npm run dev
# Frontend: http://localhost:5173
# Backend: http://localhost:3001

# 3. Make your changes...
# ... edit files ...

# 4. Pre-commit tests run automatically
# If TypeScript compilation fails, fix errors first!
git add .
git commit -m "Description of changes"
# ✅ Tests pass → commit succeeds
# ❌ Tests fail → commit blocked

git push origin Test-Main
# Auto-deploys to staging: https://logivice-staging.netlify.app
```

### Deploy to Production (After Testing):

```bash
# Test on staging first:
# https://logivice-staging.netlify.app

# Then click button in Admin panel:
# 🚀 Deploy to Production
# This merges Test-Main → Main

# Or manually:
git checkout main
git merge Test-Main --no-edit
git push origin main
git checkout Test-Main  # Switch back for more work
```

---

## 🌐 Environments

| Environment | Branch | URL | Purpose |
|------------|--------|-----|---------|
| **Local Dev** | Test-Main | localhost:5173 | Development |
| **Staging** | Test-Main | https://logivice-staging.netlify.app | Testing |
| **Production** | Main | https://logivice-prod.netlify.app | Live |

---

## 🛡️ Branch Protection (GitHub Settings)

**Required GitHub Settings:**

1. Go to: https://github.com/yacov88b2-lab/Logivice-invoice-progrem-/settings/branches
2. Add rule for `main`:
   - ☑️ Require pull request reviews before merging
   - ☑️ Require status checks to pass
   - ☑️ Restrict pushes that create files larger than 100MB
   - ☑️ Allow force pushes (with lease)
   - ☑️ Allow deletions
3. Add rule for `Test-Main`:
   - ☑️ Restrict who can push to matching branches
   - Add: `yacov88b2-lab` (Jacob) and `TomerLev42` (Tomer)

---

## 🔧 Troubleshooting

### "Commit blocked - TypeScript errors"
```bash
# Fix TypeScript errors
npx tsc --noEmit
# Fix shown errors, then commit again
```

### "Merge conflict markers found"
```bash
# Search for conflicts
grep -r "^<<<<<<<" --include="*.ts" --include="*.tsx" .
# Edit files to resolve conflicts
# Then commit again
```

### "Not on Test-Main branch"
```bash
git checkout Test-Main
git stash pop  # If you stashed changes
```

### Need to bypass pre-commit (emergency only)
```bash
git commit -m "Emergency fix" --no-verify
# ⚠️ Use only in emergencies! Skips all tests!
```

---

## 📁 File Structure

```
invoice-processor/
├── server/
│   ├── routes/
│   │   ├── deploy.ts          # Deploy API endpoint
│   │   └── ...
│   └── server.ts
├── src/
│   └── components/
│       └── admin/
│           └── PricelistManager.tsx  # Deploy button UI
├── .git/hooks/
│   ├── pre-commit              # Unix pre-commit hook
│   └── pre-commit.bat          # Windows pre-commit hook
├── WORKFLOW.md                 # This file
└── README.md
```

---

## 🚀 Deploy Button Features

- Shows only when Test-Main is ahead of Main
- Displays count of pending commits
- Confirmation dialog before deploying
- Loading state during deployment
- Success/error banners after deployment

---

## ✅ Checklist Before Deploying

- [ ] Tested on staging (https://logivice-staging.netlify.app)
- [ ] All features working
- [ ] No console errors
- [ ] TypeScript compilation passes
- [ ] Tomer reviewed (if his code involved)

---

**Questions?** Check Git history or ask in chat.
