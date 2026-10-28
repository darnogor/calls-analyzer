import { createPrisma } from '@calls/db';
import { randomUUID } from 'node:crypto';
import { DEFAULT_MIN_CALL_DURATION_SEC, DEFAULT_TIMEZONE, MANUAL_SOURCE_NAME } from '../projects/defaults';
import {
  DEMO_CARD_KEY,
  DEMO_CLIENTS,
  DEMO_DEAL_STAGES,
  DEMO_MANAGERS,
  DEMO_PRODUCT_FACTS,
  DEMO_PROJECT_NAME,
  DEMO_SCORING_PROMPT,
  DEMO_STAGES,
  sameStageList,
} from './pro-tehnik';

export async function seedProTehnik(databaseUrl = process.env.DATABASE_URL): Promise<{ projectId: string }> {
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL');
  }
  const db = createPrisma(databaseUrl);
  try {
    const projectId = await ensureProject(db);
    const sourceId = await ensureManualSource(db, projectId);
    await ensurePeople(db, projectId, sourceId, 'manager', DEMO_MANAGERS);
    await ensurePeople(db, projectId, sourceId, 'client', DEMO_CLIENTS);
    await ensureDealStages(db, projectId);
    await ensureScorecard(db, projectId);
    await ensureText(db, projectId, 'prompt', DEMO_SCORING_PROMPT);
    await ensureText(db, projectId, 'facts', DEMO_PRODUCT_FACTS);
    return { projectId };
  } finally {
    await db.$disconnect();
  }
}

async function ensureProject(db: ReturnType<typeof createPrisma>): Promise<string> {
  const existing = await db.project.findFirst({
    where: { name: DEMO_PROJECT_NAME },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }
  const id = randomUUID();
  await db.project.create({
    data: {
      id,
      name: DEMO_PROJECT_NAME,
      timezone: DEFAULT_TIMEZONE,
      min_call_duration_sec: DEFAULT_MIN_CALL_DURATION_SEC,
    },
  });
  return id;
}

async function ensureManualSource(db: ReturnType<typeof createPrisma>, projectId: string): Promise<string> {
  const existing = await db.source.findFirst({
    where: { project_id: projectId, kind: 'manual' },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }
  const id = randomUUID();
  await db.source.create({
    data: {
      id,
      project_id: projectId,
      kind: 'manual',
      display_name: MANUAL_SOURCE_NAME,
    },
  });
  return id;
}

async function ensurePeople(
  db: ReturnType<typeof createPrisma>,
  projectId: string,
  sourceId: string,
  kind: 'manager' | 'client',
  names: readonly string[],
): Promise<void> {
  if (kind === 'manager') {
    const existing = await db.manager.findMany({ where: { project_id: projectId }, select: { name: true } });
    const have = new Set(existing.map((row) => row.name));
    for (const name of names) {
      if (have.has(name)) {
        continue;
      }
      await db.manager.create({
        data: {
          id: randomUUID(),
          project_id: projectId,
          source_id: sourceId,
          name,
          is_active: true,
        },
      });
    }
    return;
  }
  const existing = await db.contact.findMany({ where: { project_id: projectId }, select: { name: true } });
  const have = new Set(existing.map((row) => row.name));
  for (const name of names) {
    if (have.has(name)) {
      continue;
    }
    await db.contact.create({
      data: {
        id: randomUUID(),
        project_id: projectId,
        source_id: sourceId,
        name,
      },
    });
  }
}

async function ensureDealStages(db: ReturnType<typeof createPrisma>, projectId: string): Promise<void> {
  const current = await db.dealStage.findMany({ where: { project_id: projectId } });
  const wanted = new Set<string>(DEMO_DEAL_STAGES);
  for (const [index, name] of DEMO_DEAL_STAGES.entries()) {
    const position = index + 1;
    const found = current.find((row) => row.name === name);
    if (!found) {
      await db.dealStage.create({
        data: { id: randomUUID(), project_id: projectId, position, name },
      });
    } else if (found.position !== position) {
      await db.dealStage.update({ where: { id: found.id }, data: { position } });
    }
  }
  for (const row of current) {
    if (!wanted.has(row.name)) {
      await db.dealStage.delete({ where: { id: row.id } });
    }
  }
}

async function ensureScorecard(db: ReturnType<typeof createPrisma>, projectId: string): Promise<void> {
  const latest = await db.scorecard.findFirst({
    where: { project_id: projectId },
    orderBy: { version: 'desc' },
    select: { version: true, card_key: true, stages_json: true },
  });
  if (latest && latest.card_key === DEMO_CARD_KEY && sameStageList(latest.stages_json, DEMO_STAGES)) {
    return;
  }
  await db.scorecard.create({
    data: {
      project_id: projectId,
      version: (latest?.version ?? 0) + 1,
      card_key: DEMO_CARD_KEY,
      stages_json: DEMO_STAGES,
    },
  });
}

async function ensureText(
  db: ReturnType<typeof createPrisma>,
  projectId: string,
  kind: 'prompt' | 'facts',
  body: string,
): Promise<void> {
  if (kind === 'prompt') {
    const latest = await db.scoringPrompt.findFirst({
      where: { project_id: projectId },
      orderBy: { version: 'desc' },
      select: { version: true, body: true },
    });
    if (latest?.body === body) {
      return;
    }
    await db.scoringPrompt.create({
      data: { project_id: projectId, version: (latest?.version ?? 0) + 1, body },
    });
    return;
  }
  const latest = await db.productFact.findFirst({
    where: { project_id: projectId },
    orderBy: { version: 'desc' },
    select: { version: true, body: true },
  });
  if (latest?.body === body) {
    return;
  }
  await db.productFact.create({
    data: { project_id: projectId, version: (latest?.version ?? 0) + 1, body },
  });
}

const seedEntry = (process.argv[1] ?? '').replaceAll('\\', '/');
if (seedEntry.endsWith('/demo/seed.ts') || seedEntry.endsWith('/demo/seed.js')) {
  seedProTehnik()
    .then((result) => {
      console.log(`seeded ${result.projectId}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
