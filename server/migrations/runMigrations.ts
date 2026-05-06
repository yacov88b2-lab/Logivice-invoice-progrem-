/**
 * Migration Runner: Load Afimilk and Sensos Rules into Database
 * 
 * Usage: Run this after database initialization to populate default rules
 * ts-node server/migrations/runMigrations.ts
 */

import { CustomerRuleModel } from '../models/CustomerRule';
import { createAfimilkRuleDefinition } from './createAfimilkRule';
import { createSensosRuleDefinition } from './createSensosRule';
import db from '../db';

export async function runMigrations() {
  console.log('[Migrations] Starting rule migrations...');

  try {
    // Check if rules already exist
    const existing = CustomerRuleModel.getAll();
    if (existing.length > 0) {
      console.log(`[Migrations] Found ${existing.length} existing rules. Skipping migration.`);
      return;
    }

    // Create Afimilk rule
    console.log('[Migrations] Creating Afimilk rule definition...');
    const afimilkRule = createAfimilkRuleDefinition();
    const createdAfimilk = CustomerRuleModel.create(afimilkRule);
    console.log(`[Migrations] ✓ Created Afimilk rule: ${createdAfimilk.id}`);

    // Log creation
    db.prepare(`
      INSERT INTO rule_audit_log (rule_id, action, new_value, changed_by)
      VALUES (?, 'created', ?, ?)
    `).run(createdAfimilk.id, JSON.stringify(afimilkRule.steps), 'migration');

    // Create Sensos rule
    console.log('[Migrations] Creating Sensos rule definition...');
    const sensosRule = createSensosRuleDefinition();
    const createdSensos = CustomerRuleModel.create(sensosRule);
    console.log(`[Migrations] ✓ Created Sensos rule: ${createdSensos.id}`);

    // Log creation
    db.prepare(`
      INSERT INTO rule_audit_log (rule_id, action, new_value, changed_by)
      VALUES (?, 'created', ?, ?)
    `).run(createdSensos.id, JSON.stringify(sensosRule.steps), 'migration');

    console.log('[Migrations] ✓ All migrations completed successfully');
    console.log('[Migrations] Note: Rules are currently DISABLED. Enable them via API or UI when ready.');
  } catch (error) {
    console.error('[Migrations] Error running migrations:', error);
    throw error;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
