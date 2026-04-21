import { Router } from 'express';
import { execSync } from 'child_process';
import path from 'path';

const router = Router();

// Deploy Test-Main to Main (merge and push)
router.post('/deploy-to-production', async (req, res) => {
  try {
    const projectPath = path.resolve(process.cwd());
    const results: string[] = [];
    
    console.log('[Deploy] Starting deployment from Test-Main to Main...');
    
    // Step 1: Fetch latest from origin
    try {
      execSync('git fetch origin', { 
        cwd: projectPath, 
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      results.push('✅ Fetched latest from origin');
    } catch (e) {
      results.push('❌ Failed to fetch: ' + (e as Error).message);
      throw e;
    }
    
    // Step 2: Checkout Main
    try {
      execSync('git checkout main', { 
        cwd: projectPath, 
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      results.push('✅ Switched to main branch');
    } catch (e) {
      results.push('❌ Failed to checkout main: ' + (e as Error).message);
      throw e;
    }
    
    // Step 3: Pull latest Main
    try {
      execSync('git pull origin main', { 
        cwd: projectPath, 
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      results.push('✅ Pulled latest main');
    } catch (e) {
      results.push('⚠️ Pull main warning: ' + (e as Error).message);
    }
    
    // Step 4: Merge Test-Main
    try {
      execSync('git merge Test-Main --no-edit', { 
        cwd: projectPath, 
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      results.push('✅ Merged Test-Main into main');
    } catch (e) {
      results.push('❌ Merge conflict: ' + (e as Error).message);
      // Abort merge on conflict
      try {
        execSync('git merge --abort', { cwd: projectPath, stdio: 'pipe' });
        results.push('⚠️ Merge aborted due to conflict');
      } catch {}
      throw e;
    }
    
    // Step 5: Push to origin
    try {
      execSync('git push origin main', { 
        cwd: projectPath, 
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      results.push('✅ Pushed to origin/main');
    } catch (e) {
      results.push('❌ Failed to push: ' + (e as Error).message);
      throw e;
    }
    
    // Step 6: Switch back to Test-Main for continued development
    try {
      execSync('git checkout Test-Main', { 
        cwd: projectPath, 
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      results.push('✅ Switched back to Test-Main');
    } catch (e) {
      results.push('⚠️ Failed to switch back: ' + (e as Error).message);
    }
    
    console.log('[Deploy] Deployment successful!');
    
    res.json({
      success: true,
      message: 'Deployed Test-Main to Main successfully',
      steps: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Deploy] Deployment failed:', error);
    res.status(500).json({
      success: false,
      error: 'Deployment failed: ' + (error as Error).message,
      steps: (res as any).locals?.results || [],
      timestamp: new Date().toISOString()
    });
  }
});

// Get deployment status (compare Test-Main and Main)
router.get('/status', async (req, res) => {
  try {
    const projectPath = path.resolve(process.cwd());
    
    // Check if Test-Main is ahead of Main
    const diff = execSync('git log main..Test-Main --oneline', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    const commits = diff.trim().split('\n').filter(line => line.trim());
    
    res.json({
      testMainAhead: commits.length > 0,
      commitsBehind: commits.length,
      pendingCommits: commits,
      canDeploy: commits.length > 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get status: ' + (error as Error).message
    });
  }
});

export default router;
