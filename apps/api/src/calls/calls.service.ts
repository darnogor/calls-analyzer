import { Prisma, isUniqueViolation, type TransactionClient } from '@calls/db';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AuthAccount } from '../auth/auth.guard';
import type { PluginSource } from '../auth/source-tokens';
import { SourceTokens } from '../auth/source-tokens';
import { ProjectAccess, type ProjectRecord } from '../access';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { isUuid } from '../ids';
import { audioFetchMessage, AudioQueue, type AudioFetchMessage } from '../queue/audio-queue';
import { Recordings } from '../storage/recordings';
import { audioObject, recordingContentType } from './audio-ext';
import { loadCurrentStages } from '../projects/scorecard';
import { durationBelowMinimum } from './duration';
import { parseListQuery, requestedAction } from './list-query';
import {
  parseRecordingBody,
  pluginIntakeError,
  recordingAttachOutcome,
  recordingMissingOutcome,
  resolveExistingCall,
  type RecordingAttachOutcome,
  withoutPluginManagerId,
} from './plugin-rules';
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

export type IntakeActor = {
  account?: AuthAccount;
  source?: PluginSource;
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
    private readonly sourceTokens: SourceTokens,
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
    const call = await this.db.client.call.findFirst({
      where: { project_id: project.id, id: callId },
      include: {
        source: { select: { kind: true, provider: true, display_name: true } },
        manager: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, external_url: true } },
        analysis: { select: { stages_json: true, overall_score: true, summary: true, transcript_json: true } },
      },
    });
    const row = call ? toCallRow(call) : undefined;
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
    const row = await this.db.client.call.findFirst({
      where: { project_id: project.id, id: callId },
      select: { recording_storage_key: true, recording_content_type: true },
    });
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

  async create(actor: IntakeActor, projectId: string, input: CreateCallInput): Promise<IntakeResult> {
    const plugin = Boolean(actor.source);
    const project = plugin
      ? await this.sourceTokens.requireProject(actor.source as PluginSource, projectId)
      : await this.requireAccountProject(actor, projectId);
    const sourceId = plugin ? (actor.source as PluginSource).id : await this.manualSource(project.id);
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
    let intake = validated.value;
    if (plugin) {
      const pluginError = pluginIntakeError(intake);
      if (pluginError) {
        throw new ApiError(422, pluginError);
      }
      intake = withoutPluginManagerId(intake);
    }
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    try {
      return await this.insertOrReplay(project, sourceId, intake, submitted.file, idempotencyKey);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.insertOrReplay(project, sourceId, intake, submitted.file, idempotencyKey);
    }
  }

  async attachRecording(
    source: PluginSource,
    projectId: string,
    externalId: string,
    input: CreateCallInput,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const project = await this.sourceTokens.requireProject(source, projectId);
    const key = externalId.trim();
    if (!key) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    const submitted = readRecordingSubmission(input);
    const call = await this.db.client.call.findFirst({
      where: { project_id: project.id, source_id: source.id, external_id: key },
      select: { id: true, processing_status: true, recording_storage_key: true },
    });
    if (!call) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    const first = recordingAttachOutcome(call);
    if (!first.enqueue) {
      return recordingOutcomeBody(call.id, first);
    }

    let uploadedKey: string | null = null;
    let contentType: string | null = null;
    if (submitted.file) {
      const audio = audioObject(submitted.file);
      uploadedKey = `projects/${project.id}/calls/${call.id}.${randomUUID()}.${audio.ext}`;
      contentType = audio.contentType;
      await this.recordings.put(uploadedKey, submitted.file.buffer, contentType);
    }

    let result: {
      id: string;
      outcome: RecordingAttachOutcome;
      removeUploaded: boolean;
      removeOld: string | null;
      fetchAudio: AudioFetchMessage['audio'] | null;
    };
    try {
      result = await this.db.client.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe<
          Array<{ id: string; processing_status: string; recording_storage_key: string | null }>
        >(
          `select id, processing_status, recording_storage_key
           from calls
           where id = $1
           for update`,
          call.id,
        );
        const row = locked[0];
        if (!row) {
          throw new ApiError(404, { error: 'call_not_found' });
        }
        const decision = recordingAttachOutcome(row);
        if (!decision.enqueue) {
          return {
            id: row.id,
            outcome: decision,
            removeUploaded: Boolean(uploadedKey),
            removeOld: null,
            fetchAudio: null,
          };
        }
        let fetchAudio: AudioFetchMessage['audio'] | null = null;
        if (submitted.file && uploadedKey && contentType) {
          await tx.call.update({
            where: { id: row.id },
            data: {
              processing_status: 'audio_queued',
              recording_storage_key: uploadedKey,
              recording_content_type: contentType,
              recording_source_url: null,
              error: Prisma.DbNull,
              updated_at: new Date(),
            },
          });
          fetchAudio = {
            type: 'object',
            bucket: this.recordings.bucket,
            key: uploadedKey,
            content_type: contentType,
          };
        } else if (submitted.url) {
          await tx.call.update({
            where: { id: row.id },
            data: {
              processing_status: 'audio_queued',
              recording_source_url: submitted.url,
              recording_storage_key: null,
              recording_content_type: null,
              error: Prisma.DbNull,
              updated_at: new Date(),
            },
          });
          fetchAudio = { type: 'url', url: submitted.url };
        } else {
          throw new ApiError(422, { error: 'invalid_payload' });
        }
        const previousKey = row.recording_storage_key;
        return {
          id: row.id,
          outcome: decision,
          removeUploaded: false,
          removeOld: previousKey && previousKey !== uploadedKey ? previousKey : null,
          fetchAudio,
        };
      });
    } catch (error) {
      if (uploadedKey) {
        await this.recordings.remove(uploadedKey).catch((removeError) => console.error('remove object', removeError));
      }
      throw error;
    }
    if (result.removeUploaded && uploadedKey) {
      await this.recordings.remove(uploadedKey).catch((error) => console.error('remove object', error));
    }
    if (result.removeOld) {
      await this.recordings.remove(result.removeOld).catch((error) => console.error('remove object', error));
    }
    if (result.fetchAudio) {
      await this.queue.enqueue(audioFetchMessage(project.id, result.id, result.fetchAudio));
    }
    return recordingOutcomeBody(result.id, result.outcome);
  }

  async markRecordingMissing(
    source: PluginSource,
    projectId: string,
    externalId: string,
  ): Promise<{ id: string; processing_status: 'recording_missing' }> {
    const project = await this.sourceTokens.requireProject(source, projectId);
    const key = externalId.trim();
    if (!key) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    return this.db.client.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<Array<{ id: string; processing_status: string }>>(
        `select id, processing_status
         from calls
         where project_id = $1 and source_id = $2 and external_id = $3
         for update`,
        project.id,
        source.id,
        key,
      );
      const row = locked[0];
      if (!row) {
        throw new ApiError(404, { error: 'call_not_found' });
      }
      const decision = recordingMissingOutcome(row.processing_status);
      if (decision.http === 409) {
        throw new ApiError(409, { error: decision.error });
      }
      await tx.call.update({
        where: { id: row.id },
        data: { processing_status: 'recording_missing', updated_at: new Date() },
      });
      return { id: row.id, processing_status: 'recording_missing' as const };
    });
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
    let byKey: { id: string; source_id: string } | null = null;
    let byExternal: { id: string } | null = null;
    if (idempotencyKey) {
      byKey = await this.db.client.call.findFirst({
        where: { project_id: projectId, idempotency_key: idempotencyKey },
        select: { id: true, source_id: true },
      });
    }
    if (externalId) {
      byExternal = await this.db.client.call.findFirst({
        where: { project_id: projectId, source_id: sourceId, external_id: externalId },
        select: { id: true },
      });
    }
    const resolved = resolveExistingCall(sourceId, byKey, byExternal);
    if (!resolved.ok) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    return resolved.id ? { id: resolved.id } : null;
  }

  private async requireAccountProject(actor: IntakeActor, projectId: string): Promise<ProjectRecord> {
    if (!actor.account) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    return this.access.require(actor.account, projectId, 'write');
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
    let fetchAudio: AudioFetchMessage['audio'] | null = null;
    try {
      fetchAudio = await this.db.client.$transaction(async (tx) => {
        const managerId = await upsertManager(tx, project.id, sourceId, intake.manager);
        const contactId = await upsertContact(tx, project.id, sourceId, intake.contact);
        const deal = storedDeal(intake.deal);
        await tx.call.create({
          data: {
            id: callId,
            project_id: project.id,
            source_id: sourceId,
            external_id: externalId,
            idempotency_key: idempotencyKey ?? null,
            manager_id: managerId,
            contact_id: contactId,
            company_name: intake.company_name ?? null,
            direction: intake.direction ?? null,
            phone: intake.phone ?? null,
            started_at: new Date(intake.started_at),
            duration_sec: intake.duration_sec ?? null,
            recording_source_url: intake.recording?.url ?? null,
            recording_storage_key: storageKey,
            recording_content_type: audio?.contentType ?? null,
            deal_external_id: deal.external_id,
            deal_name: deal.name,
            deal_status_at_call_name: deal.status_at_call_name,
            current_deal_status_name: deal.current_status_name,
            deal_external_url: deal.external_url,
            deal_link_status: deal.link_status,
            context_json: intake.context as unknown as Prisma.InputJsonValue,
            processing_status: processingStatus,
          },
        });
        await tx.source.update({
          where: { id: sourceId },
          data: { last_intake_at: new Date() },
        });
        if (file && storageKey && audio) {
          return {
            type: 'object' as const,
            bucket: this.recordings.bucket,
            key: storageKey,
            content_type: audio.contentType,
          };
        }
        if (intake.recording) {
          return { type: 'url' as const, url: intake.recording.url };
        }
        return null;
      });
    } catch (error) {
      if (storageKey) {
        await this.recordings.remove(storageKey).catch((removeError) => {
          console.error('remove object', removeError);
        });
      }
      throw error;
    }
    if (fetchAudio) {
      await this.queue.enqueue(audioFetchMessage(project.id, callId, fetchAudio));
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
    const current = await this.db.client.call.findFirst({
      where: { id: callId },
      select: { processing_status: true },
    });
    if (!current) {
      throw new ApiError(404, { error: 'call_not_found' });
    }
    const kind = file ? 'file' : intake.recording ? 'url' : null;
    const canAttach =
      current.processing_status === 'recording_pending' || current.processing_status === 'recording_missing';
    if (!kind || !canAttach) {
      await this.db.client.source.update({
        where: { id: sourceId },
        data: { last_intake_at: new Date() },
      });
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

    let result: {
      attached: boolean;
      keptKey: string | null;
      fetchAudio: AudioFetchMessage['audio'] | null;
      body: IntakeResult;
    };
    try {
      result = await this.db.client.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe<
          Array<{ processing_status: string; recording_storage_key: string | null }>
        >('select processing_status, recording_storage_key from calls where id = $1 for update', callId);
        const status = locked[0]?.processing_status;
        if (!status) {
          throw new ApiError(404, { error: 'call_not_found' });
        }
        if (status !== 'recording_pending' && status !== 'recording_missing') {
          await tx.source.update({
            where: { id: sourceId },
            data: { last_intake_at: new Date() },
          });
          return {
            attached: false,
            keptKey: locked[0]?.recording_storage_key ?? null,
            fetchAudio: null,
            body: {
              status: 200,
              body: { id: callId, created: false, processing_status: status },
            } satisfies IntakeResult,
          };
        }
        let fetchAudio: AudioFetchMessage['audio'] | null = null;
        if (file && storageKey && contentType) {
          await tx.call.update({
            where: { id: callId },
            data: {
              processing_status: 'audio_queued',
              recording_storage_key: storageKey,
              recording_content_type: contentType,
              recording_source_url: null,
              ...(intake.duration_sec != null ? { duration_sec: intake.duration_sec } : {}),
              updated_at: new Date(),
            },
          });
          fetchAudio = {
            type: 'object',
            bucket: this.recordings.bucket,
            key: storageKey,
            content_type: contentType,
          };
        } else if (intake.recording) {
          await tx.call.update({
            where: { id: callId },
            data: {
              processing_status: 'audio_queued',
              recording_source_url: intake.recording.url,
              recording_storage_key: null,
              recording_content_type: null,
              ...(intake.duration_sec != null ? { duration_sec: intake.duration_sec } : {}),
              updated_at: new Date(),
            },
          });
          fetchAudio = { type: 'url', url: intake.recording.url };
        }
        await tx.source.update({
          where: { id: sourceId },
          data: { last_intake_at: new Date() },
        });
        return {
          attached: true,
          keptKey: storageKey,
          fetchAudio,
          body: {
            status: 200,
            body: { id: callId, created: false, processing_status: 'audio_queued' },
          } satisfies IntakeResult,
        };
      });
    } catch (error) {
      if (storageKey) {
        await this.recordings.remove(storageKey).catch((removeError) => console.error('remove object', removeError));
      }
      throw error;
    }
    if (!result.attached && storageKey && result.keptKey !== storageKey) {
      await this.recordings.remove(storageKey).catch((error) => console.error('remove object', error));
    }
    if (result.fetchAudio) {
      await this.queue.enqueue(audioFetchMessage(project.id, callId, result.fetchAudio));
    }
    return result.body;
  }

  private async manualSource(projectId: string): Promise<string> {
    const source = await this.db.client.source.findFirst({
      where: { project_id: projectId, kind: 'manual' },
      select: { id: true },
    });
    const sourceId = source?.id;
    if (!sourceId) {
      throw new Error(`manual source missing for project ${projectId}`);
    }
    return sourceId;
  }

  private async stageKeys(projectId: string): Promise<string[]> {
    const stages = await loadCurrentStages(this.db.client, projectId);
    return stages.map((stage) => stage.key);
  }
}

async function upsertManager(
  tx: TransactionClient,
  projectId: string,
  sourceId: string,
  manager: Intake['manager'],
): Promise<string | null> {
  if (!manager) {
    return null;
  }
  if (manager.id) {
    const found = await tx.manager.findFirst({
      where: { id: manager.id, project_id: projectId },
      select: { id: true },
    });
    if (!found) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    return found.id;
  }
  if (!manager.name) {
    throw new ApiError(422, { error: 'invalid_payload' });
  }
  if (manager.external_id) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into managers (id, project_id, source_id, external_id, name, email, is_active)
       values ($1, $2, $3, $4, $5, $6, true)
       on conflict (project_id, source_id, external_id) where external_id is not null and external_id <> ''
       do update set
         name = excluded.name,
         email = coalesce(excluded.email, managers.email),
         updated_at = now()
       returning id`,
      randomUUID(),
      projectId,
      sourceId,
      manager.external_id,
      manager.name,
      manager.email ?? null,
    );
    return rows[0]!.id;
  }
  const id = randomUUID();
  await tx.manager.create({
    data: {
      id,
      project_id: projectId,
      source_id: sourceId,
      name: manager.name,
      email: manager.email ?? null,
      is_active: true,
    },
  });
  return id;
}

async function upsertContact(
  tx: TransactionClient,
  projectId: string,
  sourceId: string,
  contact: Intake['contact'],
): Promise<string | null> {
  if (!contact) {
    return null;
  }
  if (contact.external_id) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into contacts (id, project_id, source_id, external_id, name, external_url)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (project_id, source_id, external_id) where external_id is not null and external_id <> ''
       do update set
         name = excluded.name,
         external_url = coalesce(excluded.external_url, contacts.external_url),
         updated_at = now()
       returning id`,
      randomUUID(),
      projectId,
      sourceId,
      contact.external_id,
      contact.name,
      contact.external_url ?? null,
    );
    return rows[0]!.id;
  }
  // TODO(docs): a manual contact without external_id is not matched to an existing row.
  const id = randomUUID();
  await tx.contact.create({
    data: {
      id,
      project_id: projectId,
      source_id: sourceId,
      name: contact.name,
      external_url: contact.external_url ?? null,
    },
  });
  return id;
}

function toCallRow(call: {
  id: string;
  started_at: Date;
  duration_sec: number | null;
  direction: string | null;
  phone: string | null;
  company_name: string | null;
  deal_name: string | null;
  deal_link_status: string;
  deal_status_at_call_name: string | null;
  current_deal_status_name: string | null;
  deal_external_url: string | null;
  processing_status: string;
  error: Prisma.JsonValue | null;
  context_json: Prisma.JsonValue;
  recording_storage_key: string | null;
  source: { kind: string; provider: string | null; display_name: string };
  manager: { id: string; name: string } | null;
  contact: { id: string; name: string; external_url: string | null } | null;
  analysis: {
    stages_json: Prisma.JsonValue | null;
    overall_score: number | null;
    summary: string | null;
    transcript_json: Prisma.JsonValue | null;
  } | null;
}): CallRow {
  return {
    id: call.id,
    started_at: call.started_at,
    duration_sec: call.duration_sec,
    direction: call.direction,
    phone: call.phone,
    company_name: call.company_name,
    deal_name: call.deal_name,
    deal_link_status: call.deal_link_status,
    deal_status_at_call_name: call.deal_status_at_call_name,
    current_deal_status_name: call.current_deal_status_name,
    deal_external_url: call.deal_external_url,
    processing_status: call.processing_status,
    error: isRecord(call.error) ? call.error : null,
    context_json: isRecord(call.context_json) ? (call.context_json as CallRow['context_json']) : null,
    recording_storage_key: call.recording_storage_key,
    source_kind: call.source.kind,
    source_provider: call.source.provider,
    source_display_name: call.source.display_name,
    manager_id: call.manager?.id ?? null,
    manager_name: call.manager?.name ?? null,
    contact_id: call.contact?.id ?? null,
    contact_name: call.contact?.name ?? null,
    contact_external_url: call.contact?.external_url ?? null,
    stages_json: call.analysis?.stages_json ?? null,
    overall_score: call.analysis?.overall_score ?? null,
    summary: call.analysis?.summary ?? null,
    transcript_json: call.analysis?.transcript_json ?? null,
  };
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

function recordingOutcomeBody(
  id: string,
  outcome: RecordingAttachOutcome,
): { status: number; body: Record<string, unknown> } {
  if (outcome.http === 409) {
    return { status: 409, body: { error: outcome.error } };
  }
  return {
    status: outcome.http,
    body: { id, processing_status: outcome.processing_status },
  };
}

function readRecordingSubmission(input: CreateCallInput): { file?: UploadedPart; url?: string } {
  const header = Array.isArray(input.contentType) ? input.contentType[0] : input.contentType;
  const contentType = header ?? '';
  if (contentType.includes('multipart/form-data')) {
    if (!input.file || input.file.size === 0) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    return { file: input.file };
  }
  if (contentType.includes('application/json')) {
    const recording = parseRecordingBody(input.body);
    if (!recording) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    return { url: recording.url };
  }
  throw new ApiError(422, { error: 'invalid_payload' });
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
