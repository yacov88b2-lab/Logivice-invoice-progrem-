import db from '../db';
import type { Pricelist, TemplateStructure } from '../types';

export class PricelistModel {
  static getAll(): Pricelist[] {
    const stmt = db.prepare('SELECT * FROM pricelists ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      ...row,
      template_structure: JSON.parse(row.template_structure)
    }));
  }

  static getById(id: number): Pricelist | undefined {
    const stmt = db.prepare('SELECT * FROM pricelists WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return undefined;
    return {
      ...row,
      template_structure: JSON.parse(row.template_structure)
    };
  }

  static create(pricelist: Omit<Pricelist, 'id' | 'created_at' | 'updated_at'>): Pricelist {
    const stmt = db.prepare(`
      INSERT INTO pricelists (name, customer_name, warehouse_code, file_path, template_structure)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      pricelist.name,
      pricelist.customer_name,
      pricelist.warehouse_code,
      pricelist.file_path,
      JSON.stringify(pricelist.template_structure)
    );

    return this.getById(result.lastInsertRowid as number)!;
  }

  static update(id: number, pricelist: Partial<Pricelist>): Pricelist | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const updates: string[] = [];
    const values: any[] = [];

    if (pricelist.name) {
      updates.push('name = ?');
      values.push(pricelist.name);
    }
    if (pricelist.customer_name) {
      updates.push('customer_name = ?');
      values.push(pricelist.customer_name);
    }
    if (pricelist.warehouse_code) {
      updates.push('warehouse_code = ?');
      values.push(pricelist.warehouse_code);
    }
    if (pricelist.file_path) {
      updates.push('file_path = ?');
      values.push(pricelist.file_path);
    }
    if (pricelist.template_structure) {
      updates.push('template_structure = ?');
      values.push(JSON.stringify(pricelist.template_structure));
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`
      UPDATE pricelists SET ${updates.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);

    return this.getById(id);
  }

  static delete(id: number): boolean {
    const stmt = db.prepare('DELETE FROM pricelists WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
