import { ProjectScheduler } from './slots';

export type ListRedis = {
  lMove(
    source: string,
    destination: string,
    from: 'LEFT' | 'RIGHT',
    to: 'LEFT' | 'RIGHT',
  ): Promise<string | null>;
  blMove(
    source: string,
    destination: string,
    from: 'LEFT' | 'RIGHT',
    to: 'LEFT' | 'RIGHT',
    timeout: number,
  ): Promise<string | null>;
  lRem(key: string, count: number, element: string): Promise<number>;
  rPush(key: string, value: string): Promise<number>;
};

export async function recoverReserved(redis: ListRedis, reserved: string, queue: string): Promise<void> {
  for (;;) {
    const raw = await redis.lMove(reserved, queue, 'RIGHT', 'LEFT');
    if (!raw) {
      return;
    }
  }
}

export async function runFairLoop<T extends { project_id: string; enqueued_at: string }>(options: {
  redis: ListRedis;
  queue: string;
  reserved: string;
  ceiling: number;
  stopped: () => boolean;
  parse: (raw: string) => T | null;
  handle: (message: T) => Promise<void>;
}): Promise<void> {
  const scheduler = new ProjectScheduler<T>(options.ceiling);
  const inflight = new Set<Promise<void>>();

  const accept = async (raw: string): Promise<void> => {
    let parsed: T | null = null;
    try {
      parsed = options.parse(raw);
    } catch {
      parsed = null;
    }
    if (!parsed?.project_id) {
      await options.redis.lRem(options.reserved, 1, raw);
      return;
    }
    scheduler.push({ ...parsed, raw });
  };

  const start = (job: T & { raw: string }): void => {
    const raw = job.raw;
    const message = { ...job };
    delete (message as { raw?: string }).raw;
    const task = (async () => {
      try {
        await options.handle(message as unknown as T);
      } catch (error) {
        console.error(options.queue, error);
      } finally {
        scheduler.release(message.project_id);
        await options.redis.lRem(options.reserved, 1, raw);
      }
    })();
    inflight.add(task);
    void task.finally(() => {
      inflight.delete(task);
    });
  };

  try {
    while (!options.stopped()) {
      for (let i = 0; i < 200; i += 1) {
        const raw = await options.redis.lMove(options.queue, options.reserved, 'LEFT', 'RIGHT');
        if (!raw) {
          break;
        }
        await accept(raw);
      }
      let started = false;
      for (;;) {
        const job = scheduler.take();
        if (!job) {
          break;
        }
        started = true;
        start(job);
      }
      if (options.stopped()) {
        break;
      }
      if (!started && inflight.size === 0 && !scheduler.hasWaiting()) {
        const raw = await options.redis.blMove(options.queue, options.reserved, 'LEFT', 'RIGHT', 1);
        if (raw) {
          await accept(raw);
        }
        continue;
      }
      await delay(25);
    }
  } finally {
    await Promise.all([...inflight]);
    await recoverReserved(options.redis, options.reserved, options.queue);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
