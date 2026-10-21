const INVALID = Symbol('invalid');

export type ManagerSyncItem = {
  external_id: string;
  name: string;
  email: string | null;
  emailProvided: boolean;
  is_active: boolean;
};

export type ContactPatch = {
  name?: string;
  company_name?: string | null;
  external_url?: string | null;
};

export type DealPatch = {
  current_status_name?: string | null;
  external_url?: string | null;
};

export function parseManagerDirectory(body: unknown): { items: ManagerSyncItem[] } | null {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return null;
  }
  const items: ManagerSyncItem[] = [];
  const seen = new Set<string>();
  for (const item of body.items) {
    if (!isRecord(item) || typeof item.is_active !== 'boolean') {
      return null;
    }
    const externalId = requiredText(item.external_id, 1024);
    const name = requiredText(item.name, 300);
    if (!externalId || !name || seen.has(externalId)) {
      return null;
    }
    let email: string | null = null;
    let emailProvided = false;
    if ('email' in item) {
      const parsed = optionalText(item.email, 320);
      if (parsed === INVALID) {
        return null;
      }
      email = parsed;
      emailProvided = true;
    }
    seen.add(externalId);
    items.push({
      external_id: externalId,
      name,
      email,
      emailProvided,
      is_active: item.is_active,
    });
  }
  return { items };
}

export function externalIdsToDeactivate(existing: string[], submitted: string[]): string[] {
  const keep = new Set(submitted);
  return existing.filter((id) => !keep.has(id));
}

export function parseContactPatch(body: unknown): ContactPatch | null {
  if (!isRecord(body)) {
    return null;
  }
  const patch: ContactPatch = {};
  if ('name' in body) {
    const name = requiredText(body.name, 300);
    if (!name) {
      return null;
    }
    patch.name = name;
  }
  if ('company_name' in body) {
    const company = optionalText(body.company_name, 500);
    if (company === INVALID) {
      return null;
    }
    patch.company_name = company;
  }
  if ('external_url' in body) {
    const url = optionalText(body.external_url, 2000);
    if (url === INVALID) {
      return null;
    }
    patch.external_url = url;
  }
  return patch;
}

export function parseDealPatch(body: unknown): DealPatch | null {
  if (!isRecord(body)) {
    return null;
  }
  const patch: DealPatch = {};
  if ('current_status_name' in body) {
    const status = optionalText(body.current_status_name, 300);
    if (status === INVALID) {
      return null;
    }
    patch.current_status_name = status;
  }
  if ('external_url' in body) {
    const url = optionalText(body.external_url, 2000);
    if (url === INVALID) {
      return null;
    }
    patch.external_url = url;
  }
  return patch;
}

export const CONTACT_PATCH_SQL = `
  update contacts
  set name = case when $4::boolean then $5 else name end,
      company_name = case when $6::boolean then $7 else company_name end,
      external_url = case when $8::boolean then $9 else external_url end,
      updated_at = now()
  where project_id = $1 and source_id = $2 and external_id = $3
  returning name, company_name, external_url
`;

export const DEAL_PATCH_SQL = `
  update calls
  set current_deal_status_name = case when $4::boolean then $5 else current_deal_status_name end,
      deal_external_url = case when $6::boolean then $7 else deal_external_url end,
      updated_at = case when $4::boolean or $6::boolean then now() else updated_at end
  where project_id = $1 and source_id = $2 and deal_external_id = $3
`;

export const MANAGER_UPSERT_SQL = `
  insert into managers (id, project_id, source_id, external_id, name, email, is_active)
  values ($1, $2, $3, $4, $5, $6, $7)
  on conflict (project_id, source_id, external_id) where external_id is not null and external_id <> ''
  do update set
    name = excluded.name,
    email = case when $8::boolean then excluded.email else managers.email end,
    is_active = excluded.is_active,
    updated_at = now()
`;

export const MANAGER_DEACTIVATE_SQL = `
  update managers
  set is_active = false, updated_at = now()
  where project_id = $1
    and source_id = $2
    and external_id is not null
    and external_id <> ''
    and is_active = true
    and not (external_id = any($3::text[]))
`;

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function optionalText(value: unknown, maxLength: number): string | null | typeof INVALID {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return INVALID;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    return INVALID;
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
