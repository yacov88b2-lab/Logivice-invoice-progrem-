import db from '../db';
import type { AuditEntry } from '../types';

export class AuditLogModel {
  static getAll(): AuditEntry[] {
    const stmt = db.prepare(`
      SELECT a.*, p.name as pricelist_name, u.email as user_email
      FROM audit_logs a
      JOIN pricelists p ON a.pricelist_id = p.id
      JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
    `);
    return stmt.all() as AuditEntry[];
  }

  static getById(id: number): AuditEntry | undefined {
    const stmt = db.prepare(`
      SELECT a.*, p.name as pricelist_name, u.email as user_email
      FROM audit_logs a
      JOIN pricelists p ON a.pricelist_id = p.id
      JOIN users u ON a.user_id = u.id
      WHERE a.id = ?
    `);
    return stmt.get(id) as AuditEntry | undefined;
  }

  static getByPricelist(pricelistId: number): AuditEntry[] {
    const stmt = db.prepare(`
      SELECT a.*, p.name as pricelist_name, u.email as user_email
      FROM audit_logs a
      JOIN pricelists p ON a.pricelist_id = p.id
      JOIN users u ON a.user_id = u.id
      WHERE a.pricelist_id = ?
      ORDER BY a.created_at DESC
    `);
    return stmt.all(pricelistId) as AuditEntry[];
  }

  static create(entry: Omit<AuditEntry, 'id' | 'created_at'>): AuditEntry {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (
        pricelist_id, user_id, date_range_start, date_range_end,
        api_data_summary, filled_rows, unmatched_rows, output_file_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      entry.pricelist_id,
      entry.user_id,
      entry.date_range_start,
      entry.date_range_end,
      entry.api_data_summary,
      entry.filled_rows,
      entry.unmatched_rows || null,
      entry.output_file_path || null
    );

    return this.getById(result.lastInsertRowid as number)!;
  }
}
