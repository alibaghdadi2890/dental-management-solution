/** The clinic Settings' tabs (ADR-0055), in order; each shows only with its permission. */
export const SETTINGS_TABS = ['chart', 'staff', 'roles'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
