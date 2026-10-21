import type { Intake } from './validate-intake';

const TERMINAL = new Set(['completed', 'skipped_short', 'skipped_no_duration', 'failed']);

export type ExistingHit = { id: string; source_id: string };

export function pluginIntakeError(intake: {
  external_id?: string;
  manager?: { external_id?: string };
  contact?: { external_id?: string };
}): { error: string } | null {
  if (!intake.external_id) {
    return { error: 'external_id_required' };
  }
  if (intake.manager && !intake.manager.external_id) {
    return { error: 'manager_external_id_required' };
  }
  if (intake.contact && !intake.contact.external_id) {
    return { error: 'contact_external_id_required' };
  }
  return null;
}

export function withoutPluginManagerId(intake: Intake): Intake {
  if (!intake.manager?.id) {
    return intake;
  }
  const manager = { ...intake.manager };
  delete manager.id;
  return { ...intake, manager };
}

export function resolveExistingCall(
  sourceId: string,
  byKey: ExistingHit | null,
  byExternal: { id: string } | null,
): { ok: true; id: string | null } | { ok: false } {
  if (byKey && byKey.source_id !== sourceId) {
    return { ok: false };
  }
  if (byKey && byExternal && byKey.id !== byExternal.id) {
    return { ok: false };
  }
  return { ok: true, id: byKey?.id ?? byExternal?.id ?? null };
}

export type RecordingAttachOutcome =
  | { http: 202; processing_status: 'audio_queued'; enqueue: true }
  | { http: 200; processing_status: string; enqueue: false }
  | { http: 409; error: 'recording_not_accepted'; enqueue: false };

export function recordingAttachOutcome(call: {
  processing_status: string;
  recording_storage_key: string | null;
}): RecordingAttachOutcome {
  if (TERMINAL.has(call.processing_status)) {
    return { http: 409, error: 'recording_not_accepted', enqueue: false };
  }
  if (call.processing_status === 'recording_missing') {
    return { http: 202, processing_status: 'audio_queued', enqueue: true };
  }
  if (call.recording_storage_key) {
    return { http: 200, processing_status: call.processing_status, enqueue: false };
  }
  if (call.processing_status === 'recording_pending') {
    return { http: 202, processing_status: 'audio_queued', enqueue: true };
  }
  return { http: 200, processing_status: call.processing_status, enqueue: false };
}

export function recordingMissingOutcome(
  processingStatus: string,
): { http: 200; processing_status: 'recording_missing' } | { http: 409; error: 'recording_already_attached' } {
  if (processingStatus === 'recording_pending') {
    return { http: 200, processing_status: 'recording_missing' };
  }
  return { http: 409, error: 'recording_already_attached' };
}

export function parseRecordingBody(value: unknown): { type: 'url'; url: string } | null {
  if (!isRecord(value) || value.type !== 'url' || typeof value.url !== 'string') {
    return null;
  }
  const url = value.url.trim();
  if (!url || url.length > 2000) {
    return null;
  }
  return { type: 'url', url };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
