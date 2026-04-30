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

  console.log('Database initialized successfully');
}

export default db;
