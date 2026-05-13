import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../../db';

const router = express.Router();

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB

const screenshotDir = path.join(
  process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data'),
  'uploads',
  'bug-reports'
);
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, screenshotDir),
  filename: (_req, _file, cb) => {
    const safe = `bug-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SCREENSHOT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, or WebP screenshots are accepted'));
    }
    cb(null, true);
  },
});

const ALLOWED_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const ALLOWED_STATUSES = ['open', 'in_progress', 'resolved'] as const;
const MAX_CONTEXT_LENGTH = 12000;

function publicReport(row: any) {
  if (!row) return row;
  const { screenshot_path: screenshotPath, ...rest } = row;
  return {
    ...rest,
    has_screenshot: Boolean(screenshotPath),
  };
}

router.get('/', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    if (status && !ALLOWED_STATUSES.includes(status as any)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const stmt = status
      ? db.prepare('SELECT * FROM bug_reports WHERE status = ? ORDER BY created_at DESC')
      : db.prepare('SELECT * FROM bug_reports ORDER BY created_at DESC');
    const reports = status ? stmt.all(status) : stmt.all();
    res.json(reports.map(publicReport));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bug reports', details: (error as Error).message });
  }
});

router.post('/', upload.single('screenshot'), (req, res) => {
  // Multer populates req.body for multipart; also accept plain JSON
  try {
    const { title, description, page, severity, reported_by, context } = req.body;
    if (!title || !description) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'title and description are required' });
    }

    const safeSeverity = severity || 'medium';
    if (!ALLOWED_SEVERITIES.includes(safeSeverity as any)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid severity' });
    }

    const safeContext = context ? String(context) : null;
    if (safeContext && safeContext.length > MAX_CONTEXT_LENGTH) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'context is too large' });
    }

    const screenshotPath = req.file ? req.file.path : null;

    const result = db.prepare(
      `INSERT INTO bug_reports (title, description, page, severity, reported_by, screenshot_path, context)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(title).trim(),
      String(description).trim(),
      page ? String(page).trim() : null,
      safeSeverity,
      reported_by ? String(reported_by).trim() : null,
      screenshotPath,
      safeContext
    );

    const report = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(publicReport(report));
  } catch (error) {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
    res.status(500).json({ error: 'Failed to submit bug report', details: (error as Error).message });
  }
});

router.patch('/:id/status', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.prepare('UPDATE bug_reports SET status = ? WHERE id = ?').run(status, id);
    const report = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(publicReport(report));
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status', details: (error as Error).message });
  }
});

export default router;
