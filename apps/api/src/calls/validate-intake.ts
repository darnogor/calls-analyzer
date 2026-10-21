import { isUuid } from '../ids';

const STARTED_AT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type Intake = {
  external_id?: string;
  direction?: 'in' | 'out';
  phone?: string;
  started_at: string;
  duration_sec?: number;
  recording?: { type: 'url'; url: string };
  manager?: {
    id?: string;
    external_id?: string;
    name?: string;
    email?: string;
  };
  contact?: {
    external_id?: string;
    name: string;
    external_url?: string;
  };
  company_name?: string;
  deal: {
    external_id?: string;
    name?: string;
    status_at_call_name?: string;
    current_status_name?: string;
    external_url?: string;
    link_status: 'linked' | 'unresolved' | 'ambiguous' | 'absent';
  };
  context: {
    notes: string | null;
    fields: { key: string; label: string; value: string }[];
  };
};

type Ok<T> = { ok: true; value: T };
type Fail = { ok: false };

export function validateIntake(input: unknown): Ok<Intake> | Fail {
  if (!isRecord(input)) {
    return { ok: false };
  }
  const externalId = readOptionalString(input.external_id, 1024);
  const direction = readDirection(input.direction);
  const phone = readOptionalString(input.phone, 64);
  const startedAt = readStartedAt(input.started_at);
  const duration = readDuration(input.duration_sec);
  const recording = readRecording(input.recording);
  const manager = readManager(input.manager);
  const contact = readContact(input.contact);
  const companyName = readOptionalString(input.company_name, 500);
  const deal = readDeal(input.deal);
  const context = readContext(input.context);
  if (
    !externalId.ok ||
    !direction.ok ||
    !phone.ok ||
    !startedAt.ok ||
    !duration.ok ||
    !recording.ok ||
    !manager.ok ||
    !contact.ok ||
    !companyName.ok ||
    !deal.ok ||
    !context.ok
  ) {
    return { ok: false };
  }
  const value: Intake = {
    started_at: startedAt.value,
    deal: deal.value,
    context: context.value,
  };
  if (externalId.value !== undefined) value.external_id = externalId.value;
  if (direction.value !== undefined) value.direction = direction.value;
  if (phone.value !== undefined) value.phone = phone.value;
  if (duration.value !== undefined) value.duration_sec = duration.value;
  if (recording.value !== undefined) value.recording = recording.value;
  if (manager.value !== undefined) value.manager = manager.value;
  if (contact.value !== undefined) value.contact = contact.value;
  if (companyName.value !== undefined) value.company_name = companyName.value;
  return { ok: true, value };
}

function readStartedAt(value: unknown): Ok<string> | Fail {
  if (typeof value !== 'string' || !STARTED_AT.test(value.trim())) {
    return { ok: false };
  }
  const startedAt = value.trim();
  if (Number.isNaN(new Date(startedAt).getTime())) {
    return { ok: false };
  }
  return { ok: true, value: startedAt };
}

function readDuration(value: unknown): Ok<number | undefined> | Fail {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false };
  }
  return { ok: true, value };
}

function readDirection(value: unknown): Ok<'in' | 'out' | undefined> | Fail {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined };
  }
  if (value === 'in' || value === 'out') {
    return { ok: true, value };
  }
  return { ok: false };
}

function readRecording(value: unknown): Ok<{ type: 'url'; url: string } | undefined> | Fail {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value) || value.type !== 'url') {
    return { ok: false };
  }
  const url = readOptionalString(value.url, 2000);
  if (!url.ok || url.value === undefined) {
    return { ok: false };
  }
  return { ok: true, value: { type: 'url', url: url.value } };
}

function readManager(value: unknown): Ok<Intake['manager']> | Fail {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value)) {
    return { ok: false };
  }
  const id = readOptionalString(value.id, 64);
  const externalId = readOptionalString(value.external_id, 1024);
  const name = readOptionalString(value.name, 300);
  const email = readOptionalString(value.email, 320);
  if (!id.ok || !externalId.ok || !name.ok || !email.ok) {
    return { ok: false };
  }
  if (id.value !== undefined && !isUuid(id.value)) {
    return { ok: false };
  }
  if (id.value === undefined && name.value === undefined) {
    return { ok: false };
  }
  const manager: NonNullable<Intake['manager']> = {};
  if (id.value !== undefined) manager.id = id.value;
  if (externalId.value !== undefined) manager.external_id = externalId.value;
  if (name.value !== undefined) manager.name = name.value;
  if (email.value !== undefined) manager.email = email.value;
  return { ok: true, value: manager };
}

function readContact(value: unknown): Ok<Intake['contact']> | Fail {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value)) {
    return { ok: false };
  }
  const externalId = readOptionalString(value.external_id, 1024);
  const name = readOptionalString(value.name, 300);
  const externalUrl = readOptionalString(value.external_url, 2000);
  if (!externalId.ok || !name.ok || !externalUrl.ok || name.value === undefined) {
    return { ok: false };
  }
  const contact: NonNullable<Intake['contact']> = { name: name.value };
  if (externalId.value !== undefined) contact.external_id = externalId.value;
  if (externalUrl.value !== undefined) contact.external_url = externalUrl.value;
  return { ok: true, value: contact };
}

function readDeal(value: unknown): Ok<Intake['deal']> | Fail {
  if (value === undefined || value === null) {
    return { ok: true, value: { link_status: 'absent' } };
  }
  if (!isRecord(value)) {
    return { ok: false };
  }
  const externalId = readOptionalString(value.external_id, 1024);
  const name = readOptionalString(value.name, 500);
  const statusAtCall = readOptionalString(value.status_at_call_name, 300);
  const currentStatus = readOptionalString(value.current_status_name, 300);
  const externalUrl = readOptionalString(value.external_url, 2000);
  if (!externalId.ok || !name.ok || !statusAtCall.ok || !currentStatus.ok || !externalUrl.ok) {
    return { ok: false };
  }
  const link = value.link_status;
  if (link !== undefined && link !== null && link !== 'linked' && link !== 'unresolved' && link !== 'ambiguous') {
    return { ok: false };
  }
  const empty =
    externalId.value === undefined &&
    name.value === undefined &&
    statusAtCall.value === undefined &&
    currentStatus.value === undefined &&
    externalUrl.value === undefined &&
    (link === undefined || link === null);
  if (empty) {
    return { ok: true, value: { link_status: 'absent' } };
  }
  if (link === 'linked' && externalId.value === undefined) {
    return { ok: false };
  }
  // TODO(docs): a deal block without link_status is not fully specified.
  // A manual form sends the name and the stage, and the call card shows that name.
  // The list shows the name only for linked, and external_id is required only when the caller sets link_status=linked.
  // When the caller omits link_status but sends a name, stage, id or url, the row is stored as linked.
  const linkStatus = (link ?? 'linked') as 'linked' | 'unresolved' | 'ambiguous';
  const deal: Intake['deal'] = { link_status: linkStatus };
  if (externalId.value !== undefined) deal.external_id = externalId.value;
  if (name.value !== undefined) deal.name = name.value;
  if (statusAtCall.value !== undefined) deal.status_at_call_name = statusAtCall.value;
  deal.current_status_name = currentStatus.value ?? statusAtCall.value;
  if (externalUrl.value !== undefined) deal.external_url = externalUrl.value;
  return { ok: true, value: deal };
}

function readContext(value: unknown): Ok<Intake['context']> | Fail {
  if (value === undefined || value === null) {
    return { ok: true, value: { notes: null, fields: [] } };
  }
  if (!isRecord(value)) {
    return { ok: false };
  }
  let notes: string | null = null;
  if (value.notes !== undefined && value.notes !== null) {
    if (typeof value.notes !== 'string') {
      return { ok: false };
    }
    notes = value.notes;
  }
  const fields: Intake['context']['fields'] = [];
  if (value.fields !== undefined && value.fields !== null) {
    if (!Array.isArray(value.fields)) {
      return { ok: false };
    }
    for (const field of value.fields) {
      if (!isRecord(field)) {
        return { ok: false };
      }
      if (typeof field.key !== 'string' || field.key === '') {
        return { ok: false };
      }
      if (typeof field.label !== 'string' || typeof field.value !== 'string') {
        return { ok: false };
      }
      fields.push({ key: field.key, label: field.label, value: field.value });
    }
  }
  return { ok: true, value: { notes, fields } };
}

function readOptionalString(value: unknown, maxLength: number): Ok<string | undefined> | Fail {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (trimmed.length > maxLength) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
