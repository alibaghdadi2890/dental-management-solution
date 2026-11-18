import { createContext, useContext } from 'react';

/** Opens the contact panel for a contact (families C); null outside its provider. */
export const ContactPanelContext = createContext<((contactId: string) => void) | null>(null);

/**
 * The contact panel's opener: ⌘K's Contacts, Outstanding's families, the dashboard's largest
 * balances and the Contacts & family card all open it. Null where the shell is not mounted.
 */
export function useOpenContact(): ((contactId: string) => void) | null {
  return useContext(ContactPanelContext);
}
