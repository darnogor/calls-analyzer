export type NewAccount = {
  email: string;
  name: string;
  password: string;
  is_administrator: boolean;
};

export type AccountPatch = {
  email?: string;
  name?: string;
  password?: string;
  is_administrator?: boolean;
  is_active?: boolean;
};

export type MembershipItem = {
  project_id: string;
  role: 'lead' | 'sales_manager';
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseNewAccount(body: unknown): NewAccount | null {
  if (!isRecord(body)) {
    return null;
  }
  const email = readEmail(body.email);
  const name = readName(body.name);
  const password = readPassword(body.password);
  if (!email || !name || !password || typeof body.is_administrator !== 'boolean') {
    return null;
  }
  return { email, name, password, is_administrator: body.is_administrator };
}

export function parseAccountPatch(body: unknown): AccountPatch | null {
  if (!isRecord(body)) {
    return null;
  }
  const patch: AccountPatch = {};
  if ('email' in body) {
    const email = readEmail(body.email);
    if (!email) {
      return null;
    }
    patch.email = email;
  }
  if ('name' in body) {
    const name = readName(body.name);
    if (!name) {
      return null;
    }
    patch.name = name;
  }
  if ('password' in body) {
    const password = readPassword(body.password);
    if (!password) {
      return null;
    }
    patch.password = password;
  }
  if ('is_administrator' in body) {
    if (typeof body.is_administrator !== 'boolean') {
      return null;
    }
    patch.is_administrator = body.is_administrator;
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') {
      return null;
    }
    patch.is_active = body.is_active;
  }
  return patch;
}

export function parseMemberships(body: unknown): MembershipItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return null;
  }
  const items: MembershipItem[] = [];
  const seen = new Set<string>();
  for (const item of body.items) {
    if (!isRecord(item) || typeof item.project_id !== 'string' || item.project_id === '') {
      return null;
    }
    if (item.role !== 'lead' && item.role !== 'sales_manager') {
      return null;
    }
    if (seen.has(item.project_id)) {
      return null;
    }
    seen.add(item.project_id);
    items.push({ project_id: item.project_id, role: item.role });
  }
  return items;
}

export function removesLastActiveAdministrator(
  current: { is_administrator: boolean; is_active: boolean },
  next: { is_administrator: boolean; is_active: boolean },
  otherActiveAdministrators: number,
): boolean {
  const wasActive = current.is_administrator && current.is_active;
  const staysActive = next.is_administrator && next.is_active;
  return wasActive && !staysActive && otherActiveAdministrators === 0;
}

function readEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const email = value.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) {
    return null;
  }
  return email;
}

function readName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const name = value.trim();
  if (!name || name.length > 300) {
    return null;
  }
  return name;
}

function readPassword(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
