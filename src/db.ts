import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { Person, Task, CompletionRow } from './types';

const DB_PATH = path.join(__dirname, '..', 'data', 'bot.db');

let db: Database;

function save(): void {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL UNIQUE,
      department TEXT NOT NULL DEFAULT '',
      crew TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      required_role TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS completions (
      person_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      reported_at TEXT NOT NULL DEFAULT (datetime('now')),
      reported_by TEXT NOT NULL,
      PRIMARY KEY (person_id, task_id),
      FOREIGN KEY (person_id) REFERENCES people(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

    CREATE TABLE IF NOT EXISTS custom_instructions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instruction TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

  // Migrate existing DB that may lack the new columns
  try { db.run(`ALTER TABLE people ADD COLUMN department TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.run(`ALTER TABLE people ADD COLUMN crew TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.run(`ALTER TABLE people ADD COLUMN role TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.run(`ALTER TABLE tasks ADD COLUMN required_role TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }

  save();
}

function getDb(): Database {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}

// --- People ---

export function getAllPeople(): Person[] {
  const rows: Person[] = [];
  const stmt = getDb().prepare('SELECT id, full_name, department, crew, role FROM people ORDER BY full_name');
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: number; full_name: string; department: string; crew: string; role: string };
    rows.push({
      id: Number(row.id),
      full_name: String(row.full_name),
      department: String(row.department),
      crew: String(row.crew),
      role: String(row.role),
    });
  }
  stmt.free();
  return rows;
}

export function getPeopleByFilters(filters: Array<{ field: string; value: string }>): Person[] {
  const allowed = ['full_name', 'department', 'crew', 'role'];
  const valid = filters.filter(f => allowed.includes(f.field));
  if (valid.length === 0) return getAllPeople();

  // Try exact match for structured fields first; if no results, fall back to LIKE
  const buildQuery = (useLike: boolean) => {
    const where = valid.map(f =>
      f.field === 'full_name'
        ? `full_name LIKE ?`
        : useLike ? `LOWER(${f.field}) LIKE LOWER(?)` : `LOWER(${f.field}) = LOWER(?)`
    ).join(' AND ');
    const vals = valid.map(f =>
      f.field === 'full_name' ? `%${f.value}%` : useLike ? `%${f.value}%` : f.value
    );
    return { where, vals };
  };

  const exact = buildQuery(false);
  const exactResults = queryPeople(exact.where, exact.vals);
  if (exactResults.length > 0) return exactResults;

  const like = buildQuery(true);
  return queryPeople(like.where, like.vals);
}

function queryPeople(where: string, values: (string | number)[]): Person[] {
  const rows: Person[] = [];
  const stmt = getDb().prepare(
    `SELECT id, full_name, department, crew, role FROM people WHERE ${where} ORDER BY full_name`
  );
  stmt.bind(values);
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: number; full_name: string; department: string; crew: string; role: string };
    rows.push({
      id: Number(row.id),
      full_name: String(row.full_name),
      department: String(row.department),
      crew: String(row.crew),
      role: String(row.role),
    });
  }
  stmt.free();
  return rows;
}

export function getPeopleBy(field: string, value: string): Person[] {
  const allowed = ['full_name', 'department', 'crew', 'role'];
  if (!allowed.includes(field)) return getAllPeople();

  if (field === 'full_name') {
    return queryPeople(`full_name LIKE ?`, [`%${value}%`]);
  }

  // Structured fields: try exact first, fall back to LIKE
  const exact = queryPeople(`LOWER(${field}) = LOWER(?)`, [value]);
  if (exact.length > 0) return exact;
  return queryPeople(`LOWER(${field}) LIKE LOWER(?)`, [`%${value}%`]);
}

export function addPerson(fullName: string, department: string, crew: string, role: string): boolean {
  try {
    getDb().run('INSERT INTO people (full_name, department, crew, role) VALUES (?, ?, ?, ?)', [fullName, department, crew, role]);
    save();
    return true;
  } catch {
    return false;
  }
}

export function updatePerson(id: number, fields: { department?: string; crew?: string; role?: string }): void {
  const updates: string[] = [];
  const values: string[] = [];
  if (fields.department !== undefined) { updates.push('department = ?'); values.push(fields.department); }
  if (fields.crew !== undefined) { updates.push('crew = ?'); values.push(fields.crew); }
  if (fields.role !== undefined) { updates.push('role = ?'); values.push(fields.role); }
  if (updates.length === 0) return;
  getDb().run(`UPDATE people SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
  save();
}

export function removePerson(id: number): void {
  getDb().run('DELETE FROM completions WHERE person_id = ?', [id]);
  getDb().run('DELETE FROM people WHERE id = ?', [id]);
  save();
}

// --- Tasks ---

export function getAllTasks(): Task[] {
  const rows: Task[] = [];
  const stmt = getDb().prepare('SELECT id, name, required_role FROM tasks ORDER BY name');
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: number; name: string; required_role: string };
    rows.push({ id: Number(row.id), name: String(row.name), required_role: String(row.required_role) });
  }
  stmt.free();
  return rows;
}

export function addTask(name: string, requiredRole: string): boolean {
  try {
    getDb().run('INSERT INTO tasks (name, required_role) VALUES (?, ?)', [name, requiredRole]);
    save();
    return true;
  } catch {
    return false;
  }
}

export function removeTask(id: number): void {
  getDb().run('DELETE FROM completions WHERE task_id = ?', [id]);
  getDb().run('DELETE FROM tasks WHERE id = ?', [id]);
  save();
}

// --- Reset ---

// --- Custom Instructions ---

export function addInstruction(instruction: string): number {
  getDb().run('INSERT INTO custom_instructions (instruction) VALUES (?)', [instruction]);
  save();
  const stmt = getDb().prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const id = Number((stmt.getAsObject() as { id: number }).id);
  stmt.free();
  return id;
}

export function getAllInstructions(): Array<{ id: number; instruction: string; created_at: string }> {
  const rows: Array<{ id: number; instruction: string; created_at: string }> = [];
  const stmt = getDb().prepare('SELECT id, instruction, created_at FROM custom_instructions ORDER BY id');
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: number; instruction: string; created_at: string };
    rows.push({ id: Number(row.id), instruction: String(row.instruction), created_at: String(row.created_at) });
  }
  stmt.free();
  return rows;
}

export function removeInstruction(id: number): void {
  getDb().run('DELETE FROM custom_instructions WHERE id = ?', [id]);
  save();
}

export function clearDb(): void {
  getDb().run('DELETE FROM completions');
  getDb().run('DELETE FROM tasks');
  getDb().run('DELETE FROM people');
  getDb().run('DELETE FROM custom_instructions');
  save();
}

// --- Completions ---

export function removeCompletion(personId: number, taskId: number): boolean {
  const stmt = getDb().prepare('SELECT 1 FROM completions WHERE person_id = ? AND task_id = ?');
  stmt.bind([personId, taskId]);
  const exists = stmt.step();
  stmt.free();
  if (!exists) return false;
  getDb().run('DELETE FROM completions WHERE person_id = ? AND task_id = ?', [personId, taskId]);
  save();
  return true;
}

export function recordCompletion(personId: number, taskId: number, reportedBy: string): boolean {
  try {
    getDb().run(
      'INSERT INTO completions (person_id, task_id, reported_by) VALUES (?, ?, ?)',
      [personId, taskId, reportedBy]
    );
    save();
    return true;
  } catch {
    return false;
  }
}

export function isCompleted(personId: number, taskId: number): boolean {
  const stmt = getDb().prepare(
    'SELECT 1 FROM completions WHERE person_id = ? AND task_id = ?'
  );
  stmt.bind([personId, taskId]);
  const found = stmt.step();
  stmt.free();
  return found;
}

export function getAllCompletions(): CompletionRow[] {
  const rows: CompletionRow[] = [];
  const stmt = getDb().prepare(`
    SELECT p.full_name AS person_name, t.name AS task_name, c.reported_at
    FROM completions c
    JOIN people p ON p.id = c.person_id
    JOIN tasks t ON t.id = c.task_id
    ORDER BY p.full_name, t.name
  `);
  while (stmt.step()) {
    const row = stmt.getAsObject() as { person_name: string; task_name: string; reported_at: string };
    rows.push({
      person_name: String(row.person_name),
      task_name: String(row.task_name),
      reported_at: String(row.reported_at),
    });
  }
  stmt.free();
  return rows;
}
