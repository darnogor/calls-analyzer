import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL');
  }
  const dir = process.env.MIGRATIONS_DIR || join(__dirname, '../../../migrations');
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  let client;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      client = await pool.connect();
      break;
    } catch (error) {
      if (attempt === 20) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!client) {
    throw new Error('postgres is not reachable');
  }
  try {
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const files = (await readdir(dir))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const existing = await client.query('select id from schema_migrations where id = $1', [file]);
      if (existing.rowCount) {
        continue;
      }
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (id) values ($1)', [file]);
        await client.query('commit');
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
