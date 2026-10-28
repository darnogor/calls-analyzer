import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

type Column = {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
};

const root = join(__dirname, '../../..');
const schemaText = readFileSync(join(root, 'packages/db/schema.prisma'), 'utf8');
const sqlText = ['0001_core.sql', '0002_source_setup.sql', '0003_scorecard_prompt.sql']
  .map((name) => readFileSync(join(root, 'migrations', name), 'utf8'))
  .join('\n');

describe('prisma schema matches sql migrations', () => {
  it('describes the same tables and columns', () => {
    assert.deepEqual(prismaTables(schemaText), sqlTables(sqlText));
  });

  it('names the same indexes, unique keys, and check constraints', () => {
    for (const name of sqlIndexNames(sqlText)) {
      assert.match(schemaText, new RegExp(`\\b${name}\\b`));
    }
    for (const name of sqlConstraintNames(sqlText)) {
      assert.match(schemaText, new RegExp(`\\b${name}\\b`));
    }
    const sqlChecks = checks(sqlText);
    const schemaChecks = checks(schemaText);
    assert.deepEqual(schemaChecks, sqlChecks);
  });
});

function sqlTables(sql: string): Record<string, Column[]> {
  const tables: Record<string, Column[]> = {};
  for (const match of sql.matchAll(/create table (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    tables[match[1]!] = columnsFromSql(match[2]!).sort(byName);
  }
  for (const match of sql.matchAll(/alter table (\w+)\s+([\s\S]*?);/g)) {
    const table = tables[match[1]!];
    assert.ok(table, match[1]);
    for (const column of match[2]!.matchAll(/add column (\w+)\s+(\w+)/g)) {
      table.push({ name: column[1]!, type: column[2]!, nullable: true, hasDefault: false });
    }
    table.sort(byName);
  }
  return tables;
}

function columnsFromSql(body: string): Column[] {
  const columns: Column[] = [];
  for (const part of splitTopLevel(body)) {
    const trimmed = part.trim();
    if (!trimmed || /^(constraint|primary key|unique|check|foreign key)\b/i.test(trimmed)) {
      continue;
    }
    const match = trimmed.match(/^(\w+)\s+(\w+)\b/);
    assert.ok(match, trimmed);
    const notNull = /\bnot null\b/i.test(trimmed) || /\bprimary key\b/i.test(trimmed);
    columns.push({
      name: match[1]!,
      type: match[2]!,
      nullable: !notNull,
      hasDefault: /\bdefault\b/i.test(trimmed),
    });
  }
  return columns;
}

function prismaTables(schema: string): Record<string, Column[]> {
  const models = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)];
  const modelNames = new Set(models.map((match) => match[1]!));
  const tables: Record<string, Column[]> = {};
  for (const match of models) {
    const body = match[2]!;
    const mapped = body.match(/@@map\("(\w+)"\)/);
    const table = mapped?.[1] ?? match[1]!;
    const columns: Column[] = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@') || trimmed.startsWith('@')) {
        continue;
      }
      const field = trimmed.match(/^(\w+)\s+([A-Za-z]+)(\[\])?(\?)?/);
      if (!field || field[3] || modelNames.has(field[2]!)) {
        continue;
      }
      columns.push({
        name: field[1]!,
        type: prismaType(field[2]!, trimmed),
        nullable: Boolean(field[4]),
        hasDefault: trimmed.includes('@default'),
      });
    }
    tables[table] = columns.sort(byName);
  }
  return tables;
}

function prismaType(typeName: string, line: string): string {
  if (line.includes('@db.Uuid')) return 'uuid';
  if (line.includes('@db.Timestamptz')) return 'timestamptz';
  if (line.includes('@db.Integer')) return 'integer';
  if (line.includes('@db.JsonB')) return 'jsonb';
  if (line.includes('@db.Boolean')) return 'boolean';
  if (line.includes('@db.Text')) return 'text';
  return typeName;
}

function sqlIndexNames(sql: string): string[] {
  return [...sql.matchAll(/create (?:unique )?index (\w+)/g)].map((match) => match[1]!);
}

function sqlConstraintNames(sql: string): string[] {
  return [...sql.matchAll(/constraint (\w+)/g)].map((match) => match[1]!);
}

function checks(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  const pattern = /constraint (\w+) check \(/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[0].length;
    found[match[1]!] = normalize(readBalanced(text, start));
  }
  return found;
}

function readBalanced(text: string, openBody: number): string {
  let depth = 1;
  let quote = false;
  for (let index = openBody; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === "'" && text[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = false;
      continue;
    }
    if (char === "'") {
      quote = true;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openBody, index);
    }
  }
  throw new Error('unbalanced check expression');
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (quote) {
      current += char;
      if (char === "'" && body[index + 1] === "'") {
        current += body[index + 1];
        index += 1;
        continue;
      }
      if (char === "'") quote = false;
      continue;
    }
    if (char === "'") {
      quote = true;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
}

function byName(left: Column, right: Column): number {
  return left.name.localeCompare(right.name);
}
