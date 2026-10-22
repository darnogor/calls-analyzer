import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProjectScheduler } from '../src/slots';

type Job = { project_id: string; enqueued_at: string; id: string };

function job(projectId: string, at: string, id: string): Job & { raw: string } {
  return { project_id: projectId, enqueued_at: at, id, raw: id };
}

describe('provider slots', () => {
  it('lets one project take the only slot when the ceiling is 1', () => {
    const scheduler = new ProjectScheduler<Job>(1);
    scheduler.push(job('a', '2026-01-01T00:00:01.000Z', 'a'));
    scheduler.push(job('b', '2026-01-01T00:00:02.000Z', 'b'));
    assert.equal(scheduler.take()?.id, 'a');
    assert.equal(scheduler.take(), null);
    scheduler.release('a');
    assert.equal(scheduler.take()?.id, 'b');
  });

  it('keeps one slot free when the ceiling is 2 or more', () => {
    const two = new ProjectScheduler<Job>(2);
    two.push(job('a', '2026-01-01T00:00:01.000Z', 'a1'));
    two.push(job('a', '2026-01-01T00:00:02.000Z', 'a2'));
    assert.equal(two.take()?.id, 'a1');
    assert.equal(two.take(), null);
    two.push(job('b', '2026-01-01T00:00:03.000Z', 'b1'));
    assert.equal(two.take()?.id, 'b1');

    const three = new ProjectScheduler<Job>(3);
    three.push(job('a', '2026-01-01T00:00:01.000Z', 'a1'));
    three.push(job('a', '2026-01-01T00:00:02.000Z', 'a2'));
    three.push(job('a', '2026-01-01T00:00:03.000Z', 'a3'));
    assert.equal(three.take()?.id, 'a1');
    assert.equal(three.take()?.id, 'a2');
    assert.equal(three.take(), null);
    assert.equal(three.maxPerProject, 2);
  });

  it('gives a free slot to the project that has been waiting longer', () => {
    const scheduler = new ProjectScheduler<Job>(2);
    scheduler.push(job('a', '2026-01-01T00:00:05.000Z', 'a'));
    scheduler.push(job('b', '2026-01-01T00:00:01.000Z', 'b'));
    assert.equal(scheduler.take()?.id, 'b');
    assert.equal(scheduler.take()?.id, 'a');
    scheduler.release('b');
    scheduler.release('a');
    scheduler.push(job('a', '2026-01-01T00:00:04.000Z', 'a2'));
    scheduler.push(job('b', '2026-01-01T00:00:02.000Z', 'b2'));
    assert.equal(scheduler.take()?.id, 'b2');
  });
});
