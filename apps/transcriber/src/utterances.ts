import type { Replica } from './roles';

export type StoredReplica = Replica & { id: string };

export function assignUtteranceIds(replicas: Replica[]): StoredReplica[] {
  return replicas.map((replica, index) => ({
    id: `t${index + 1}`,
    speaker: replica.speaker,
    start: replica.start,
    end: replica.end,
    text: replica.text,
  }));
}
