import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { execSync } from 'child_process';
import { initDatabase } from './db';
import pricelistsRouter from './routes/pricelists';
import generateRouter from './routes/api/generate';
import tableauRouter from './routes/tableau';
import deployRouter from './routes/deploy';

const getCommitHash = (): string => {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) {
    return process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return 'unknown';
  }
};

const app = express();
const PORT = process.env.PORT || 3001;

// Avoid 304 responses without bodies for API fetch() calls
app.set('etag', false);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prevent caching of API responses in the browser
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Initialize database
initDatabase();

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'API is running', 
    endpoints: [
      '/api/health',
      '/api/pricelists',
      '/api/generate/preview',
      '/api/generate/invoice'
    ] 
  });
});

// Routes
app.use('/api/pricelists', pricelistsRouter);
app.use('/api/generate', generateRouter);
app.use('/api/tableau', tableauRouter);
app.use('/api/deploy', deployRouter);

// Health check + diagnostics
app.get('/api/health', (req, res) => {
  const storageRoot = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: getCommitHash(),
    env: process.env.NODE_ENV || 'development',
    storageRoot,
    dbPath: path.join(storageRoot, 'database.sqlite'),
    pricelistsPath: path.join(storageRoot, 'uploads', 'pricelists'),
    generatedPath: path.join(storageRoot, 'uploads', 'generated'),
  });
});

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - GET  /api/health`);
  console.log(`  - GET  /api/pricelists`);
  console.log(`  - POST /api/pricelists`);
  console.log(`  - POST /api/generate/preview`);
  console.log(`  - POST /api/generate/invoice`);
});

// Keep alive
server.on('error', (err) => {
  console.error('Server error:', err);
});

export default app;
