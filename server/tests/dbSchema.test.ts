import { describe, expect, it } from 'vitest';
import db from '../db';

describe('database schema compatibility', () => {
  it('rule child tables reference current customer_rules table', () => {
    const ruleTestTargets = db
      .prepare('PRAGMA foreign_key_list(rule_test_runs)')
      .all() as { table: string }[];
    const ruleAuditTargets = db
      .prepare('PRAGMA foreign_key_list(rule_audit_log)')
      .all() as { table: string }[];

    expect(ruleTestTargets.map(fk => fk.table)).toContain('customer_rules');
    expect(ruleAuditTargets.map(fk => fk.table)).toContain('customer_rules');
    expect(ruleTestTargets.map(fk => fk.table)).not.toContain('customer_rules_old');
    expect(ruleAuditTargets.map(fk => fk.table)).not.toContain('customer_rules_old');
  });

  it('customer rule create path can write the audit trail', () => {
    const ruleId = `schema_test_${Date.now()}`;

    try {
      db.prepare(`
        INSERT INTO customer_rules (
          id, customer_id, name, description, version, enabled,
          approval_status, rule_type, steps, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ruleId,
        'schema_test_customer',
        'Schema Smoke Test',
        null,
        1,
        0,
        'draft',
        'matching',
        '[]',
        'schema_test',
        'schema_test'
      );

      expect(() => {
        db.prepare(`
          INSERT INTO rule_audit_log (rule_id, action, new_value, changed_by)
          VALUES (?, 'created', ?, ?)
        `).run(ruleId, '[]', 'schema_test');
      }).not.toThrow();
    } finally {
      db.prepare('DELETE FROM rule_audit_log WHERE rule_id = ?').run(ruleId);
      db.prepare('DELETE FROM rule_test_runs WHERE rule_id = ?').run(ruleId);
      db.prepare('DELETE FROM customer_rules WHERE id = ?').run(ruleId);
    }
  });
});
