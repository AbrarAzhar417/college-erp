import { db } from './db.js';
import { LINKS, hasRealFk } from './integrity.js';

/**
 * Brings an older database up to the current design. Safe to run at every start; it does nothing when there is nothing to do.
 *
 *  1. Every pointer between tables becomes a real FOREIGN KEY (SQLite cannot add one to an existing column, so the table is
 *     rebuilt with SQLite's documented copy, drop and rename steps, inside one transaction; any problem rolls it back).
 *  2. Every foreign key column, and the columns that the screens filter and join on, gets an index.
 *  3. Statistics are refreshed so the query planner picks those indexes.
 */

const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; pk: number }[]);

/** Splits the inside of CREATE TABLE ( ... ) on the commas that are not inside brackets or quotes. */
export function splitDefs(inner: string): string[] {
  const out: string[] = []; let depth = 0, q = '', cur = '';
  for (const ch of inner) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** The CREATE TABLE text with REFERENCES added to the named columns. */
export function withReferences(sql: string, newName: string, refs: { col: string; parent: string; action: string }[]): string {
  const open = sql.indexOf('('), close = sql.lastIndexOf(')');
  const head = sql.slice(0, open).replace(/^(\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)("?[\w]+"?|\[[\w]+\]|`[\w]+`)/i, `$1${newName}`);
  const defs = splitDefs(sql.slice(open + 1, close)).map(d => {
    const first = d.trim().split(/\s+/)[0].replace(/^["`\[]|["`\]]$/g, '');
    const r = refs.find(x => x.col === first);
    if (!r || /\bREFERENCES\b/i.test(d)) return d;
    return `${d.replace(/\s+$/, '')} REFERENCES ${r.parent}(id) ON DELETE ${r.action}`;
  });
  return `${head}(${defs.join(',')})${sql.slice(close + 1)}`;
}

function rebuild(table: string, links: typeof LINKS): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined; if (!row) return false;
  const info = cols(table), notnull = new Map(info.map(c => [c.name, !!c.notnull]));
  const refs = links.map(l => ({ col: l.col, parent: l.parent, action: l.onDelete === 'cascade' || (l.onDelete === 'null' && notnull.get(l.col)) ? 'CASCADE' : l.onDelete === 'restrict' ? 'RESTRICT' : 'SET NULL' }));
  const tmp = `${table}__new`, ddl = withReferences(row.sql, tmp, refs);
  const side = db.prepare("SELECT type, sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL").all(table) as { type: string; sql: string }[];
  const seq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as { seq: number } | undefined;
  const list = info.map(c => `"${c.name}"`).join(', ');
  db.exec(`DROP TABLE IF EXISTS ${tmp}`);
  db.exec(ddl);
  db.exec(`INSERT INTO ${tmp} (${list}) SELECT ${list} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
  for (const s of side) db.exec(s.sql);
  if (seq) db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(seq.seq, table);
  return true;
}

export function addForeignKeys(): { rebuilt: string[]; skipped: string[] } {
  const rebuilt: string[] = [], skipped: string[] = [];
  const todo = new Map<string, typeof LINKS>();
  for (const l of LINKS) if (has(l.table) && has(l.parent) && cols(l.table).some(c => c.name === l.col) && !hasRealFk(l.table, l.col)) todo.set(l.table, [...(todo.get(l.table) ?? []), l]);
  if (!todo.size) return { rebuilt, skipped };
  db.pragma('foreign_keys = OFF');
  // The guard triggers name other tables, which would stop a table from being replaced; installGuards() puts back the ones that are still needed.
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'g\\_%' ESCAPE '\\'").all() as { name: string }[]) db.exec(`DROP TRIGGER IF EXISTS ${t.name}`);
  try {
    for (const [table, links] of todo) {
      // A pointer that already points nowhere cannot become a foreign key: clear it when it may be empty, otherwise leave the table for a person to look at.
      const ok = links.filter(l => {
        const orphan = `FROM ${l.table} t WHERE t.${l.col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${l.parent} p WHERE p.id = t.${l.col})`;
        if (!(db.prepare(`SELECT 1 ${orphan}`).get())) return true;
        if (!cols(l.table).find(c => c.name === l.col)?.notnull) { db.exec(`UPDATE ${l.table} SET ${l.col} = NULL WHERE ${l.col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${l.parent} p WHERE p.id = ${l.table}.${l.col})`); return true; }
        skipped.push(`${l.table}.${l.col}`); return false;
      });
      if (!ok.length) continue;
      try {
        db.transaction(() => { rebuild(table, ok); if ((db.prepare(`PRAGMA foreign_key_check(${table})`).all() as unknown[]).length) throw new Error('foreign_key_check failed'); })();
        rebuilt.push(table);
      } catch (e) { if (process.env.UPGRADE_DEBUG) console.log('rebuild failed', table, (e as Error).message); skipped.push(...ok.map(l => `${l.table}.${l.col}`)); }
    }
  } finally { db.pragma('foreign_keys = ON'); }
  return { rebuilt, skipped };
}

/** Columns that the screens filter and join on, beyond the foreign keys. Only created when the table and columns exist. */
const HOT: [string, string[]][] = [
  ['students', ['section_id', 'status']], ['students', ['father_cnic']], 
  ['vouchers', ['student_id', 'period']], ['vouchers', ['period', 'status']], ['payments', ['student_id']], ['payments', ['paid_on']],
  ['exam_marks', ['student_id']],
  ['audit_log', ['entity', 'entity_id']], ['audit_log', ['user_id']], ['audit_log', ['created_at']], ['hr_files', ['owner_type', 'owner_id']],
  ['fd_gate_passes', ['date', 'status']], ['comm_notices', ['status', 'issue_date']], ['disc_records', ['student_id', 'date']], ['disc_letters', ['student_id', 'issued_on']],
  ['hr_staff', ['status']], ['diary_entries', ['section_id', 'date']], ['teachers', ['active']], ['users', ['role']], ['notices', ['publish_on']]
];

const prefixCovered = (table: string, want: string[]) => (db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]).some(i => {
  const c = (db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[]).map(x => x.name);
  return want.every((w, k) => c[k] === w);
}) || (want.length === 1 && cols(table).some(c => c.pk === 1 && c.name === want[0] && cols(table).filter(x => x.pk).length === 1));

export function ensureIndexes(): string[] {
  const made: string[] = [];
  const want: [string, string[]][] = [...HOT];
  for (const t of (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(x => x.name))
    for (const f of db.prepare(`PRAGMA foreign_key_list(${t})`).all() as { from: string }[]) want.push([t, [f.from]]);
  for (const l of LINKS) want.push([l.table, [l.col]]);
  for (const [table, c] of want) {
    if (!has(table)) continue;
    const have = new Set(cols(table).map(x => x.name)); if (!c.every(x => have.has(x))) continue;
    if (prefixCovered(table, c)) continue;
    const name = `ix_${table}_${c.join('_')}`.slice(0, 60);
    try { db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${c.join(', ')})`); made.push(name); } catch { /* a view or a damaged table: the data check reports it */ }
  }
  return made;
}

/** An index that only repeats the start of a longer index slows every write and adds nothing. */
export function dropRedundantIndexes(): string[] {
  const dropped: string[] = [];
  for (const t of (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(x => x.name)) {
    const all = (db.prepare(`PRAGMA index_list(${t})`).all() as { name: string; unique: number; origin: string; partial: number }[]).filter(i => !i.partial)
      .map(i => ({ ...i, c: (db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[]).map(x => x.name) }));
    for (const a of all) {
      if (a.origin !== 'c' || a.unique) continue;
      if (all.some(b => b !== a && b.c.length > a.c.length && a.c.every((x, k) => b.c[k] === x))) { db.exec(`DROP INDEX IF EXISTS ${a.name}`); dropped.push(a.name); }
    }
  }
  return dropped;
}

export function upgradeDatabase() {
  const fk = addForeignKeys(), ix = ensureIndexes(), dropped = dropRedundantIndexes();
  db.exec('ANALYZE');
  db.pragma('optimize');
  return { ...fk, indexes: ix, dropped };
}
