import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runFairLoop, type ListRedis } from '../src/fair-loop';

class MemoryRedis implements ListRedis {
  private readonly lists = new Map<string, string[]>();

  private list(key: string): string[] {
    let found = this.lists.get(key);
    if (!found) {
      found = [];
      this.lists.set(key, found);
    }
    return found;
  }

  async lMove(
    source: string,
    destination: string,
    from: 'LEFT' | 'RIGHT',
    to: 'LEFT' | 'RIGHT',
  ): Promise<string | null> {
    const src = this.list(source);
    if (src.length === 0) {
      return null;
    }
    const value = from === 'LEFT' ? src.shift() ?? null : src.pop() ?? null;
    if (value === null) {
      return null;
    }
    const dst = this.list(destination);
    if (to === 'LEFT') {
      dst.unshift(value);
    } else {
      dst.push(value);
    }
    return value;
  }

  async blMove(
    source: string,
    destination: string,
    from: 'LEFT' | 'RIGHT',
    to: 'LEFT' | 'RIGHT',
  ): Promise<string | null> {
    const immediate = await this.lMove(source, destination, from, to);
    if (immediate) {
      return immediate;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    return this.lMove(source, destination, from, to);
  }

  async lRem(key: string, _count: number, element: string): Promise<number> {
    const list = this.list(key);
    const index = list.indexOf(element);
    if (index < 0) {
      return 0;
    }
    list.splice(index, 1);
    return 1;
  }

  async rPush(key: string, value: string): Promise<number> {
    const list = this.list(key);
    list.push(value);
    return list.length;
  }
}

describe('fair consumer', () => {
  it('does not let one project occupy every slot when the ceiling is 2', async () => {
    const redis = new MemoryRedis();
    const queue = 'calls.transcribe';
    const jobs = [
      { project_id: 'a', call_id: 'a1', enqueued_at: '2026-01-01T00:00:01.000Z' },
      { project_id: 'a', call_id: 'a2', enqueued_at: '2026-01-01T00:00:02.000Z' },
      { project_id: 'b', call_id: 'b1', enqueued_at: '2026-01-01T00:00:03.000Z' },
    ];
    for (const job of jobs) {
      await redis.rPush(queue, JSON.stringify(job));
    }
    const running = new Map<string, number>();
    let maxProject = 0;
    let maxTotal = 0;
    const seen: string[] = [];
    let stopped = false;
    const loop = runFairLoop({
      redis,
      queue,
      reserved: `${queue}.reserved`,
      ceiling: 2,
      stopped: () => stopped,
      parse: (raw) => JSON.parse(raw) as (typeof jobs)[number],
      handle: async (message) => {
        const next = (running.get(message.project_id) ?? 0) + 1;
        running.set(message.project_id, next);
        maxProject = Math.max(maxProject, next);
        maxTotal = Math.max(
          maxTotal,
          [...running.values()].reduce((sum, value) => sum + value, 0),
        );
        await new Promise((resolve) => setTimeout(resolve, 60));
        running.set(message.project_id, (running.get(message.project_id) ?? 1) - 1);
        seen.push(message.call_id);
      },
    });
    const started = Date.now();
    while (seen.length < 3 && Date.now() - started < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    stopped = true;
    await loop;
    assert.deepEqual(seen.sort(), ['a1', 'a2', 'b1']);
    assert.equal(maxProject, 1);
    assert.ok(maxTotal <= 2);
    assert.equal(maxTotal, 2);
  });
});
