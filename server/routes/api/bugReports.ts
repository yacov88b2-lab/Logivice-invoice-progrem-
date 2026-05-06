import express from 'express';
import db from '../../db';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const stmt = status
      ? db.prepare('SELECT * FROM bug_reports WHERE status = ? ORDER BY created_at DESC')
      : db.prepare('SELECT * FROM bug_reports ORDER BY created_at DESC');
    const reports = status ? stmt.all(status) : stmt.all();
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bug reports', details: (error as Error).message });
  }
});

router.post('/', (req, res) => {
  try {
    const { title, description, page, severity, reported_by } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: 'title and description are required' });
    }
    const result = db.prepare(
      'INSERT INTO bug_reports (title, description, page, severity, reported_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      String(title).trim(),
      String(description).trim(),
      page ? String(page).trim() : null,
      severity || 'medium',
      reported_by ? String(reported_by).trim() : null
    );
    const report = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit bug report', details: (error as Error).message });
  }
});

router.patch('/:id/status', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!['open', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.prepare('UPDATE bug_reports SET status = ? WHERE id = ?').run(status, id);
    const report = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status', details: (error as Error).message });
  }
});

export default router;
