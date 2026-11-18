import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useCallback, useState } from 'react';
import { ContactPanelContext } from './contact-panel-context';
import { ContactPanel } from './contact-panel';

/**
 * Mounts the one contact panel (families C) in the app shell: every entry point opens it through
 * `useOpenContact`. A new opening remounts it; going to another page (a member's record, Register
 * as patient) closes it.
 */
export function ContactPanelProvider({ children }: { children: ReactNode }) {
  const href = useRouterState({ select: (state) => state.location.href });
  const [open, setOpen] = useState<{ id: number; contactId: string; href: string } | null>(null);
  const openContact = useCallback(
    (contactId: string) => {
      setOpen((current) => ({ id: (current?.id ?? 0) + 1, contactId, href }));
    },
    [href],
  );
  if (open && open.href !== href) setOpen(null);
  return (
    <ContactPanelContext value={openContact}>
      {children}
      {open && open.href === href && (
        <ContactPanel
          key={open.id}
          contactId={open.contactId}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </ContactPanelContext>
  );
}
