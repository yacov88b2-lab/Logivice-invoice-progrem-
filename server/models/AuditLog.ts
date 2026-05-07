import db from '../db';
import type { AuditEntry } from '../types';

export interface MatchAuditRow {
  audit_log_id: number;
  transaction_id: string;
  transaction_segment?: string;
  transaction_movement_type?: string;
  transaction_quantity?: number;
  line_item_sheet?: string;
  line_item_row?: number;
  line_item_clause?: string;
  match_reason?: string;
  confidence?: number;
  matched_by: 'data_mapper' | 'rule_engine' | 'manual_resolution';
}

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

  static findByPeriod(pricelistId: number, startDate: string, endDate: string): AuditEntry | undefined {
    const stmt = db.prepare(`
      SELECT a.*, p.name as pricelist_name, u.email as user_email
      FROM audit_logs a
      JOIN pricelists p ON a.pricelist_id = p.id
      JOIN users u ON a.user_id = u.id
      WHERE a.pricelist_id = ? AND a.date_range_start = ? AND a.date_range_end = ?
      ORDER BY a.created_at DESC
      LIMIT 1
    `);
    return stmt.get(pricelistId, startDate, endDate) as AuditEntry | undefined;
  }

  static createMatchAuditBatch(rows: MatchAuditRow[]): void {
    if (rows.length === 0) return;
    const stmt = db.prepare(`
      INSERT INTO match_audit (
        audit_log_id, transaction_id, transaction_segment, transaction_movement_type,
        transaction_quantity, line_item_sheet, line_item_row, line_item_clause,
        match_reason, confidence, matched_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((items: MatchAuditRow[]) => {
      for (const r of items) {
        stmt.run(
          r.audit_log_id, r.transaction_id, r.transaction_segment ?? null,
          r.transaction_movement_type ?? null, r.transaction_quantity ?? null,
          r.line_item_sheet ?? null, r.line_item_row ?? null, r.line_item_clause ?? null,
          r.match_reason ?? null, r.confidence ?? null, r.matched_by
        );
      }
    });
    insertMany(rows);
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
