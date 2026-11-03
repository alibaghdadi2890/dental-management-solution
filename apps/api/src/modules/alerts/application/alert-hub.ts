import { Injectable } from '@nestjs/common';

type Listener = () => void;

/**
 * The open alert streams of this API process, by tenant (D6, ADR-0073). A ping carries no data:
 * each browser refetches its own tray, where who is alerted is decided. In process, so one API
 * instance only; a second would need the ping carried between them (Postgres `NOTIFY`).
 */
@Injectable()
export class AlertHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Returns the unsubscribe. */
  subscribe(tenantId: string, listener: Listener): () => void {
    const set = this.listeners.get(tenantId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(tenantId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(tenantId) === set) this.listeners.delete(tenantId);
    };
  }

  /** Tells every stream of the tenant that its tray may have changed. */
  ping(tenantId: string): void {
    for (const listener of [...(this.listeners.get(tenantId) ?? [])]) listener();
  }

  /** How many streams are open, for tests and logs. */
  size(tenantId: string): number {
    return this.listeners.get(tenantId)?.size ?? 0;
  }
}
