import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execAsync = promisify(exec);

// Check if Test-Main has commits ahead of main
router.get('/status', async (req, res) => {
  try {
    await execAsync('git fetch origin');
    const { stdout } = await execAsync('git rev-list origin/main..origin/Test-Main --oneline');
    const commits = stdout.trim().split('\n').filter(Boolean);
    res.json({
      canDeploy: commits.length > 0,
      commitsBehind: commits.length,
      pendingCommits: commits
    });
  } catch (error) {
    res.json({ canDeploy: false, commitsBehind: 0, pendingCommits: [], error: String(error) });
  }
});

// Merge Test-Main into main and push
router.post('/deploy-to-production', async (req, res) => {
  try {
    await execAsync('git fetch origin');
    await execAsync('git checkout main');
    await execAsync('git pull origin main');
    await execAsync('git merge origin/Test-Main --no-edit');
    await execAsync('git push origin main');
    await execAsync('git checkout Test-Main');
    res.json({ success: true, message: 'Successfully deployed Test-Main to main' });
  } catch (error) {
    await execAsync('git checkout Test-Main').catch(() => {});
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
