import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AuthAccount } from '../auth/auth.guard';
import { ProjectAccess, type ProjectRecord } from '../access';
import { Database, isUniqueViolation, type Queryable } from '../db/database';
import { ApiError } from '../errors';
import { isUuid } from '../ids';
import { audioFetchMessage, AudioQueue } from '../queue/audio-queue';
import { Recordings } from '../storage/recordings';
import { audioObject, recordingContentType } from './audio-ext';
import { loadCurrentStages } from '../projects/scorecard';
import { durationBelowMinimum } from './duration';
import { parseListQuery, requestedAction } from './list-query';
import { presentCall, presentListItem, type CallRow } from './present-call';
import { foldedColumn, likeContains } from './search';
import { validateIntake, type Intake } from './validate-intake';

export type UploadedPart = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export type CreateCallInput = {
  contentType?: string | string[];
  body: unknown;
  file?: UploadedPart;
  payloadFile?: UploadedPart;
  idempotencyKey?: string | string[];
};

type IntakeResult = {
  status: number;
  body: { id: string; created: boolean; processing_status: string };
};

const CALL_SELECT = `
  select
    c.id,
    c.started_at,
    c.duration_sec,
    c.direction,
    c.phone,
    c.company_name,
    c.deal_name,
    c.deal_link_status,
    c.deal_status_at_call_name,
    c.current_deal_status_name,
    c.deal_external_url,
    c.processing_status,
    c.error,
    c.context_json,
    c.recording_storage_key,
    s.kind as source_kind,
    s.provider as source_provider,
    s.display_name as source_display_name,
    m.id as manager_id,
    m.name as manager_name,
    ct.id as contact_id,
    ct.name as contact_name,
    ct.external_url as contact_external_url,
    ca.stages_json,
    ca.overall_score,
    ca.summary,
    ca.transcript_json
`;

const CALL_FROM = `
  from calls c
  join projects p on p.id = c.project_id
  join sources s on s.id = c.source_id
  left join managers m on m.id = c.manager_id
  left join contacts ct on ct.id = c.contact_id
  left join call_analysis ca on ca.call_id = c.id
`;

@Injectable()
export class CallsService {
  constructor(
    private readonly db: Database,
    private readonly access: ProjectAccess,
    private readonly queue: AudioQueue,
    private readonly recordings: Recordings,
  ) {}

  async list(account: AuthAccount, projectId: string, query: Record<string, unknown>) {
    const project = await this.access.require(account, projectId, requestedAction(query));
    const stageKeys = await this.stageKeys(project.id);
    const parsed = parseListQuery(query, stageKeys);
    const params: unknown[] = [project.id];
    const where = ['c.project_id = $1', statusFilter(parsed.view)];
    if (parsed.managerId) {
      params.push(parsed.managerId);
      where.push(`c.manager_id = $${params.length}`);
    }
    if (parsed.dateFrom) {
      params.push(parsed.dateFrom);
      where.push(`(c.started_at at time zone p.timezone) >= $${params.length}::timestamp`);
    }
    if (parsed.dateTo) {
      params.push(parsed.dateTo);
      where.push(`(c.started_at at time zone p.timezone) < ($${params.length}::date + interval '1 day')`);
    }
    if (parsed.q) {
      params.push(likeContains(parsed.q));
      const marker = `$${params.length}`;
      where.push(`(
        ${foldedColumn('ct.name')} like ${marker} escape '\\'
        or ${foldedColumn('c.company_name')} like ${marker} escape '\\'
        or ${foldedColumn('c.phone')} like ${marker} escape '\\'
        or ${foldedColumn('m.name')} like ${marker} escape '\\'
        or ${foldedColumn('c.deal_name')} like ${marker} escape '\\'
      )`);
    }
    if (parsed.dealStatus) {
      params.push(parsed.dealStatus);
      where.push(`c.current_deal_status_name = $${params.length}`);
    }
    if (parsed.field) {
      params.push(parsed.field.key, parsed.field.value);
      where.push(`exists (
        select 1
        from jsonb_array_elements(coalesce(c.context_json->'fields', '[]'::jsonb)) field
        where field->>'key' = $${params.length - 1} and field->>'value' = $${params.length}
      )`);
    }
    const whereSql = where.join(' and ');
    const total = await this.db.query<{ total: number }>(
      `select count(*)::int as total ${CALL_FROM} where ${whereSql}`,
      params,
    );
    const listParams = [...params];
    let orderSql = `c.started_at ${parsed.order} nulls last, c.id`;
    if (parsed.sort === 'manager') {
      orderSql = `m.name ${parsed.order} nulls last, c.id`;
    } else if (parsed.sort === 'overall') {
      orderSql = `ca.overall_score ${parsed.order} nulls last, c.id`;
    } else if (parsed.sort === 'stage') {
      listParams.push(parsed.stageKey);
      orderSql = `(
        select (elem->>'score')::int
        from jsonb_array_elements(coalesce(ca.stages_json, '[]'::jsonb)) elem
        where elem->>'key' = $${listParams.length}
      ) ${parsed.order} nulls last, c.id`;
    }
    listParams.push(parsed.perPage, (parsed.page - 1) * parsed.perPage);
    const rows = await this.db.query<CallRow>(
      `${CALL_SELECT} ${CALL_FROM}
       where ${whereSql}
       order by ${orderSql}
       limit $${listParams.length - 1} offset $${listParams.length}`,
      listParams,
    );
    return {
      page: parsed.page,
      per_page: parsed.perPage,
      total: total.rows[0]?.total ?? 0,
      items: rows.rows.map((row) => presentListItem(row, parsed.view)),
    };
  }

  async get(account: AuthAccount, projectId: string, callId: string) {
    const project = await this.access.require(account, projectId, 'read');
    if (!isUuid(callId)) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    const result = await this.db.query<CallRow>(
      `${CALL_SELECT} ${CALL_FROM} where c.project_id = $1 and c.id = $2`,
      [project.id, callId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    return presentCall(row);
  }

  async openRecording(
    account: AuthAccount,
    projectId: string,
    callId: string,
  ): Promise<{ stream: Readable; contentType: string; contentLength?: number }> {
    const project = await this.access.require(account, projectId, 'read');
    if (!isUuid(callId)) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    const result = await this.db.query<{
      recording_storage_key: string | null;
      recording_content_type: string | null;
    }>(
      `select recording_storage_key, recording_content_type
       from calls
       where project_id = $1 and id = $2`,
      [project.id, callId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    if (!row.recording_storage_key) {
      throw new ApiError(404, { error: 'recording_missing' });
    }
    const opened = await this.recordings.open(row.recording_storage_key);
    if (!opened) {
      throw new ApiError(404, { error: 'recording_missing' });
    }
    const file: { stream: Readable; contentType: string; contentLength?: number } = {
      stream: opened.stream,
      contentType: recordingContentType(row.recording_content_type),
    };
    if (opened.contentLength !== undefined) {
      file.contentLength = opened.contentLength;
    }
    return file;
  }

  async create(account: AuthAccount, projectId: string, input: CreateCallInput): Promise<IntakeResult> {
    const project = await this.access.require(account, projectId, 'write');
    const submitted = readSubmittedBody(input);
    const validated = validateIntake(submitted.raw);
    if (!validated.ok) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    if (submitted.file && validated.value.recording) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    if (submitted.file && submitted.file.size === 0) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const sourceId = await this.manualSource(project.id);
    try {
      return await this.insertOrReplay(project, sourceId, validated.value, submitted.file, idempotencyKey);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.insertOrReplay(project, sourceId, validated.value, submitted.file, idempotencyKey);
    }
  }

  private async insertOrReplay(
    project: ProjectRecord,
    sourceId: string,
    intake: Intake,
    file: UploadedPart | undefined,
    idempotencyKey: string | undefined,
  ): Promise<IntakeResult> {
    const existing = await this.findExisting(project.id, sourceId, idempotencyKey, intake.external_id);
    if (existing) {
      return this.replay(project, sourceId, existing.id, intake, file);
    }
    const rejection = durationBelowMinimum(intake.duration_sec, project.min_call_duration_sec);
    if (rejection) {
      throw new ApiError(422, rejection);
    }
    return this.insertNew(project, sourceId, intake, file, idempotencyKey);
  }

  private async findExisting(
    projectId: string,
    sourceId: string,
    idempotencyKey: string | undefined,
    externalId: string | undefined,
  ): Promise<{ id: string } | null> {
    let byKey: string | undefined;
    let byExternal: string | undefined;
    if (idempotencyKey) {
      const result = await this.db.query<{ id: string }>(
        `select id from calls where project_id = $1 and idempotency_key = $2`,
        [projectId, idempotencyKey],
      );
      byKey = result.rows[0]?.id;
    }
    if (externalId) {
      const result = await this.db.query<{ id: string }>(
        `select id from calls where project_id = $1 and source_id = $2 and external_id = $3`,
        [projectId, sourceId, externalId],
      );
      byExternal = result.rows[0]?.id;
    }
    if (byKey && byExternal && byKey !== byExternal) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const id = byKey ?? byExternal;
    return id ? { id } : null;
  }

  private async insertNew(
    project: ProjectRecord,
    sourceId: string,
    intake: Intake,
    file: UploadedPart | undefined,
    idempotencyKey: string | undefined,
  ): Promise<IntakeResult> {
    const callId = randomUUID();
    const externalId = intake.external_id ?? randomUUID();
    const audio = file ? audioObject(file) : null;
    const storageKey = audio ? `projects/${project.id}/calls/${callId}.${audio.ext}` : null;
    const processingStatus = file || intake.recording ? 'audio_queued' : 'recording_pending';
    if (file && storageKey && audio) {
      await this.recordings.put(storageKey, file.buffer, audio.contentType);
    }
    try {
      await this.db.tx(async (client) => {
        const managerId = await upsertManager(client, project.id, sourceId, intake.manager);
        const contactId = await upsertContact(client, project.id, sourceId, intake.contact);
        const deal = storedDeal(intake.deal);
        await client.query(
          `insert into calls (
             id, project_id, source_id, external_id, idempotency_key,
             manager_id, contact_id, company_name, direction, phone, started_at, duration_sec,
             recording_source_url, recording_storage_key, recording_content_type,
             deal_external_id, deal_name, deal_status_at_call_name, current_deal_status_name,
             deal_external_url, deal_link_status, context_json, processing_status
           ) values (
             $1,$2,$3,$4,$5,
             $6,$7,$8,$9,$10,$11,$12,
             $13,$14,$15,
             $16,$17,$18,$19,
             $20,$21,$22::jsonb,$23
           )`,
          [
            callId,
            project.id,
            sourceId,
            externalId,
            idempotencyKey ?? null,
            managerId,
            contactId,
            intake.company_name ?? null,
            intake.direction ?? null,
            intake.phone ?? null,
            intake.started_at,
            intake.duration_sec ?? null,
            intake.recording?.url ?? null,
            storageKey,
            audio?.contentType ?? null,
            deal.external_id,
            deal.name,
            deal.status_at_call_name,
            deal.current_status_name,
            deal.external_url,
            deal.link_status,
            JSON.stringify(intake.context),
            processingStatus,
          ],
        );
        if (file && storageKey && audio) {
          await this.queue.enqueue(
            audioFetchMessage(project.id, callId, {
              type: 'object',
              bucket: this.recordings.bucket,
              key: storageKey,
              content_type: audio.contentType,
            }),
          );
        } else if (intake.recording) {
          await this.queue.enqueue(
            audioFetchMessage(project.id, callId, {
              type: 'url',
              url: intake.recording.url,
            }),
          );
        }
        await client.query('update sources set last_intake_at = now() where id = $1', [sourceId]);
      });
    } catch (error) {
      if (storageKey) {
        await this.recordings.remove(storageKey).catch((removeError) => {
          console.error('remove object', removeError);
        });
      }
      throw error;
    }
    return {
      status: 201,
      body: { id: callId, created: true, processing_status: processingStatus },
    };
  }

  private async replay(
    project: ProjectRecord,
    sourceId: string,
    callId: string,
    intake: Intake,
    file: UploadedPart | undefined,
  ): Promise<IntakeResult> {
    const preview = await this.db.query<{ processing_status: string }>(
      'select processing_status from calls where id = $1',
      [callId],
    );
    const current = preview.rows[0];
    if (!current) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    const kind = file ? 'file' : intake.recording ? 'url' : null;
    const canAttach =
      current.processing_status === 'recording_pending' || current.processing_status === 'recording_missing';
    if (!kind || !canAttach) {
      await this.db.query('update sources set last_intake_at = now() where id = $1', [sourceId]);
      return {
        status: 200,
        body: { id: callId, created: false, processing_status: current.processing_status },
      };
    }
    const rejection = durationBelowMinimum(intake.duration_sec, project.min_call_duration_sec);
    if (rejection) {
      throw new ApiError(422, rejection);
    }

    let storageKey: string | null = null;
    let contentType: string | null = null;
    if (file) {
      const audio = audioObject(file);
      storageKey = `projects/${project.id}/calls/${callId}.${audio.ext}`;
      contentType = audio.contentType;
      await this.recordings.put(storageKey, file.buffer, contentType);
    }

    try {
      const result = await this.db.tx(async (client) => {
        const locked = await client.query<{
          processing_status: string;
          recording_storage_key: string | null;
        }>('select processing_status, recording_storage_key from calls where id = $1 for update', [callId]);
        const status = locked.rows[0]?.processing_status;
        if (!status) {
          throw new ApiError(404, { error: 'call_not_found' });
        }
        if (status !== 'recording_pending' && status !== 'recording_missing') {
          await client.query('update sources set last_intake_at = now() where id = $1', [sourceId]);
          return {
            attached: false,
            keptKey: locked.rows[0]?.recording_storage_key ?? null,
            body: {
              status: 200,
              body: { id: callId, created: false, processing_status: status },
            } satisfies IntakeResult,
          };
        }
        if (file && storageKey && contentType) {
          await client.query(
            `update calls
             set processing_status = 'audio_queued',
                 recording_storage_key = $2,
                 recording_content_type = $3,
                 recording_source_url = null,
                 duration_sec = coalesce($4, duration_sec),
                 updated_at = now()
             where id = $1`,
            [callId, storageKey, contentType, intake.duration_sec ?? null],
          );
          await this.queue.enqueue(
            audioFetchMessage(project.id, callId, {
              type: 'object',
              bucket: this.recordings.bucket,
              key: storageKey,
              content_type: contentType,
            }),
          );
        } else if (intake.recording) {
          await client.query(
            `update calls
             set processing_status = 'audio_queued',
                 recording_source_url = $2,
                 recording_storage_key = null,
                 recording_content_type = null,
                 duration_sec = coalesce($3, duration_sec),
                 updated_at = now()
             where id = $1`,
            [callId, intake.recording.url, intake.duration_sec ?? null],
          );
          await this.queue.enqueue(
            audioFetchMessage(project.id, callId, { type: 'url', url: intake.recording.url }),
          );
        }
        await client.query('update sources set last_intake_at = now() where id = $1', [sourceId]);
        return {
          attached: true,
          keptKey: storageKey,
          body: {
            status: 200,
            body: { id: callId, created: false, processing_status: 'audio_queued' },
          } satisfies IntakeResult,
        };
      });
      if (!result.attached && storageKey && result.keptKey !== storageKey) {
        await this.recordings.remove(storageKey).catch((error) => console.error('remove object', error));
      }
      return result.body;
    } catch (error) {
      if (storageKey) {
        await this.recordings.remove(storageKey).catch((removeError) => console.error('remove object', removeError));
      }
      throw error;
    }
  }

  private async manualSource(projectId: string): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `select id from sources where project_id = $1 and kind = 'manual'`,
      [projectId],
    );
    const sourceId = result.rows[0]?.id;
    if (!sourceId) {
      throw new Error(`manual source missing for project ${projectId}`);
    }
    return sourceId;
  }

  private async stageKeys(projectId: string): Promise<string[]> {
    const stages = await loadCurrentStages(this.db, projectId);
    return stages.map((stage) => stage.key);
  }
}

async function upsertManager(
  client: Queryable,
  projectId: string,
  sourceId: string,
  manager: Intake['manager'],
): Promise<string | null> {
  if (!manager) {
    return null;
  }
  if (manager.id) {
    const found = await client.query<{ id: string }>(
      'select id from managers where id = $1 and project_id = $2',
      [manager.id, projectId],
    );
    if (!found.rowCount || !found.rows[0]) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    return found.rows[0].id;
  }
  if (!manager.name) {
    throw new ApiError(422, { error: 'invalid_payload' });
  }
  if (manager.external_id) {
    const result = await client.query<{ id: string }>(
      `insert into managers (id, project_id, source_id, external_id, name, email, is_active)
       values ($1, $2, $3, $4, $5, $6, true)
       on conflict (project_id, source_id, external_id) where external_id is not null and external_id <> ''
       do update set
         name = excluded.name,
         email = coalesce(excluded.email, managers.email),
         updated_at = now()
       returning id`,
      [randomUUID(), projectId, sourceId, manager.external_id, manager.name, manager.email ?? null],
    );
    return result.rows[0]!.id;
  }
  const id = randomUUID();
  await client.query(
    `insert into managers (id, project_id, source_id, name, email, is_active)
     values ($1, $2, $3, $4, $5, true)`,
    [id, projectId, sourceId, manager.name, manager.email ?? null],
  );
  return id;
}

async function upsertContact(
  client: Queryable,
  projectId: string,
  sourceId: string,
  contact: Intake['contact'],
): Promise<string | null> {
  if (!contact) {
    return null;
  }
  if (contact.external_id) {
    const result = await client.query<{ id: string }>(
      `insert into contacts (id, project_id, source_id, external_id, name, external_url)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (project_id, source_id, external_id) where external_id is not null and external_id <> ''
       do update set
         name = excluded.name,
         external_url = coalesce(excluded.external_url, contacts.external_url),
         updated_at = now()
       returning id`,
      [randomUUID(), projectId, sourceId, contact.external_id, contact.name, contact.external_url ?? null],
    );
    return result.rows[0]!.id;
  }
  // TODO(docs): a manual contact without external_id is not matched to an existing row.
  const id = randomUUID();
  await client.query(
    `insert into contacts (id, project_id, source_id, name, external_url)
     values ($1, $2, $3, $4, $5)`,
    [id, projectId, sourceId, contact.name, contact.external_url ?? null],
  );
  return id;
}

function storedDeal(deal: Intake['deal']): {
  external_id: string | null;
  name: string | null;
  status_at_call_name: string | null;
  current_status_name: string | null;
  external_url: string | null;
  link_status: Intake['deal']['link_status'];
} {
  if (deal.link_status === 'absent') {
    return {
      external_id: null,
      name: null,
      status_at_call_name: null,
      current_status_name: null,
      external_url: null,
      link_status: 'absent',
    };
  }
  return {
    external_id: deal.external_id ?? null,
    name: deal.name ?? null,
    status_at_call_name: deal.status_at_call_name ?? null,
    current_status_name: deal.current_status_name ?? deal.status_at_call_name ?? null,
    external_url: deal.external_url ?? null,
    link_status: deal.link_status,
  };
}

function readSubmittedBody(input: CreateCallInput): { raw: unknown; file?: UploadedPart } {
  const header = Array.isArray(input.contentType) ? input.contentType[0] : input.contentType;
  const contentType = header ?? '';
  if (contentType.includes('multipart/form-data')) {
    let text: string | undefined;
    if (isRecord(input.body) && typeof input.body.payload === 'string') {
      text = input.body.payload;
    } else if (input.payloadFile) {
      text = input.payloadFile.buffer.toString('utf8');
    }
    if (text === undefined) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    try {
      return { raw: JSON.parse(text) as unknown, file: input.file };
    } catch {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
  }
  if (contentType.includes('application/json')) {
    if (!isRecord(input.body)) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    return { raw: input.body };
  }
  throw new ApiError(422, { error: 'invalid_payload' });
}

function normalizeIdempotencyKey(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > 200) {
    throw new ApiError(422, { error: 'invalid_payload' });
  }
  return trimmed;
}

function statusFilter(view: 'completed' | 'problems' | 'progress'): string {
  if (view === 'problems') {
    return `c.processing_status in ('failed', 'recording_missing', 'skipped_short', 'skipped_no_duration')`;
  }
  if (view === 'progress') {
    return `c.processing_status in ('recording_pending', 'audio_queued', 'audio_fetch', 'transcribing', 'analyzing')`;
  }
  return `c.processing_status = 'completed'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
