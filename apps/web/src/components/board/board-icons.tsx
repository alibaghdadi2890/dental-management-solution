import type { ReactNode } from 'react';

/** The board cards' badges: 14px line icons in the badge's white (decorative, `aria-hidden`). */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const PATHS = {
  /** Waiting: a clock. */
  waiting: (
    <Icon>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </Icon>
  ),
  /** In the chair: a live dot in a ring. */
  chair: (
    <Icon>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </Icon>
  ),
  /** Next up: an arrow. */
  next: (
    <Icon>
      <path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" />
    </Icon>
  ),
  /** Checkout: a receipt. */
  checkout: (
    <Icon>
      <path d="M4 2.5h8v11l-2-1.2-2 1.2-2-1.2-2 1.2z" />
      <path d="M6 6h4M6 8.5h4" />
    </Icon>
  ),
  /** Schedule: a calendar. */
  schedule: (
    <Icon>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </Icon>
  ),
  /** Coming up: a list. */
  list: (
    <Icon>
      <path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01" />
    </Icon>
  ),
  /** Follow-ups: a return arrow. */
  followUp: (
    <Icon>
      <path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2" />
      <path d="M12.5 2.5v2.8H9.7" />
    </Icon>
  ),
  /** Openings: a gap in a bar. */
  opening: (
    <Icon>
      <path d="M2 8h3.5M10.5 8H14" />
      <rect x="5.5" y="5" width="5" height="6" rx="1" strokeDasharray="1.6 1.4" />
    </Icon>
  ),
  /** Lab work: a flask. */
  lab: (
    <Icon>
      <path d="M6 2.5h4M6.5 2.5v4L3.5 12a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5l-3-5.5v-4" />
    </Icon>
  ),
  /** Stock: a box. */
  stock: (
    <Icon>
      <path d="M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11z" />
      <path d="M2.5 5L8 7.5 13.5 5M8 7.5v6" />
    </Icon>
  ),
  /** Expenses: money going out. */
  expenses: (
    <Icon>
      <rect x="2" y="4" width="12" height="8" rx="1.5" />
      <circle cx="8" cy="8" r="1.7" />
    </Icon>
  ),
} as const;

export type BoardIconName = keyof typeof PATHS;

/** A board card's badge icon. */
export function BoardIcon({ name }: { name: BoardIconName }) {
  return PATHS[name];
}
