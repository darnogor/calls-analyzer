export type CallRow = {
  id: string;
  started_at: Date | string;
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
  error: Record<string, unknown> | null;
  context_json: { notes?: string | null; fields?: unknown } | null;
  recording_storage_key: string | null;
  source_kind: string;
  source_provider: string | null;
  source_display_name: string;
  manager_id: string | null;
  manager_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_external_url: string | null;
  stages_json: unknown;
  overall_score: number | null;
  summary: string | null;
  extras_json: unknown;
  transcript_json: unknown;
};

export type ListView = 'completed' | 'problems' | 'progress';

export function presentListItem(row: CallRow, view: ListView): Record<string, unknown> {
  const base = baseCall(row, 'list');
  if (view === 'completed') {
    return {
      ...base,
      stages: listStages(row.stages_json),
      overall_score: row.overall_score,
    };
  }
  if (view === 'problems') {
    return {
      ...base,
      processing_status: row.processing_status,
      error: row.error,
    };
  }
  return {
    ...base,
    processing_status: row.processing_status,
  };
}

export function presentCall(row: CallRow): Record<string, unknown> {
  const completed = row.processing_status === 'completed';
  const body: Record<string, unknown> = {
    ...baseCall(row, 'card'),
    processing_status: row.processing_status,
    context: {
      notes: row.context_json?.notes ?? null,
      fields: Array.isArray(row.context_json?.fields) ? row.context_json.fields : [],
    },
    stages: completed ? cardStages(row.stages_json) : null,
    overall_score: completed ? row.overall_score : null,
    summary: completed ? row.summary : null,
    ...completedExtras(completed ? row.extras_json : null),
    transcript: completed ? (row.transcript_json ?? null) : null,
    has_recording: Boolean(row.recording_storage_key),
  };
  if (row.processing_status === 'failed') {
    body.error = row.error;
  }
  return body;
}

function baseCall(row: CallRow, mode: 'list' | 'card'): Record<string, unknown> {
  return {
    id: row.id,
    started_at: iso(row.started_at),
    duration_sec: row.duration_sec,
    direction: row.direction,
    phone: row.phone,
    source: {
      kind: row.source_kind,
      provider: row.source_provider,
      display_name: row.source_display_name,
    },
    manager: row.manager_id ? { id: row.manager_id, name: row.manager_name } : null,
    company_name: row.company_name,
    contact: row.contact_id
      ? { name: row.contact_name, external_url: row.contact_external_url }
      : null,
    deal: presentDeal(row, mode),
  };
}

function presentDeal(row: CallRow, mode: 'list' | 'card'): Record<string, unknown> | null {
  if (row.deal_link_status === 'absent') {
    return null;
  }
  if (row.deal_link_status === 'ambiguous' || row.deal_link_status === 'unresolved') {
    const deal: Record<string, unknown> = {
      name: '',
      link_status: row.deal_link_status,
      status_name: row.current_deal_status_name,
    };
    if (mode === 'card') {
      return {
        name: '',
        link_status: row.deal_link_status,
        status_at_call_name: row.deal_status_at_call_name,
        status_name: row.current_deal_status_name,
      };
    }
    return deal;
  }
  const linked: Record<string, unknown> = {
    name: row.deal_name,
    link_status: row.deal_link_status,
    status_name: row.current_deal_status_name,
    external_url: row.deal_external_url,
  };
  if (mode === 'card') {
    return {
      name: row.deal_name,
      link_status: row.deal_link_status,
      status_at_call_name: row.deal_status_at_call_name,
      status_name: row.current_deal_status_name,
      external_url: row.deal_external_url,
    };
  }
  return linked;
}

function listStages(value: unknown): { key: string; score: number | null; status: string | null }[] {
  return stageRecords(value).map((record) => {
    const status = typeof record.status === 'string' ? record.status : null;
    const hidden = status === 'not_applicable' || status === 'unobservable';
    return {
      key: typeof record.key === 'string' ? record.key : '',
      score: hidden ? null : typeof record.score === 'number' ? record.score : null,
      status,
    };
  });
}

function cardStages(value: unknown): Record<string, unknown>[] {
  return stageRecords(value).map((record) => ({
    key: record.key ?? null,
    title: record.title ?? null,
    weight: record.weight ?? null,
    high_score: record.high_score ?? null,
    defect_example: record.defect_example ?? null,
    sample_line: record.sample_line ?? null,
    instruction: record.instruction ?? null,
    status: record.status ?? null,
    score: record.score ?? null,
    reason: record.reason ?? record.comment ?? null,
    evidence_ids: stringList(record.evidence_ids),
  }));
}

function stageRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((stage) => asRecord(stage) ?? {});
}

function completedExtras(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const coverage = typeof record.coverage === 'number' && Number.isFinite(record.coverage) ? record.coverage : null;
  return {
    coverage,
    preliminary: record.preliminary === true,
    flags: Array.isArray(record.flags) ? record.flags : [],
    payment_agreement: asRecord(record.payment_agreement),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item !== '');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
