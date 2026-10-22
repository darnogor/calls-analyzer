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
    const existing = await this.db.client.account.findFirst({
      where: { is_administrator: true },
      select: { id: true },
    });
    if (existing) {
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
    await this.db.client.account.create({
      data: {
        id: randomUUID(),
        email,
        name,
        password_hash: passwordHash,
        is_administrator: true,
        is_active: true,
      },
    });
  }
}
