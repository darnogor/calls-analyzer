import { createHash, randomBytes } from 'node:crypto';

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function secretHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
