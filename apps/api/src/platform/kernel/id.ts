import { v7 } from 'uuid';

/** Application-generated, time-ordered primary key (CLAUDE.md §7). */
export function newId(): string {
  return v7();
}
