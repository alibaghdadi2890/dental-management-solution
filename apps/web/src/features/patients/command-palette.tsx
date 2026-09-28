import {
  ageOn,
  type PatientListItem,
  type PatientListQuery,
  patientListQuerySchema,
  type Session,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SHIMMER } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { formatPhone, todayIn } from '@/lib/format';
import { initials } from '@/lib/initials';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { type NewPatientPrefill, usePatientNavigation } from './patient-navigation';
import { patientListQuery } from './patients-api';

type Tenant = NonNullable<Session['tenant']>;

const DEBOUNCE_MS = 180;
const RECENT_SHOWN = 5;
const RESULTS_SHOWN = 8;
/** The smallest page size `GET /patients` accepts; the palette shows a slice of it. */
const FETCH_SIZE = 10;
const MAX_QUERY = 100;

/** Design Q15: the most recently updated active patients (the default view excludes archived). */
const RECENT: PatientListQuery = patientListQuerySchema.parse({ sort: 'recent', size: FETCH_SIZE });
const searchFor = (q: string): PatientListQuery =>
  patientListQuerySchema.parse({ q, size: FETCH_SIZE });

/** A query that reads as a phone number pre-fills the create panel's phone, anything else its
 * name (design "digits → phone, otherwise name"). */
const PHONE_LIKE = /^[\d\s()+-]+$/;
function prefillFor(query: string): NewPatientPrefill {
  return PHONE_LIKE.test(query) && /\d/.test(query) ? { phone: query } : { fullName: query };
}

/**
 * The global patient search (workspace spec §Global Patient Search): a top-anchored modal the
 * shell opens with Ctrl/⌘+K or its "Find patient" button. No query lists the 5 most recently
 * updated patients; a query searches `GET /patients` (debounced) and shows the first 8. ↑/↓ move
 * the active row, Enter or a click opens it; nothing matching offers "Create …" with
 * `patient:write`. Everything typed is dropped on close (the body unmounts with the dialog).
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('patients');
  const { data: session } = useSession();
  const { openPatient, openNewPatient } = usePatientNavigation();
  // Leaving for a patient or the create panel: focus belongs to the panel that opens, not back
  // on the button (or whatever else) that had it before the palette.
  const leaving = useRef(false);
  const tenant = session?.tenant;
  if (!tenant) return null;

  const leave = (go: () => void) => {
    leaving.current = true;
    onOpenChange(false);
    go();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.28)]" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (leaving.current) event.preventDefault();
            leaving.current = false;
          }}
          className="fixed inset-x-6 top-[88px] z-50 mx-auto flex max-h-[calc(100%-112px)] max-w-[540px] animate-popin flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_18px_48px_rgba(27,26,31,.18)]"
        >
          <Dialog.Title className="sr-only">{t('palette.title')}</Dialog.Title>
          <PaletteBody
            tenant={tenant}
            onOpenPatient={(id) => {
              leave(() => {
                openPatient(id);
              });
            }}
            onCreate={(query) => {
              leave(() => {
                openNewPatient(prefillFor(query));
              });
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({
  tenant,
  onOpenPatient,
  onCreate,
}: {
  tenant: Tenant;
  onOpenPatient: (id: string) => void;
  onCreate: (query: string) => void;
}) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const canCreate = usePermission('patient:write');
  const baseId = useId();
  const listId = `${baseId}-list`;
  const headingId = `${baseId}-heading`;
  const optionId = (index: number) => `${baseId}-option-${String(index)}`;

  const [text, setText] = useState('');
  const typed = text.trim();
  const query = useDebouncedValue(typed, DEBOUNCE_MS);
  const searching = query !== '';
  const results = useQuery(patientListQuery(searching ? searchFor(query) : RECENT));
  const rows = results.data?.items.slice(0, searching ? RESULTS_SHOWN : RECENT_SHOWN) ?? [];

  // The active row starts at the top of every new result list.
  const [cursor, setCursor] = useState({ query, index: 0 });
  const active = cursor.query === query ? Math.min(cursor.index, rows.length - 1) : 0;
  const moveTo = (index: number) => {
    setCursor({ query, index });
    document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' });
  };
  // Enter acts on what is on screen only once it answers what was typed, never on the previous
  // list while the debounce or the request is still catching up.
  const settled = typed === query && results.isSuccess && !results.isFetching;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      moveTo(Math.min(Math.max(active + step, 0), rows.length - 1));
      return;
    }
    if (event.key !== 'Enter' || !settled) return;
    event.preventDefault();
    const row = rows[active];
    if (row) onOpenPatient(row.id);
    else if (searching && canCreate) onCreate(query);
  };

  const locale = i18n.resolvedLanguage ?? 'en';
  const today = todayIn(tenant.timeZone);

  let body;
  if (results.isError) {
    body = (
      <div role="alert" className="flex items-center gap-2 px-4 py-5">
        <span className="text-[13px] leading-snug text-ink-secondary">{t('palette.failed')}</span>
        <Button variant="ghost" size="sm" className="px-0" onClick={() => void results.refetch()}>
          {t('common:tryAgain')}
        </Button>
      </div>
    );
  } else if (results.isPending) {
    body = <PaletteSkeleton label={t('palette.loading')} />;
  } else if (rows.length === 0 && searching) {
    body = (
      <div className="flex flex-col items-center px-6 pt-7 pb-6 text-center">
        <p className="text-[13.5px] leading-snug font-medium">{t('palette.noMatch', { query })}</p>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-muted">{t('palette.noMatchHint')}</p>
        {canCreate && (
          <Button
            variant="primary"
            className="mt-4 max-w-full"
            onClick={() => {
              onCreate(query);
            }}
          >
            <span className="truncate">{t('palette.create', { query })}</span>
          </Button>
        )}
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="px-4 py-5 text-[13px] leading-snug text-ink-muted">{t('palette.noPatients')}</p>
    );
  } else {
    body = (
      <>
        <div
          id={headingId}
          className="px-4 pt-3 pb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase"
        >
          {searching ? t('palette.results', { count: results.data.total }) : t('palette.recent')}
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={headingId}
          className="m-0 list-none p-0 pb-1.5"
        >
          {rows.map((row, index) => (
            <PaletteRow
              key={row.id}
              id={optionId(index)}
              patient={row}
              active={index === active}
              age={
                row.dateOfBirth !== null && row.dateOfBirth <= today
                  ? ageOn(row.dateOfBirth, today)
                  : null
              }
              phone={formatPhone(row.phone, tenant.country)}
              locale={locale}
              onHover={() => {
                if (index !== active) setCursor({ query, index });
              }}
              onOpen={() => {
                onOpenPatient(row.id);
              }}
            />
          ))}
        </ul>
      </>
    );
  }

  const hasRows = !results.isError && !results.isPending && rows.length > 0;
  return (
    <>
      <div className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-[13px]">
        <svg
          aria-hidden
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="flex-none text-ink-muted"
        >
          <circle cx="6.8" cy="6.8" r="4.6" />
          <path d="M10.3 10.3 14 14" />
        </svg>
        <input
          role="combobox"
          aria-label={t('palette.label')}
          aria-autocomplete="list"
          aria-expanded={hasRows}
          aria-controls={hasRows ? listId : undefined}
          aria-activedescendant={hasRows ? optionId(active) : undefined}
          value={text}
          maxLength={MAX_QUERY}
          placeholder={t('palette.placeholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-none bg-transparent text-[14.5px] leading-normal outline-none placeholder:text-ink-muted"
        />
        <kbd
          aria-hidden
          className="flex-none rounded-sm border border-border bg-faint px-[5px] py-[3px] font-mono text-[11px] leading-none font-medium text-ink-muted"
        >
          {t('palette.esc')}
        </kbd>
      </div>
      <div className="max-h-[396px] min-h-0 overflow-y-auto">{body}</div>
    </>
  );
}

function PaletteRow({
  id,
  patient,
  active,
  age,
  phone,
  locale,
  onHover,
  onOpen,
}: {
  id: string;
  patient: PatientListItem;
  active: boolean;
  age: number | null;
  phone: string;
  locale: string;
  onHover: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation('patients');
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onOpen}
      className={cn(
        'flex cursor-pointer items-center gap-3 px-4 py-2',
        active ? 'bg-primary-tint/60' : 'bg-surface',
      )}
    >
      <span
        aria-hidden
        className="grid size-[34px] flex-none place-items-center rounded-full border border-border bg-subtle text-[12.5px] leading-none font-semibold text-ink-secondary"
      >
        {initials(patient.fullName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] leading-[1.3] font-medium">
          {patient.fullName}
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs leading-[1.4] text-ink-muted">
          <span dir="ltr" className="font-mono">
            {patient.displayNumber}
          </span>
          <span dir="ltr" className="font-mono tabular-nums">
            {phone}
          </span>
          {age !== null && (
            <span>{t('palette.age', { age: new Intl.NumberFormat(locale).format(age) })}</span>
          )}
        </span>
      </span>
      <span className="flex-none text-xs leading-none text-ink-muted">
        {t('palette.neverSeen')}
      </span>
    </li>
  );
}

const SKELETON_WIDTHS = [150, 120, 170];

function PaletteSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="py-1.5">
      {SKELETON_WIDTHS.map((width) => (
        <div key={width} className="flex items-center gap-3 px-4 py-2">
          <span className={cn('size-[34px] flex-none rounded-full', SHIMMER)} />
          <span className="flex flex-col gap-1.5">
            <span className={cn('h-2.5', SHIMMER)} style={{ width }} />
            <span className={cn('h-2 w-40', SHIMMER)} />
          </span>
        </div>
      ))}
    </div>
  );
}
