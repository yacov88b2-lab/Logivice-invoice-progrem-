import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../../db';

const router = express.Router();

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB

const MAX_TITLE_LENGTH       = 200;
const MAX_DESCRIPTION_LENGTH = 10_000;
const MAX_REPORTED_BY_LENGTH = 100;
const MAX_PAGE_LENGTH        = 500;
const MAX_CONTEXT_LENGTH     = 12_000;

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
const ALLOWED_STATUSES   = ['open', 'in_progress', 'resolved']   as const;

function publicReport(row: any) {
  if (!row) return row;
  const { screenshot_path: screenshotPath, ...rest } = row;
  return { ...rest, has_screenshot: Boolean(screenshotPath) };
}

// Runs multer, converts its errors to 400 responses.
function runUpload(req: express.Request, res: express.Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('screenshot')(req, res, (err: any) => {
      if (!err) return resolve();
      const isFileTooLarge = err.code === 'LIMIT_FILE_SIZE';
      const msg = isFileTooLarge
        ? `Screenshot is too large. Maximum is ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB.`
        : (err.message || 'Screenshot upload failed');
      reject({ status: 400, message: msg });
    });
  });
}

router.get('/', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    if (status && !ALLOWED_STATUSES.includes(status as any)) {
      return res.status(400).json({ error: 'Invalid status filter' });
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

router.post('/', async (req, res) => {
  try {
    await runUpload(req, res);
  } catch (uploadErr: any) {
    return res.status(uploadErr.status ?? 400).json({ error: uploadErr.message });
  }

  try {
    const { title, description, page, severity, reported_by, context } = req.body;

    if (!title || !description) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'title and description are required' });
    }

    if (String(title).trim().length > MAX_TITLE_LENGTH) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` });
    }
    if (String(description).trim().length > MAX_DESCRIPTION_LENGTH) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` });
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

    const safeReportedBy = reported_by ? String(reported_by).trim().slice(0, MAX_REPORTED_BY_LENGTH) : null;
    const safePage       = page        ? String(page).trim().slice(0, MAX_PAGE_LENGTH)               : null;

    const result = db.prepare(
      `INSERT INTO bug_reports (title, description, page, severity, reported_by, screenshot_path, context)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(title).trim(),
      String(description).trim(),
      safePage,
      safeSeverity,
      safeReportedBy,
      req.file ? req.file.path : null,
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
