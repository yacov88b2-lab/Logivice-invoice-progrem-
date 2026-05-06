import db from '../db';
import type { CustomerRuleDefinition } from '../services/RuleEngine';

export class CustomerRuleModel {
  static create(rule: Omit<CustomerRuleDefinition, 'id' | 'created_at' | 'updated_at'>): CustomerRuleDefinition {
    const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO customer_rules (
        id, customer_id, name, description, version, enabled, 
        rule_type, steps, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      rule.customer_id,
      rule.name,
      rule.description || null,
      rule.version,
      rule.enabled ? 1 : 0,
      rule.ruleType,
      JSON.stringify(rule.steps),
      now,
      rule.created_by,
      now,
      rule.updated_by
    );

    return this.getById(id)!;
  }

  static getById(id: string): CustomerRuleDefinition | undefined {
    const stmt = db.prepare('SELECT * FROM customer_rules WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return undefined;

    return this.rowToRule(row);
  }

  static getByCustomer(customerId: string): CustomerRuleDefinition[] {
    const stmt = db.prepare('SELECT * FROM customer_rules WHERE customer_id = ? ORDER BY version DESC, created_at DESC');
    const rows = stmt.all(customerId) as any[];
    return rows.map(r => this.rowToRule(r));
  }

  static getActiveByCustomer(customerId: string): CustomerRuleDefinition | undefined {
    const stmt = db.prepare(`
      SELECT * FROM customer_rules 
      WHERE customer_id = ? AND enabled = 1 
      ORDER BY version DESC 
      LIMIT 1
    `);
    const row = stmt.get(customerId) as any;
    return row ? this.rowToRule(row) : undefined;
  }

  static getAll(): CustomerRuleDefinition[] {
    const stmt = db.prepare('SELECT * FROM customer_rules ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map(r => this.rowToRule(r));
  }

  static update(
    id: string,
    updates: Partial<Omit<CustomerRuleDefinition, 'id' | 'created_at' | 'created_by'>>
  ): CustomerRuleDefinition | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const updateFields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.version !== undefined) {
      updateFields.push('version = ?');
      values.push(updates.version);
    }
    if (updates.enabled !== undefined) {
      updateFields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.steps !== undefined) {
      updateFields.push('steps = ?');
      values.push(JSON.stringify(updates.steps));
    }
    if (updates.ruleType !== undefined) {
      updateFields.push('rule_type = ?');
      values.push(updates.ruleType);
    }

    updateFields.push('updated_at = ?');
    values.push(now);
    if (updates.updated_by) {
      updateFields.push('updated_by = ?');
      values.push(updates.updated_by);
    }

    values.push(id);
    const stmt = db.prepare(`UPDATE customer_rules SET ${updateFields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.getById(id);
  }

  static delete(id: string): boolean {
    const stmt = db.prepare('DELETE FROM customer_rules WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  static createVersion(
    customerId: string,
    basedOnId?: string,
    updatedBy?: string
  ): CustomerRuleDefinition | undefined {
    const baseRule = basedOnId ? this.getById(basedOnId) : this.getActiveByCustomer(customerId);
    if (!baseRule) return undefined;

    return this.create({
      customer_id: customerId,
      name: `${baseRule.name} (v${baseRule.version + 1})`,
      description: baseRule.description,
      version: baseRule.version + 1,
      enabled: false,
      ruleType: baseRule.ruleType,
      steps: baseRule.steps,
      created_by: updatedBy || 'system',
      updated_by: updatedBy || 'system'
    });
  }

  private static rowToRule(row: any): CustomerRuleDefinition {
    return {
      id: row.id,
      customer_id: row.customer_id,
      name: row.name,
      description: row.description,
      version: row.version,
      enabled: Boolean(row.enabled),
      ruleType: row.rule_type,
      steps: JSON.parse(row.steps || '[]'),
      created_at: row.created_at,
      created_by: row.created_by,
      updated_at: row.updated_at,
      updated_by: row.updated_by
    };
  }
}
