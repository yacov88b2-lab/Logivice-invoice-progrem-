# Staging-Only Workflow

## Rule: NEVER use localhost. Always use staging URLs.

### Staging URLs:
- **Frontend:** https://logivice-staging.netlify.app
- **Backend API:** https://logivice-api.onrender.com

---

## Daily Workflow

### 1. Start Your Day (Get Latest)
```bash
cd "c:\Dev - New\Windsurff invoice\invoice-processor"
git checkout Test-Main
git pull origin Test-Main
```

### 2. Create Feature Branch (Work Here)
```bash
git checkout -b feature/jacob-what-youre-working-on
# Make your changes...
```

### 3. Push to Staging (Auto-Deploy)
```bash
git add .
git commit -m "Description of your changes"
git push origin feature/jacob-what-youre-working-on
git checkout Test-Main
git merge feature/jacob-what-youre-working-on
git push origin Test-Main
```

### 4. Wait & Test
- Wait 1-2 minutes for deploy
- Go to https://logivice-staging.netlify.app
- Test your changes

---

## For Tomer

**Tell Tomer to tell his AI:**
> "We use ONLY staging environment. Backend is https://logivice-api.onrender.com - never check localhost."

### Tomer's Commands:
```bash
cd "C:\Users\TomerLev\Documents\GitHub\Logivice-invoice-progrem-"
git checkout Test-Main
git pull origin Test-Main

# Create feature branch
git checkout -b feature/tomer-sensos-outbound
# Work...

# Push to staging
git add .
git commit -m "Sensos outbound updates"
git push origin feature/tomer-sensos-outbound
git checkout Test-Main
git merge feature/tomer-sensos-outbound
git push origin Test-Main
```

---

## Check What's on Staging

```bash
git log --oneline origin/Test-Main -10
```

This shows the last 10 commits on staging. If you see both yours and Tomer's commits, staging has both your work.

---

## Emergency: Fix Staging Fast

If staging is broken and you need to test:
```bash
git checkout Test-Main
git pull origin Test-Main
# Make quick fix
git add .
git commit -m "Quick fix"
git push origin Test-Main
# Wait 1 minute, test on staging
```
