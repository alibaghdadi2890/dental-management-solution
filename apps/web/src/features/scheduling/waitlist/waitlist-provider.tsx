import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/features/auth/session';
import { FillPanel } from './fill-panel';
import { WaitlistContext } from './waitlist-context';
import { type WaitlistEntryDraft, WaitlistEntryPanel } from './waitlist-entry-panel';

type Open =
  | { kind: 'fill'; id: number; appointmentId: string; at?: string | undefined; href: string }
  | { kind: 'entry'; id: number; draft: WaitlistEntryDraft; href: string };

/**
 * Mounts the waitlist's panels once, over whatever page is shown (S2), as the search's Take out
 * panel is: *Fill* for `appointment:write_all`, *Add to waitlist* for `appointment:write`. A new
 * opening remounts the panel; going to another page closes it.
 */
export function WaitlistProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const href = useRouterState({ select: (state) => state.location.href });
  const [open, setOpen] = useState<Open | null>(null);
  // Read when a panel opens: a toast's *Fill* may run after its page's search changed.
  const current = useRef(href);
  useEffect(() => {
    current.current = href;
  }, [href]);
  const permissions = session?.tenant ? session.permissions : [];
  const canFill = permissions.includes('appointment:write_all');
  const canAdd = permissions.includes('appointment:write');
  const openFill = useCallback((appointmentId: string, at?: string) => {
    setOpen((before) => ({
      kind: 'fill',
      id: (before?.id ?? 0) + 1,
      appointmentId,
      at,
      href: current.current,
    }));
  }, []);
  const openEntry = useCallback((draft: WaitlistEntryDraft) => {
    setOpen((before) => ({
      kind: 'entry',
      id: (before?.id ?? 0) + 1,
      draft,
      href: current.current,
    }));
  }, []);
  const value = useMemo(
    () => ({ openFill: canFill ? openFill : null, openEntry: canAdd ? openEntry : null }),
    [canFill, canAdd, openFill, openEntry],
  );
  if (open && open.href !== href) setOpen(null);
  const close = () => {
    setOpen(null);
  };
  return (
    <WaitlistContext value={value}>
      {children}
      {open?.kind === 'fill' && canFill ? (
        <FillPanel key={open.id} appointmentId={open.appointmentId} at={open.at} onClose={close} />
      ) : null}
      {open?.kind === 'entry' && canAdd ? (
        <WaitlistEntryPanel key={open.id} draft={open.draft} onClose={close} />
      ) : null}
    </WaitlistContext>
  );
}
