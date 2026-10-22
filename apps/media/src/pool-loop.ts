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

export async function runPoolLoop(options: {
  redis: ListRedis;
  queue: string;
  reserved: string;
  concurrency: number;
  stopped: () => boolean;
  handle: (raw: string) => Promise<void>;
}): Promise<void> {
  const inflight = new Set<Promise<void>>();
  const start = (raw: string): void => {
    const task = (async () => {
      try {
        await options.handle(raw);
      } catch (error) {
        console.error(options.queue, error);
      } finally {
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
      while (inflight.size < options.concurrency && !options.stopped()) {
        const raw = await options.redis.lMove(options.queue, options.reserved, 'LEFT', 'RIGHT');
        if (!raw) {
          break;
        }
        start(raw);
      }
      if (options.stopped()) {
        break;
      }
      if (inflight.size === 0) {
        const raw = await options.redis.blMove(options.queue, options.reserved, 'LEFT', 'RIGHT', 1);
        if (raw) {
          start(raw);
        }
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    await Promise.all([...inflight]);
    await recoverReserved(options.redis, options.reserved, options.queue);
  }
}
