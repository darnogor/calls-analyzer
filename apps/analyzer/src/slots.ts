export type SlotJob<T> = T & { raw: string };

export class ProjectScheduler<T extends { project_id: string; enqueued_at: string }> {
  private readonly waiting = new Map<string, Array<SlotJob<T>>>();
  private readonly inflight = new Map<string, number>();
  private total = 0;

  constructor(private readonly ceiling: number) {
    if (!Number.isInteger(ceiling) || ceiling < 1) {
      throw new Error('ceiling must be a positive integer');
    }
  }

  get maxPerProject(): number {
    return this.ceiling === 1 ? 1 : this.ceiling - 1;
  }

  push(job: SlotJob<T>): void {
    const list = this.waiting.get(job.project_id) ?? [];
    list.push(job);
    list.sort((left, right) => waitTime(left.enqueued_at) - waitTime(right.enqueued_at));
    this.waiting.set(job.project_id, list);
  }

  hasWaiting(): boolean {
    for (const jobs of this.waiting.values()) {
      if (jobs.length > 0) {
        return true;
      }
    }
    return false;
  }

  take(): SlotJob<T> | null {
    if (this.total >= this.ceiling) {
      return null;
    }
    const maxPer = this.maxPerProject;
    let bestId: string | null = null;
    let bestAt = Infinity;
    for (const [projectId, jobs] of this.waiting) {
      if (jobs.length === 0 || (this.inflight.get(projectId) ?? 0) >= maxPer) {
        continue;
      }
      const at = waitTime(jobs[0].enqueued_at);
      if (bestId === null || at < bestAt || (at === bestAt && projectId < bestId)) {
        bestId = projectId;
        bestAt = at;
      }
    }
    if (!bestId) {
      return null;
    }
    const jobs = this.waiting.get(bestId) ?? [];
    const job = jobs.shift();
    if (!job) {
      return null;
    }
    if (jobs.length === 0) {
      this.waiting.delete(bestId);
    }
    this.inflight.set(bestId, (this.inflight.get(bestId) ?? 0) + 1);
    this.total += 1;
    return job;
  }

  release(projectId: string): void {
    this.total = Math.max(0, this.total - 1);
    const left = (this.inflight.get(projectId) ?? 1) - 1;
    if (left <= 0) {
      this.inflight.delete(projectId);
    } else {
      this.inflight.set(projectId, left);
    }
  }
}

function waitTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
