import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://calls:calls@127.0.0.1:5432/calls',
  },
});
