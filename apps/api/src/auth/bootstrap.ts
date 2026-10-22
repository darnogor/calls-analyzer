import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../config';
import { Database } from '../db/database';
import { hashPassword } from './password';

@Injectable()
export class BootstrapService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.db.query(
      'select id from accounts where is_administrator = true limit 1',
    );
    if (existing.rowCount) {
      return;
    }
    // TODO(docs): deploy does not say how the first administrator row is created.
    // It is inserted on api startup when none exists, from ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_NAME.
    const email = this.config.adminEmail.trim().toLowerCase();
    const name = this.config.adminName.trim();
    if (!email || !this.config.adminPassword || !name) {
      throw new Error('No administrator exists. Set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_NAME.');
    }
    const passwordHash = await hashPassword(this.config.adminPassword);
    await this.db.query(
      `insert into accounts (id, email, name, password_hash, is_administrator, is_active)
       values ($1, $2, $3, $4, true, true)`,
      [randomUUID(), email, name, passwordHash],
    );
  }
}
