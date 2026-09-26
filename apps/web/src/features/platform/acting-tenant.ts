import { useSyncExternalStore } from 'react';

/**
 * The clinic a platform admin is currently managing ("Manage in clinic", ADR-0008). Per-tab UI
 * state: sessionStorage, so it never leaks into another tab or survives closing the browser.
 * Storage can be unavailable (private mode); the app then simply is not acting in a tenant.
 */
const KEY = 'dcm.actingTenantId';
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function actingTenantId(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function startActingIn(tenantId: string): void {
  try {
    sessionStorage.setItem(KEY, tenantId);
  } catch {
    // Without storage the admin portal still works; the clinic shell just is not reachable.
  }
  notify();
}

export function stopActing(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders when the admin enters or leaves a clinic (the session query is keyed by it). */
export function useActingTenantId(): string | null {
  return useSyncExternalStore(subscribe, actingTenantId, () => null);
}
