import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

function tableExists(tableName: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName)
  );
}

function foreignKeyTargetsTable(tableName: string, targetTable: string): boolean {
  if (!tableExists(tableName)) return false;
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as { table: string }[];
  return foreignKeys.some(fk => fk.table === targetTable);
}

function rebuildRuleTestRunsTable(): void {
  const hasTable = tableExists('rule_test_runs');
  const columns = hasTable
    ? (db.prepare('PRAGMA table_info(rule_test_runs)').all() as { name: string }[]).map(c => c.name)
    : [];

  db.exec('DROP TABLE IF EXISTS rule_test_runs_rebuilt');
  db.exec(`
    CREATE TABLE rule_test_runs_rebuilt (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      rule_id TEXT NOT NULL,
      test_data TEXT NOT NULL,
      result TEXT,
      result_data TEXT,
      status TEXT CHECK(status IN ('passed', 'failed', 'error')),
      passed INTEGER DEFAULT 0,
      created_by TEXT DEFAULT 'system',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES customer_rules(id) ON DELETE CASCADE
    )
  `);

  if (hasTable && columns.length > 0) {
    const wanted = ['id', 'rule_id', 'test_data', 'result', 'result_data', 'status', 'passed', 'created_by', 'created_at'];
    const common = wanted.filter(c => columns.includes(c));
    if (common.length > 0) {
      db.exec(`INSERT INTO rule_test_runs_rebuilt (${common.join(',')}) SELECT ${common.join(',')} FROM rule_test_runs`);
    }
  }

  db.exec('DROP TABLE IF EXISTS rule_test_runs');
  db.exec('ALTER TABLE rule_test_runs_rebuilt RENAME TO rule_test_runs');
}

function rebuildRuleAuditLogTable(): void {
  const hasTable = tableExists('rule_audit_log');
  const columns = hasTable
    ? (db.prepare('PRAGMA table_info(rule_audit_log)').all() as { name: string }[]).map(c => c.name)
    : [];

  db.exec('DROP TABLE IF EXISTS rule_audit_log_rebuilt');
  db.exec(`
    CREATE TABLE rule_audit_log_rebuilt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL,
      action TEXT CHECK(action IN ('created', 'updated', 'enabled', 'disabled', 'deleted')) NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES customer_rules(id) ON DELETE CASCADE
    )
  `);

  if (hasTable && columns.length > 0) {
    const wanted = ['id', 'rule_id', 'action', 'old_value', 'new_value', 'changed_by', 'created_at'];
    const common = wanted.filter(c => columns.includes(c));
    if (common.length > 0) {
      db.exec(`INSERT INTO rule_audit_log_rebuilt (${common.join(',')}) SELECT ${common.join(',')} FROM rule_audit_log`);
    }
  }

  db.exec('DROP TABLE IF EXISTS rule_audit_log');
  db.exec('ALTER TABLE rule_audit_log_rebuilt RENAME TO rule_audit_log');
}

function repairRuleForeignKeys(): void {
  const needsRuleTestRepair = foreignKeyTargetsTable('rule_test_runs', 'customer_rules_old');
  const needsRuleAuditRepair = foreignKeyTargetsTable('rule_audit_log', 'customer_rules_old');

  if (!needsRuleTestRepair && !needsRuleAuditRepair) return;

  const previousForeignKeys = db.pragma('foreign_keys', { simple: true }) as number;
  db.pragma('foreign_keys = OFF');

  try {
    const repair = db.transaction(() => {
      if (needsRuleTestRepair) {
        rebuildRuleTestRunsTable();
      }
      if (needsRuleAuditRepair) {
        rebuildRuleAuditLogTable();
      }
    });

    repair();
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }

  console.log('[DB] Repaired rule child tables that referenced customer_rules_old');
}

function ensureRuleForeignKeysCurrent(): void {
  const brokenTables = ['rule_test_runs', 'rule_audit_log']
    .filter(tableName => foreignKeyTargetsTable(tableName, 'customer_rules_old'));

  if (brokenTables.length > 0) {
    throw new Error(`Rule child table foreign keys still reference customer_rules_old: ${brokenTables.join(', ')}`);
  }
}

function createRuleChildTables(): void {
  // Rule test runs (for preview/validation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rule_test_runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      rule_id TEXT NOT NULL,
      test_data TEXT NOT NULL,
      result TEXT,
      result_data TEXT,
      status TEXT CHECK(status IN ('passed', 'failed', 'error')),
      passed INTEGER DEFAULT 0,
      created_by TEXT DEFAULT 'system',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES customer_rules(id) ON DELETE CASCADE
    )
  `);

  const ruleTestColumns = db.prepare('PRAGMA table_info(rule_test_runs)').all() as { name: string }[];
  const hasRuleTestColumn = (name: string) => ruleTestColumns.some(column => column.name === name);
  if (!hasRuleTestColumn('result_data')) {
    db.exec('ALTER TABLE rule_test_runs ADD COLUMN result_data TEXT');
  }
  if (!hasRuleTestColumn('status')) {
    db.exec("ALTER TABLE rule_test_runs ADD COLUMN status TEXT CHECK(status IN ('passed', 'failed', 'error'))");
  }
  if (!hasRuleTestColumn('created_by')) {
    db.exec("ALTER TABLE rule_test_runs ADD COLUMN created_by TEXT DEFAULT 'system'");
  }

  // Rule audit trail
  db.exec(`
    CREATE TABLE IF NOT EXISTS rule_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL,
      action TEXT CHECK(action IN ('created', 'updated', 'enabled', 'disabled', 'deleted')) NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES customer_rules(id) ON DELETE CASCADE
    )
  `);
}

function migrateRuleChildTables(): void {
  createRuleChildTables();
  repairRuleForeignKeys();
  ensureRuleForeignKeysCurrent();
}

// Initialize tables
export function initDatabase() {
  // Pricelists table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricelists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      warehouse_code TEXT NOT NULL,
      file_path TEXT NOT NULL,
      template_structure TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Audit logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pricelist_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      date_range_start TEXT NOT NULL,
      date_range_end TEXT NOT NULL,
      api_data_summary TEXT,
      filled_rows TEXT NOT NULL,
      unmatched_rows TEXT,
      output_file_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pricelist_id) REFERENCES pricelists(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Create default admin user if not exists
  const stmt = db.prepare('SELECT id FROM users WHERE email = ?');
  const admin = stmt.get('admin@logivice.com');
  
  if (!admin) {
    // Generate secure random password or use env variable
    const adminPassword = process.env.ADMIN_PASSWORD || 
      Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    const insertAdmin = db.prepare(`
      INSERT INTO users (email, password, role) VALUES (?, ?, ?)
    `);
    insertAdmin.run('admin@logivice.com', adminPassword, 'admin');
    console.log('Default admin created. Password stored securely.');
  }

  // Customer Rules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_rules (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      version INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 0,
      rule_type TEXT CHECK(rule_type IN ('matching', 'transformation', 'aggregation')) DEFAULT 'matching',
      steps TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT NOT NULL
    )
  `);

  // Recovery: if a previous migration left customer_rules_old behind, clean up the broken state
  try {
    const oldExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_rules_old'").get();
    if (oldExists) {
      const newExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_rules'").get();
      if (!newExists) {
        // Migration failed after RENAME but before completion — restore the table
        db.exec('ALTER TABLE customer_rules_old RENAME TO customer_rules');
        console.log('[DB] Recovered customer_rules from broken migration state');
      } else {
        // Both exist — previous migration finished but DROP was skipped
        db.exec('DROP TABLE customer_rules_old');
        console.log('[DB] Cleaned up orphaned customer_rules_old table');
      }
    }
  } catch (e) {
    console.error('[DB] Recovery check failed:', e);
  }

  // Migration: recreate customer_rules without the invalid FK on pricelists(customer_name)
  // The FK caused "foreign key mismatch" errors on pricelist delete because customer_name
  // is not a unique/primary-key column on pricelists.
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customer_rules'").get() as { sql: string } | undefined;
    if (tableInfo?.sql?.includes('REFERENCES pricelists')) {
      const migrate = db.transaction(() => {
        db.exec(`ALTER TABLE customer_rules RENAME TO customer_rules_old`);
        db.exec(`
          CREATE TABLE customer_rules (
            id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            version INTEGER DEFAULT 1,
            enabled INTEGER DEFAULT 0,
            rule_type TEXT CHECK(rule_type IN ('matching', 'transformation', 'aggregation')) DEFAULT 'matching',
            steps TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_by TEXT NOT NULL
          )
        `);
        // Only copy columns that actually exist in the old table to handle schema drift
        const oldCols = (db.prepare('PRAGMA table_info(customer_rules_old)').all() as { name: string }[]).map(c => c.name);
        const wantedCols = ['id','customer_id','name','description','version','enabled','rule_type','steps','created_at','created_by','updated_at','updated_by'];
        const commonCols = wantedCols.filter(c => oldCols.includes(c));
        if (commonCols.length > 0) {
          db.exec(`INSERT INTO customer_rules (${commonCols.join(',')}) SELECT ${commonCols.join(',')} FROM customer_rules_old`);
        }
        db.exec(`DROP TABLE customer_rules_old`);
      });
      migrate();
      console.log('[DB] Migrated customer_rules: removed invalid FK on pricelists(customer_name)');
    }
  } catch (e) {
    console.error('[DB] Migration customer_rules failed:', e);
  }

  // Safety net: if customer_rules_old is still present after all migrations, drop it.
  // This handles cases where SQLite did not fully roll back DDL inside a failed transaction.
  try {
    const staleOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_rules_old'").get();
    if (staleOld) {
      const mainExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer_rules'").get();
      if (mainExists) {
        db.exec('DROP TABLE customer_rules_old');
        console.log('[DB] Safety net: dropped stale customer_rules_old table');
      } else {
        db.exec('ALTER TABLE customer_rules_old RENAME TO customer_rules');
        console.log('[DB] Safety net: restored customer_rules from customer_rules_old');
      }
    }
  } catch (e) {
    console.error('[DB] Safety net cleanup failed:', e);
  }

  // Create indexes for customer_rules
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_rules_customer_id ON customer_rules(customer_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_rules_enabled ON customer_rules(enabled)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_rules_version ON customer_rules(version)`);

  // Migration: Add approval_status column to customer_rules if not exists
  try {
    const customerRulesColumns = db.prepare('PRAGMA table_info(customer_rules)').all() as { name: string }[];
    const hasApprovalStatus = customerRulesColumns.some(column => column.name === 'approval_status');
    if (!hasApprovalStatus) {
      db.exec(`
        ALTER TABLE customer_rules ADD COLUMN approval_status TEXT CHECK(approval_status IN ('draft', 'tested', 'approved')) DEFAULT 'draft'
      `);
      console.log('[DB] Added approval_status column to customer_rules');
    }
  } catch (e) {
    console.error('[DB] Migration approval_status failed:', e);
  }

  try {
    migrateRuleChildTables();
  } catch (e) {
    console.error('[DB] Rule child-table migration failed:', e);
    throw e;
  }

  // Bug reports table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bug_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      page TEXT,
      severity TEXT CHECK(severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
      reported_by TEXT,
      status TEXT CHECK(status IN ('open', 'in_progress', 'resolved')) DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Add screenshot_path and context columns if not present (migration for existing DBs)
  const bugReportCols = (db.prepare('PRAGMA table_info(bug_reports)').all() as { name: string }[]).map(c => c.name);
  if (!bugReportCols.includes('screenshot_path')) {
    db.exec('ALTER TABLE bug_reports ADD COLUMN screenshot_path TEXT');
  }
  if (!bugReportCols.includes('context')) {
    db.exec('ALTER TABLE bug_reports ADD COLUMN context TEXT');
  }

  // Match-level audit trail — one row per matched transaction per invoice run.
  // Allows post-hoc reconstruction of "why did transaction X go to line Y?"
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_log_id INTEGER NOT NULL,
      transaction_id TEXT NOT NULL,
      transaction_segment TEXT,
      transaction_movement_type TEXT,
      transaction_quantity REAL,
      line_item_sheet TEXT,
      line_item_row INTEGER,
      line_item_clause TEXT,
      match_reason TEXT,
      confidence REAL,
      matched_by TEXT CHECK(matched_by IN ('data_mapper', 'rule_engine', 'manual_resolution')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (audit_log_id) REFERENCES audit_logs(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_match_audit_audit_log ON match_audit(audit_log_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_match_audit_transaction ON match_audit(transaction_id)`);

  // Indexes for duplicate-period detection
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_period ON audit_logs(pricelist_id, date_range_start, date_range_end)`);

  console.log('Database initialized successfully');
}

initDatabase();

export default db;
