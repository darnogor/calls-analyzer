import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const base = process.env.BASE_URL ?? 'https://127.0.0.1';

function dockerPrefix() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return ['docker'];
  } catch {
    return ['sudo', 'docker'];
  }
}

const dockerCommand = dockerPrefix();

function docker(args, input) {
  try {
    return execFileSync(dockerCommand[0], [...dockerCommand.slice(1), ...args], {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? '';
    if (stderr) {
      process.stderr.write(stderr);
    }
    throw error;
  }
}

function psql(sql) {
  return docker([
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'calls',
    '-d',
    'calls',
    '-v',
    'ON_ERROR_STOP=1',
    '-tA',
    '-c',
    sql,
  ]).trim();
}

function redisMessages(queue = 'calls.audio.fetch') {
  const raw = docker(['compose', 'exec', '-T', 'redis', 'redis-cli', 'LRANGE', queue, '0', '-1']);
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

let workersPaused = false;

function pausePipeline() {
  docker(['compose', 'pause', 'media', 'transcriber', 'analyzer']);
  workersPaused = true;
}

function resumePipeline() {
  if (!workersPaused) {
    return;
  }
  docker(['compose', 'unpause', 'media', 'transcriber', 'analyzer']);
  workersPaused = false;
}

process.on('exit', () => {
  if (!workersPaused) {
    return;
  }
  try {
    resumePipeline();
  } catch (error) {
    console.error(error);
  }
});

function wavSeconds(seconds) {
  const sampleRate = 8000;
  const dataSize = Math.round(seconds * sampleRate) * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function waitForCall(projectId, callId, cookie, ready) {
  let last = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const card = await api(`/api/projects/${projectId}/calls/${callId}`, { cookie });
    last = card.body;
    if (card.status === 200 && ready(card.body)) {
      return card.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`call ${callId} did not reach the expected state: ${JSON.stringify(last)}`);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) {
    headers.set('cookie', options.cookie);
  }
  let body;
  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  } else if (options.raw !== undefined) {
    body = options.raw;
  }
  const response = await fetch(new URL(path, base), {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  const text = await response.text();
  let parsed = text;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  } else {
    parsed = null;
  }
  return {
    status: response.status,
    body: parsed,
    text,
    setCookie: response.headers.getSetCookie(),
  };
}

function sessionCookie(setCookie) {
  const line = setCookie.find((value) => value.startsWith('session='));
  assert.ok(line, `session cookie missing: ${setCookie.join(' | ')}`);
  return line.split(';')[0];
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const startedAt = '2026-04-28T16:42:00+03:00';

const health = await api('/health');
assert.equal(health.status, 200);
assert.match(health.text, /^ok/);

const home = await api('/');
assert.equal(home.status, 200);
assert.match(home.text, /Call Analytics/);

for (const service of ['api', 'media', 'transcriber', 'analyzer']) {
  const output = docker([
    'compose',
    'exec',
    '-T',
    service,
    'node',
    '-e',
    "fetch('http://127.0.0.1:3000/health').then(async (r)=>{const t=await r.text(); if(!r.ok||t!=='ok') process.exit(1); console.log(t);}).catch(()=>process.exit(1))",
  ]).trim();
  assert.equal(output, 'ok', service);
}

pausePipeline();

assert.equal((await api('/api/me')).status, 401);
assert.deepEqual((await api('/api/me')).body, { error: 'unauthenticated' });
assert.equal(
  (await api('/api/session', { method: 'POST', json: { email: 'admin@example.com', password: 'wrong' } })).status,
  401,
);

const login = await api('/api/session', {
  method: 'POST',
  json: { email: 'Admin@Example.com', password: 'admin-password' },
});
assert.equal(login.status, 204);
assert.match(login.setCookie[0], /HttpOnly/i);
assert.match(login.setCookie[0], /Secure/i);
assert.match(login.setCookie[0], /SameSite=Lax/i);
const admin = sessionCookie(login.setCookie);

const me = await api('/api/me', { cookie: admin });
assert.equal(me.status, 200);
assert.equal(me.body.email, 'admin@example.com');
assert.equal(me.body.is_administrator, true);
assert.deepEqual(me.body.projects, []);

const created = await api('/api/projects', { method: 'POST', cookie: admin, json: { name: 'Отдел продаж' } });
assert.equal(created.status, 201);
assert.equal(created.body.name, 'Отдел продаж');
assert.equal(created.body.timezone, 'Europe/Moscow');
assert.equal(created.body.min_call_duration_sec, 180);
const projectId = created.body.id;

const projects = await api('/api/projects', { cookie: admin });
const listed = projects.body.items.find((item) => item.id === projectId);
assert.equal(listed.timezone, 'Europe/Moscow');
assert.equal(listed.min_call_duration_sec, undefined);

const short = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  json: { started_at: startedAt, duration_sec: 40, manager: { name: 'Анна' } },
});
assert.equal(short.status, 422);
assert.deepEqual(short.body, {
  error: 'duration_below_minimum',
  min_call_duration_sec: 180,
  duration_sec: 40,
});
assert.equal(psql(`select count(*) from calls where project_id = ${quote(projectId)}`), '0');

const payload = {
  started_at: startedAt,
  duration_sec: 180,
  direction: 'out',
  phone: '+79990000000',
  manager: { name: 'Анна Петрова' },
  contact: { name: 'Алексей Смирнов' },
  company_name: 'ООО Альфа',
  deal: { name: 'Поставка', status_at_call_name: 'Переговоры' },
  context: {
    notes: 'заметка',
    fields: [{ key: 'segment', label: 'Сегмент', value: 'enterprise' }],
  },
};
function manualForm() {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  form.append('file', new Blob(['audio-bytes'], { type: 'audio/mpeg' }), 'call.mp3');
  return form;
}
const before = redisMessages().length;
const uploaded = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  form: manualForm(),
  headers: { 'idempotency-key': 'manual-1' },
});
assert.equal(uploaded.status, 201);
assert.equal(uploaded.body.created, true);
assert.equal(uploaded.body.processing_status, 'audio_queued');
const callId = uploaded.body.id;

const queued = redisMessages();
assert.equal(queued.length, before + 1);
const message = queued.at(-1);
assert.equal(message.project_id, projectId);
assert.equal(message.call_id, callId);
assert.equal(message.attempt, 1);
assert.deepEqual(message.audio, {
  type: 'object',
  bucket: 'recordings',
  key: `projects/${projectId}/calls/${callId}.mp3`,
  content_type: 'audio/mpeg',
});

const replay = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  form: manualForm(),
  headers: { 'idempotency-key': 'manual-1' },
});
assert.equal(replay.status, 200);
assert.equal(replay.body.created, false);
assert.equal(replay.body.id, callId);
assert.equal(redisMessages().length, before + 1);

const card = await api(`/api/projects/${projectId}/calls/${callId}`, { cookie: admin });
assert.equal(card.status, 200);
assert.equal(card.body.processing_status, 'audio_queued');
assert.equal(card.body.stages, null);
assert.equal(card.body.summary, null);
assert.equal(card.body.transcript, null);
assert.equal(card.body.overall_score, null);
assert.equal(card.body.has_recording, true);
assert.equal(card.body.company_name, 'ООО Альфа');
assert.equal(card.body.manager.name, 'Анна Петрова');
assert.equal(card.body.contact.name, 'Алексей Смирнов');
assert.equal(card.body.deal.name, 'Поставка');
assert.equal(card.body.deal.link_status, 'linked');
assert.equal(card.body.deal.status_name, 'Переговоры');
assert.equal(card.body.deal.status_at_call_name, 'Переговоры');
assert.equal(card.body.source.kind, 'manual');
assert.equal(card.body.source.provider, null);
assert.equal(card.body.source.display_name, 'Ручная загрузка');
assert.equal(card.body.context.notes, 'заметка');
assert.equal('error' in card.body, false);

const storageScript = `
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
(async () => {
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
  const head = await s3.send(new HeadObjectCommand({
    Bucket: 'recordings',
    Key: ${JSON.stringify(`projects/${projectId}/calls/${callId}.mp3`)},
  }));
  if (!head.ContentLength) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
`;
docker(['compose', 'exec', '-T', 'api', 'node', '-'], storageScript);

assert.equal((await api(`/api/projects/${projectId}/calls`, { cookie: admin })).body.total, 0);
const progress = await api(`/api/projects/${projectId}/calls?view=progress`, { cookie: admin });
assert.equal(progress.body.total, 1);
assert.equal(progress.body.items[0].id, callId);
assert.equal(progress.body.items[0].processing_status, 'audio_queued');
assert.equal(progress.body.items[0].stages, undefined);

const pending = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  json: { external_id: 'pending-1', started_at: startedAt, manager: { name: 'Борис' } },
});
assert.equal(pending.status, 201);
assert.equal(pending.body.created, true);
assert.equal(pending.body.processing_status, 'recording_pending');
assert.equal(redisMessages().filter((item) => item.call_id === pending.body.id).length, 0);

const attached = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  json: {
    external_id: 'pending-1',
    started_at: startedAt,
    recording: { type: 'url', url: 'https://records.example/abc.mp3' },
  },
});
assert.equal(attached.status, 200);
assert.equal(attached.body.created, false);
assert.equal(attached.body.id, pending.body.id);
assert.equal(attached.body.processing_status, 'audio_queued');
assert.equal(
  redisMessages().filter((item) => item.call_id === pending.body.id && item.audio.type === 'url').length,
  1,
);

const attachedAgain = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  json: {
    external_id: 'pending-1',
    started_at: startedAt,
    recording: { type: 'url', url: 'https://records.example/other.mp3' },
  },
});
assert.equal(attachedAgain.status, 200);
assert.equal(attachedAgain.body.processing_status, 'audio_queued');
assert.equal(redisMessages().filter((item) => item.call_id === pending.body.id).length, 1);

assert.equal(
  (await api(`/api/projects/${projectId}/calls`, {
    method: 'POST',
    cookie: admin,
    json: { started_at: startedAt, duration_sec: 179 },
  })).status,
  422,
);

const shared = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  json: {
    external_id: 'shared-1',
    started_at: startedAt,
    duration_sec: 200,
    manager: { external_id: 'user-1', name: 'Анна Петрова' },
    recording: { type: 'url', url: 'https://records.example/shared.mp3' },
  },
});
assert.equal(shared.status, 201);
assert.equal(shared.body.processing_status, 'audio_queued');
const renamed = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  json: {
    external_id: 'shared-2',
    started_at: startedAt,
    duration_sec: 200,
    manager: { external_id: 'user-1', name: 'Анна Новая' },
    recording: { type: 'url', url: 'https://records.example/shared-2.mp3' },
  },
});
assert.equal(renamed.status, 201);
assert.equal(
  psql(`select count(*) from managers where project_id = ${quote(projectId)} and external_id = 'user-1'`),
  '1',
);
assert.equal(
  psql(`select name from managers where project_id = ${quote(projectId)} and external_id = 'user-1'`),
  'Анна Новая',
);
assert.equal(
  redisMessages().filter((item) => item.call_id === shared.body.id && item.audio.type === 'url').length,
  1,
);

const malformed = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  raw: '{',
  headers: { 'content-type': 'application/json' },
});
assert.equal(malformed.status, 422);
assert.deepEqual(malformed.body, { error: 'invalid_payload' });

const leadId = randomUUID();
const salesId = randomUUID();
const leadEmail = `lead-${leadId.slice(0, 8)}@example.com`;
const salesEmail = `sales-${salesId.slice(0, 8)}@example.com`;
const leadHash = bcrypt.hashSync('lead-password', 4);
const salesHash = bcrypt.hashSync('sales-password', 4);
psql(
  `insert into accounts (id, email, name, password_hash, is_administrator, is_active)
   values (${quote(leadId)}, ${quote(leadEmail)}, 'Руководитель', ${quote(leadHash)}, false, true),
          (${quote(salesId)}, ${quote(salesEmail)}, 'Менеджер', ${quote(salesHash)}, false, true)`,
);
psql(
  `insert into project_memberships (id, account_id, project_id, role)
   values (${quote(randomUUID())}, ${quote(leadId)}, ${quote(projectId)}, 'lead'),
          (${quote(randomUUID())}, ${quote(salesId)}, ${quote(projectId)}, 'sales_manager')`,
);

const other = await api('/api/projects', { method: 'POST', cookie: admin, json: { name: 'Чужой' } });
assert.equal(other.status, 201);

const leadLogin = await api('/api/session', {
  method: 'POST',
  json: { email: leadEmail, password: 'lead-password' },
});
const lead = sessionCookie(leadLogin.setCookie);
const leadMe = await api('/api/me', { cookie: lead });
assert.equal(leadMe.body.is_administrator, false);
assert.equal(leadMe.body.projects[0].role, 'lead');
assert.equal((await api('/api/projects', { method: 'POST', cookie: lead, json: { name: 'Нет' } })).status, 403);
assert.equal((await api(`/api/projects/${other.body.id}/calls`, { cookie: lead })).status, 404);

const salesLogin = await api('/api/session', {
  method: 'POST',
  json: { email: salesEmail, password: 'sales-password' },
});
const sales = sessionCookie(salesLogin.setCookie);
assert.equal(
  (await api(`/api/projects/${projectId}/calls`, {
    method: 'POST',
    cookie: sales,
    json: { started_at: startedAt },
  })).status,
  403,
);
assert.equal((await api(`/api/projects/${projectId}/calls?view=progress`, { cookie: sales })).status, 403);
assert.equal((await api(`/api/projects/${projectId}/calls?view=problems`, { cookie: sales })).status, 403);
assert.equal((await api(`/api/projects/${projectId}/calls`, { cookie: sales })).status, 200);

const sourceId = psql(`select id from sources where project_id = ${quote(projectId)} and kind = 'manual'`);
const managerId = randomUUID();
psql(
  `insert into managers (id, project_id, source_id, name, is_active)
   values (${quote(managerId)}, ${quote(projectId)}, ${quote(sourceId)}, 'Анна Петрова', true)`,
);
const lowId = randomUUID();
const highId = randomUUID();
const failedId = randomUUID();
const stagesLow = [
  { key: 'opening', title: 'Открытие', weight: 15, high_score: 'Начало разговора и установление контакта', status: 'scored', score: 3, reason: 'Хорошо', evidence_ids: ['t1'] },
  { key: 'needs', title: 'Потребность', weight: 30, high_score: 'Выявление ситуации, проблемы и критериев выбора', status: 'scored', score: 3, reason: 'Нормально', evidence_ids: ['t1'] },
  { key: 'presentation', title: 'Презентация', weight: 20, high_score: 'Конкретность предложения под сказанное клиентом', status: 'scored', score: 2, reason: 'Общо', evidence_ids: ['t1'] },
  { key: 'objections', title: 'Возражения', weight: 20, high_score: 'Работа с возражениями, включая стоимость', status: 'scored', score: 1, reason: 'Слабо', evidence_ids: ['t1'] },
  { key: 'closing', title: 'Закрытие', weight: 15, high_score: 'Зафиксирован ли следующий шаг', status: 'scored', score: 2, reason: 'Нет шага', evidence_ids: ['t1'] },
];
const stagesHigh = stagesLow.map((stage) =>
  stage.key === 'objections' ? { ...stage, score: 4, reason: 'Сильно' } : stage,
);
function insertCompleted(id, externalId, started, company, dealStatus, stages, overall) {
  psql(
    `insert into calls (
       id, project_id, source_id, external_id, manager_id, company_name, phone, started_at,
       duration_sec, deal_name, deal_status_at_call_name, current_deal_status_name, deal_link_status,
       context_json, processing_status
     ) values (
       ${quote(id)}, ${quote(projectId)}, ${quote(sourceId)}, ${quote(externalId)}, ${quote(managerId)},
       ${quote(company)}, '+79990000000', ${quote(started)}, 200, 'Поставка', ${quote(dealStatus)},
       ${quote(dealStatus)}, 'linked', '{"notes":null,"fields":[{"key":"segment","label":"Сегмент","value":"enterprise"}]}'::jsonb,
       'completed'
     )`,
  );
  psql(
    `insert into call_analysis (id, call_id, stages_json, overall_score, summary, transcript_json)
     values (
       ${quote(randomUUID())}, ${quote(id)}, ${quote(JSON.stringify(stages))}::jsonb, ${overall},
       'Краткий вывод', '[{"speaker":"manager","start":0,"end":4.5,"text":"Добрый день"}]'::jsonb
     )`,
  );
}
insertCompleted(lowId, 'low-1', '2026-10-13T10:00:00+03:00', 'ООО Альфа', 'Переговоры', stagesLow, 67);
insertCompleted(highId, 'high-1', '2026-10-14T00:30:00+03:00', 'Бета', 'Счет выставлен', stagesHigh, 80);
psql(
  `insert into calls (
     id, project_id, source_id, external_id, started_at, deal_link_status, processing_status, error
   ) values (
     ${quote(failedId)}, ${quote(projectId)}, ${quote(sourceId)}, 'failed-1', '2026-10-13T12:00:00+03:00',
     'absent', 'failed', '{"stage":"transcribe","message":"empty_transcript","attempts":3,"failed_at":"2026-10-13T12:40:00Z"}'::jsonb
   )`,
);

const completed = await api(`/api/projects/${projectId}/calls?sort=stage.objections&order=asc`, { cookie: admin });
assert.equal(completed.body.total, 2);
assert.equal(completed.body.items[0].id, lowId);
assert.deepEqual(completed.body.items[0].stages.find((stage) => stage.key === 'objections'), {
  key: 'objections',
  status: 'scored',
  score: 1,
});
assert.equal(completed.body.items[0].overall_score, 67);
assert.equal(completed.body.items[0].deal.status_name, 'Переговоры');
assert.equal(completed.body.items[0].processing_status, undefined);

const october13 = await api(
  `/api/projects/${projectId}/calls?date_from=2026-10-13&date_to=2026-10-13`,
  { cookie: admin },
);
assert.deepEqual(october13.body.items.map((item) => item.id), [lowId]);
const october14 = await api(
  `/api/projects/${projectId}/calls?date_from=2026-10-14&date_to=2026-10-14`,
  { cookie: admin },
);
assert.deepEqual(october14.body.items.map((item) => item.id), [highId]);

const found = await api(`/api/projects/${projectId}/calls?q=${encodeURIComponent('альфа')}`, { cookie: admin });
assert.deepEqual(found.body.items.map((item) => item.id), [lowId]);
const byDeal = await api(
  `/api/projects/${projectId}/calls?deal_status=${encodeURIComponent('Переговоры')}`,
  { cookie: admin },
);
assert.deepEqual(byDeal.body.items.map((item) => item.id), [lowId]);
const byField = await api(
  `/api/projects/${projectId}/calls?field_key=segment&field_value=enterprise&manager_id=${managerId}`,
  { cookie: admin },
);
assert.equal(byField.body.total, 2);
assert.equal((await api(`/api/projects/${projectId}/calls?field_key=segment`, { cookie: admin })).status, 400);
assert.equal((await api(`/api/projects/${projectId}/calls?sort=stage.missing`, { cookie: admin })).status, 400);
assert.equal((await api(`/api/projects/${projectId}/calls?date_from=2026-02-31`, { cookie: admin })).status, 400);

const full = await api(`/api/projects/${projectId}/calls/${lowId}`, { cookie: admin });
assert.equal(full.body.processing_status, 'completed');
assert.equal(full.body.summary, 'Краткий вывод');
assert.equal(full.body.transcript[0].speaker, 'manager');
const objections = full.body.stages.find((stage) => stage.key === 'objections');
assert.equal(objections.status, 'scored');
assert.equal(objections.high_score, 'Работа с возражениями, включая стоимость');
assert.equal(objections.weight, 20);
assert.equal(objections.score, 1);
assert.equal(objections.reason, 'Слабо');

const problems = await api(`/api/projects/${projectId}/calls?view=problems`, { cookie: admin });
assert.equal(problems.body.items.some((item) => item.id === failedId), true);
const failed = problems.body.items.find((item) => item.id === failedId);
assert.equal(failed.processing_status, 'failed');
assert.equal(failed.error.message, 'empty_transcript');
assert.equal(failed.stages, undefined);
const failedCard = await api(`/api/projects/${projectId}/calls/${failedId}`, { cookie: sales });
assert.equal(failedCard.body.error.message, 'empty_transcript');
assert.equal(failedCard.body.stages, null);

const doneId = randomUUID();
psql(
  `insert into calls (id, project_id, source_id, external_id, started_at, deal_link_status, processing_status)
   values (${quote(doneId)}, ${quote(projectId)}, ${quote(sourceId)}, 'done-1', '2026-10-13T08:00:00+03:00', 'absent', 'completed')`,
);
const queueBeforeReopen = redisMessages().filter((item) => item.call_id === doneId).length;
const reopened = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  json: {
    external_id: 'done-1',
    started_at: startedAt,
    recording: { type: 'url', url: 'https://records.example/late.mp3' },
  },
});
assert.equal(reopened.status, 200);
assert.equal(reopened.body.created, false);
assert.equal(reopened.body.processing_status, 'completed');
assert.equal(redisMessages().filter((item) => item.call_id === doneId).length, queueBeforeReopen);

psql(`update accounts set is_active = false where id = ${quote(leadId)}`);
assert.equal((await api('/api/me', { cookie: lead })).status, 401);

const shortForm = new FormData();
shortForm.append('payload', JSON.stringify({ started_at: startedAt, direction: 'out' }));
shortForm.append('file', new Blob([wavSeconds(1)], { type: 'audio/wav' }), 'short.wav');
const shortUpload = await api(`/api/projects/${projectId}/calls`, {
  method: 'POST',
  cookie: admin,
  form: shortForm,
});
assert.equal(shortUpload.status, 201);
assert.equal(shortUpload.body.processing_status, 'audio_queued');
const shortId = shortUpload.body.id;

const loggedOut = await api('/api/session', { method: 'DELETE', cookie: admin });
assert.equal(loggedOut.status, 204);
assert.match(loggedOut.setCookie[0], /Max-Age=0/i);
assert.equal((await api('/api/me')).status, 401);

const again = await api('/api/session', {
  method: 'POST',
  json: { email: 'admin@example.com', password: 'admin-password' },
});
assert.equal(again.status, 204);
const adminAgain = sessionCookie(again.setCookie);

resumePipeline();

const shortCard = await waitForCall(projectId, shortId, adminAgain, (body) => body.processing_status === 'skipped_short');
assert.equal(shortCard.duration_sec, 1);
assert.equal('error' in shortCard, false);
assert.equal(redisMessages('calls.transcribe').some((item) => item.call_id === shortId), false);
assert.equal(
  psql(`select coalesce(transcript_json::text, '') from call_analysis where call_id = ${quote(shortId)}`),
  '',
);

const failedSpeech = await waitForCall(
  projectId,
  callId,
  adminAgain,
  (body) => body.processing_status === 'failed' && body.error?.message === 'provider_unavailable',
);
assert.equal(failedSpeech.error.stage, 'transcribe');
assert.equal(failedSpeech.error.attempts, 3);
assert.equal(redisMessages('calls.analyze').some((item) => item.call_id === callId), false);

console.log('e2e ok');
