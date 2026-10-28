import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Response } from 'express';
import { Pool } from 'pg';
import { createPrisma, type PrismaClient } from '@calls/db';
import { hashPassword } from '../src/auth/password';
import { SessionService } from '../src/auth/session.service';
import { verifySession } from '../src/auth/session-token';
import { SessionTokens } from '../src/auth/session-tokens';
import { presentCall, type CallRow } from '../src/calls/present-call';
import { AppConfig } from '../src/config';
import { Database } from '../src/db/database';
import { ApiError } from '../src/errors';

const SECRET = 'test-session-secret-value';
const INSTANT = '2026-10-22T22:30:00.000Z';
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://calls:calls@127.0.0.1:5432/calls';

describe('login email', () => {
  let db: Database;
  let service: SessionService;

  before(async () => {
    db = new Database({ databaseUrl } as AppConfig);
    await db.onModuleInit();
    service = new SessionService(db, new SessionTokens({ sessionSecret: SECRET } as AppConfig));
    await db.client.$executeRaw`
      delete from accounts
      where lower(email) in ('a_b@example.com', 'axb@example.com')
    `;
  });

  after(async () => {
    await db.client.$executeRaw`
      delete from accounts
      where lower(email) in ('a_b@example.com', 'axb@example.com')
    `;
    await db.onModuleDestroy();
  });

  it('does not treat an underscore in the local part as a wildcard', async () => {
    const password = 'secret-password';
    const passwordHash = await hashPassword(password);
    const wildcardId = randomUUID();
    const exactId = randomUUID();
    await insertAccount(db.client, wildcardId, 'axb@example.com', passwordHash);
    await assert.rejects(
      () => service.login({ email: 'a_b@example.com', password }, response()),
      (error: unknown) => error instanceof ApiError && error.status === 401,
    );

    await insertAccount(db.client, exactId, 'a_b@example.com', passwordHash);
    assert.equal(accountId(await login(service, 'a_b@example.com', password)), exactId);
    assert.equal(accountId(await login(service, 'A_B@Example.com', password)), exactId);
    assert.equal(accountId(await login(service, 'axb@example.com', password)), wildcardId);
  });
});

describe('timestamptz round trip', () => {
  let db: Database;
  const projectId = randomUUID();
  const sourceId = randomUUID();
  const callId = randomUUID();

  before(async () => {
    await setDatabaseTimeZone('Europe/Moscow');
    const plain = new Pool({ connectionString: databaseUrl });
    try {
      const shown = await plain.query<{ TimeZone: string }>('SHOW TIME ZONE');
      assert.equal(shown.rows[0]?.TimeZone, 'Europe/Moscow');
    } finally {
      await plain.end();
    }
    db = new Database({ databaseUrl } as AppConfig);
    await db.onModuleInit();
  });

  after(async () => {
    if (db) {
      await db.client.$executeRaw`delete from calls where id = ${callId}::uuid`;
      await db.client.$executeRaw`delete from sources where id = ${sourceId}::uuid`;
      await db.client.$executeRaw`delete from projects where id = ${projectId}::uuid`;
      await db.onModuleDestroy();
    }
    await setDatabaseTimeZone(null);
  });

  it('keeps the instant and agrees with the project-timezone day filter', async () => {
    const zone = await db.client.$queryRaw<Array<{ TimeZone: string }>>`SHOW TIME ZONE`;
    assert.equal(zone[0]?.TimeZone, 'UTC');

    await db.client.project.create({
      data: { id: projectId, name: 'Москва', timezone: 'Europe/Moscow', min_call_duration_sec: 180 },
    });
    await db.client.source.create({
      data: { id: sourceId, project_id: projectId, kind: 'manual', display_name: 'Ручная загрузка' },
    });
    await db.client.call.create({
      data: {
        id: callId,
        project_id: projectId,
        source_id: sourceId,
        external_id: callId,
        started_at: new Date(INSTANT),
        deal_link_status: 'absent',
        processing_status: 'recording_pending',
      },
    });

    const stored = await db.client.call.findUnique({ where: { id: callId }, select: { started_at: true } });
    const card = presentCall(callRow(callId, stored!.started_at));
    assert.equal(card.started_at, INSTANT);

    const listed = await db.query<{ started_at: Date | string }>(
      'select c.started_at from calls c where c.id = $1',
      [callId],
    );
    assert.equal(presentCall(callRow(callId, listed.rows[0]!.started_at)).started_at, INSTANT);

    const local = await db.query<{ local_started: string }>(
      `select to_char(c.started_at at time zone p.timezone, 'YYYY-MM-DD HH24:MI:SS') as local_started
       from calls c
       join projects p on p.id = c.project_id
       where c.id = $1`,
      [callId],
    );
    assert.equal(local.rows[0]?.local_started, '2026-10-23 01:30:00');

    assert.equal(await dayCount(db, callId, '2026-10-23'), 1);
    assert.equal(await dayCount(db, callId, '2026-10-22'), 0);
  });
});

async function login(service: SessionService, email: string, password: string): Promise<string> {
  const res = response();
  await service.login({ email, password }, res);
  const header = res.headers.find((value) => value.startsWith('session='));
  assert.ok(header);
  return header.slice('session='.length).split(';')[0] ?? '';
}

function accountId(token: string): string | null {
  return verifySession(token, SECRET);
}

function response(): Response & { headers: string[] } {
  const headers: string[] = [];
  return {
    headers,
    setHeader(_name: string, value: string) {
      headers.push(value);
    },
  } as Response & { headers: string[] };
}

async function insertAccount(client: PrismaClient, id: string, email: string, passwordHash: string): Promise<void> {
  await client.account.create({
    data: {
      id,
      email,
      name: email,
      password_hash: passwordHash,
      is_administrator: false,
      is_active: true,
    },
  });
}

async function dayCount(db: Database, callId: string, day: string): Promise<number> {
  const result = await db.query<{ total: number }>(
    `select count(*)::int as total
     from calls c
     join projects p on p.id = c.project_id
     where c.id = $1
       and (c.started_at at time zone p.timezone) >= $2::timestamp
       and (c.started_at at time zone p.timezone) < ($2::date + interval '1 day')`,
    [callId, day],
  );
  return result.rows[0]?.total ?? 0;
}

function callRow(id: string, startedAt: Date | string): CallRow {
  return {
    id,
    started_at: startedAt,
    duration_sec: null,
    direction: null,
    phone: null,
    company_name: null,
    deal_name: null,
    deal_link_status: 'absent',
    deal_status_at_call_name: null,
    current_deal_status_name: null,
    deal_external_url: null,
    processing_status: 'recording_pending',
    error: null,
    context_json: { notes: null, fields: [] },
    recording_storage_key: null,
    source_kind: 'manual',
    source_provider: null,
    source_display_name: 'Ручная загрузка',
    manager_id: null,
    manager_name: null,
    contact_id: null,
    contact_name: null,
    contact_external_url: null,
    stages_json: null,
    overall_score: null,
    summary: null,
    extras_json: null,
    transcript_json: null,
  };
}

async function setDatabaseTimeZone(timeZone: string | null): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const sql = timeZone
      ? `SELECT format('ALTER DATABASE %I SET TIME ZONE %L', current_database(), $1::text) AS statement`
      : `SELECT format('ALTER DATABASE %I RESET TIME ZONE', current_database()) AS statement`;
    const planned = await pool.query<{ statement: string }>(sql, timeZone ? [timeZone] : []);
    await pool.query(planned.rows[0]!.statement);
  } finally {
    await pool.end();
  }
}
