import { readdir, readFile } from 'node:fs/promises';
import { db } from '../db.mjs';

try {
  // Ensure migration table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const appliedRows = (await db.query('SELECT version FROM schema_migrations')).rows;
  const applied = new Set(appliedRows.map(r => Number(r.version)));

  const dir = new URL('../db/', import.meta.url);
  const files = (await readdir(dir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) continue;
    const version = Number(match[1]);
    if (applied.has(version)) continue;

    console.log(`Applying migration ${version} (${file})...`);
    const sql = await readFile(new URL(file, dir), 'utf8');
    await db.query(sql);
    await db.query('INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING', [version]);
    console.log(`Migration ${version} applied successfully.`);
  }

  console.log('All database migrations up to date.');
} finally {
  if (db) await db.end();
}
