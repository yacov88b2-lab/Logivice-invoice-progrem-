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

  // Migration: recreate customer_rules without the invalid FK on pricelists(customer_name)
  // The FK caused "foreign key mismatch" errors on pricelist delete because customer_name
  // is not a unique/primary-key column on pricelists.
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customer_rules'").get() as { sql: string } | undefined;
    if (tableInfo?.sql?.includes('REFERENCES pricelists')) {
      db.exec(`
        BEGIN;
        ALTER TABLE customer_rules RENAME TO customer_rules_old;
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
        );
        INSERT INTO customer_rules SELECT id,customer_id,name,description,version,enabled,rule_type,steps,created_at,created_by,updated_at,updated_by FROM customer_rules_old;
        DROP TABLE customer_rules_old;
        COMMIT;
      `);
      console.log('[DB] Migrated customer_rules: removed invalid FK on pricelists(customer_name)');
    }
  } catch (e) {
    console.error('[DB] Migration customer_rules failed:', e);
  }

  // Create indexes for customer_rules
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_rules_customer_id ON customer_rules(customer_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_rules_enabled ON customer_rules(enabled)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_rules_version ON customer_rules(version)`);

  // Rule test runs (for preview/validation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rule_test_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL,
      test_data TEXT NOT NULL,
      result TEXT NOT NULL,
      passed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES customer_rules(id)
    )
  `);

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
      FOREIGN KEY (rule_id) REFERENCES customer_rules(id)
    )
  `);

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

  console.log('Database initialized successfully');
}

export default db;
