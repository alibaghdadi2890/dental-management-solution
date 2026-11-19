import type { Session } from '@dcm/contracts';
import { useNavigate } from '@tanstack/react-router';
import { Dialog } from 'radix-ui';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SHIMMER } from '@/components/ui/list';
import { SearchIcon } from '@/components/ui/search-icon';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { StockResult } from '@/features/inventory/stock-result';
import { useStockSearch } from '@/features/inventory/stock-search';
import { useRecordPayment } from '@/features/billing/payments/payment-dialog-context';
import { useOpenTakeOut } from '@/features/inventory/take-out-context';
import { useOpenContact } from '@/features/patients/contact-panel/contact-panel-context';
import { ContactResult, PatientResult } from '@/features/patients/palette-rows';
import { usePatientNavigation } from '@/features/patients/patient-navigation';
import { prefillFor, usePatientSearch } from '@/features/patients/patient-search';
import { ageOrNull, formatPhone, todayIn } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { type SearchScope, searchScope } from '../nav-items';
import { PatientDetailsCell } from './patient-details-cell';
import { usePatientDetails } from './use-patient-details';
import { useSearchWords } from './search-words';

type Tenant = NonNullable<Session['tenant']>;

const DEBOUNCE_MS = 180;
const MAX_QUERY = 100;

type GroupKey = 'patients' | 'contacts' | 'stock';
const GROUPS: readonly GroupKey[] = ['patients', 'contacts', 'stock'];

/** One result: its group, what its first cell shows, what tapping it does, and its actions. */
interface Entry {
  key: string;
  group: GroupKey;
  content: ReactNode;
  open: () => void;
  actions: { key: string; label: string; run: () => void }[];
}

const HEADING =
  'px-4 pt-3 pb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase';

/**
 * The app's search (search spec S1–S8): a top-anchored modal the shell opens with Ctrl/⌘+K or its
 * header button. Its groups follow the permissions: patients and contacts with `patient:read`,
 * the branch's stock items with `inventory:read`.
 *
 * - **Groups.** No query lists the 5 most recently updated patients; a query searches
 *   (debounced) and shows the first 8 patients, up to 3 contacts who are no patient, then up to
 *   3 stock items.
 * - **Rows.** The results are a grid (ADR-0102): a row opens its record, and each action is a
 *   further cell (a stock item's _Take out_). ↑/↓ move the active row, → and ← its active cell,
 *   and Enter does what that cell does.
 * - **Nothing found** offers "Create …" with `patient:write`.
 *
 * Everything typed is dropped on close (the body unmounts with the dialog).
 */
export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const { openPatient, openNewPatient } = usePatientNavigation();
  const openContact = useOpenContact();
  const openTakeOut = useOpenTakeOut();
  const openPayment = useRecordPayment();
  // Radix only hands focus back to a `Dialog.Trigger`, and the palette has none (the shortcut or
  // the header opens it): it remembers what had focus itself.
  const returnFocus = useRef<HTMLElement | null>(null);
  // Where a picked row (or "Create …") goes, once the palette has closed.
  const pending = useRef<(() => void) | null>(null);
  const tenant = session?.tenant;
  if (!session || !tenant) return null;
  const scope = searchScope(session);

  const leave = (go: () => void) => {
    pending.current = go;
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.28)]" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            const opener = document.activeElement;
            returnFocus.current = opener instanceof HTMLElement ? opener : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = returnFocus.current;
            returnFocus.current = null;
            if (opener?.isConnected) opener.focus();
            // Navigate only once focus is back where it was before the palette: the panel that
            // opens takes it from there (and hands it back on close), and a dirty form's
            // unsaved-changes prompt that stops the navigation returns it to that form.
            const go = pending.current;
            pending.current = null;
            go?.();
          }}
          className="fixed inset-x-6 top-[88px] z-50 mx-auto flex max-h-[calc(100%-112px)] max-w-[720px] animate-popin flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_18px_48px_rgba(27,26,31,.18)]"
        >
          <SearchTitle scope={scope} />
          <PaletteBody
            session={session}
            tenant={tenant}
            scope={scope}
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
            onOpenContact={
              openContact
                ? (contactId) => {
                    leave(() => {
                      openContact(contactId);
                    });
                  }
                : null
            }
            onSchedule={
              session.permissions.includes('appointment:write')
                ? (patientId) => {
                    leave(() => {
                      void navigate({ to: '/schedule', search: { bookFor: patientId } });
                    });
                  }
                : null
            }
            onRecordPayment={
              openPayment
                ? (patientId) => {
                    leave(() => {
                      openPayment({ patientId });
                    });
                  }
                : null
            }
            onOpenItem={(itemId, branchId) => {
              leave(() => {
                void navigate({ to: '/inventory', search: { branch: branchId, item: itemId } });
              });
            }}
            onTakeOut={
              openTakeOut
                ? (itemId, branchId) => {
                    leave(() => {
                      openTakeOut(itemId, branchId);
                    });
                  }
                : null
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SearchTitle({ scope }: { scope: SearchScope }) {
  return <Dialog.Title className="sr-only">{useSearchWords(scope).title}</Dialog.Title>;
}

function PaletteBody({
  session,
  tenant,
  scope,
  onOpenPatient,
  onCreate,
  onOpenContact,
  onSchedule,
  onRecordPayment,
  onOpenItem,
  onTakeOut,
}: {
  session: Session;
  tenant: Tenant;
  scope: SearchScope;
  onOpenPatient: (id: string) => void;
  onCreate: (query: string) => void;
  /** Null without the contact panel: no Contacts group. */
  onOpenContact: ((contactId: string) => void) | null;
  /** Null without `appointment:write`: no _Schedule_. */
  onSchedule: ((patientId: string) => void) | null;
  /** Null without `payment:write`: no _Record payment_. */
  onRecordPayment: ((patientId: string) => void) | null;
  onOpenItem: (itemId: string, branchId: string) => void;
  /** Null without `inventory:write`: no _Take out_. */
  onTakeOut: ((itemId: string, branchId: string) => void) | null;
}) {
  const { t } = useTranslation(['shell', 'patients', 'common']);
  const canCreate = usePermission('patient:write') && scope.patients;
  const baseId = useId();
  const gridId = `${baseId}-grid`;
  const headingId = (group: GroupKey) => `${baseId}-${group}`;
  const cellId = (index: number, column: number) =>
    `${baseId}-cell-${String(index)}-${String(column)}`;
  const words = useSearchWords(scope);

  const [text, setText] = useState('');
  const typed = text.trim();
  const query = useDebouncedValue(typed, DEBOUNCE_MS);
  const searching = query !== '';
  const people = usePatientSearch(query, {
    patients: scope.patients,
    contacts: onOpenContact !== null,
  });
  const branchId = scope.branchId;
  const stock = useStockSearch(query, scope.stock ? branchId : null);
  // The results answer exactly what is typed (a background refresh of the same list doesn't
  // unsettle them).
  const settled = typed === query && people.settled && people.contactsSettled && stock.settled;

  const today = todayIn(tenant.timeZone);
  const detailsOf = usePatientDetails(
    session,
    people.rows.map((row) => row.id),
  );
  const entries: Entry[] = [
    ...people.rows.map((row): Entry => ({
      key: row.id,
      group: 'patients',
      content: (
        <PatientResult
          patient={row}
          age={ageOrNull(row.dateOfBirth, today)}
          phone={row.phone ? formatPhone(row.phone, tenant.country) : null}
          end={<PatientDetailsCell details={detailsOf(row.id)} tenant={tenant} />}
        />
      ),
      open: () => {
        onOpenPatient(row.id);
      },
      actions: [
        ...(onSchedule
          ? [
              {
                key: 'schedule',
                label: t('search.schedule'),
                run: () => {
                  onSchedule(row.id);
                },
              },
            ]
          : []),
        ...(onRecordPayment
          ? [
              {
                key: 'payment',
                label: t('search.recordPayment'),
                run: () => {
                  onRecordPayment(row.id);
                },
              },
            ]
          : []),
      ],
    })),
    ...people.contacts.map((contact): Entry => ({
      key: contact.id,
      group: 'contacts',
      content: (
        <ContactResult
          contact={contact}
          phone={contact.phone ? formatPhone(contact.phone, tenant.country) : null}
        />
      ),
      open: () => {
        onOpenContact?.(contact.id);
      },
      actions: [],
    })),
    ...(branchId === null
      ? []
      : stock.rows.map((row): Entry => ({
          key: row.itemId,
          group: 'stock',
          content: <StockResult row={row} />,
          open: () => {
            onOpenItem(row.itemId, branchId);
          },
          actions:
            onTakeOut && row.onHand > 0
              ? [
                  {
                    key: 'takeOut',
                    label: t('search.takeOut'),
                    run: () => {
                      onTakeOut(row.itemId, branchId);
                    },
                  },
                ]
              : [],
        }))),
  ];
  const options = entries.length;

  // The active row starts at the top of every new result list, on its first cell.
  const [cursor, setCursor] = useState({ query, index: 0, column: 0 });
  const active = cursor.query === query ? Math.max(Math.min(cursor.index, options - 1), 0) : 0;
  const activeEntry = entries[active];
  const column =
    cursor.query === query && cursor.index === active
      ? Math.min(cursor.column, activeEntry?.actions.length ?? 0)
      : 0;
  const moveTo = (index: number) => {
    setCursor({ query, index, column: 0 });
    document.getElementById(cellId(index, 0))?.scrollIntoView({ block: 'nearest' });
  };

  const failed = people.failed;
  // With no patient found, the other groups decide between them and "No patient matches".
  const othersSettled = people.contactsSettled && (!searching || stock.settled);
  const loading = !failed && (people.pending || (people.rows.length === 0 && !othersSettled));
  const hasRows = !failed && !loading && people.rows.length > 0;
  const hasOptions = !loading && options > 0;
  const noMatch = !failed && !loading && options === 0 && searching;
  const noPatients =
    scope.patients && !failed && !loading && people.rows.length === 0 && !searching;
  const stockIdle = !scope.patients && !searching;

  // Enter does what the active cell does — or, with nothing found, creates — but only once the
  // results answer what was typed: an Enter pressed while the debounce or the request is still
  // catching up waits for them (and is dropped if the person types on, or if that search fails:
  // a later Try again must not act on a key pressed before the error showed).
  const pendingEnter = useRef<string | null>(null);
  const enter = () => {
    if (activeEntry) {
      const action = column > 0 ? activeEntry.actions[column - 1] : undefined;
      if (action) action.run();
      else activeEntry.open();
    } else if (searching && canCreate && options === 0) onCreate(query);
  };
  const enterWhenSettled = useEffectEvent(() => {
    if (pendingEnter.current === null || pendingEnter.current !== query || !settled) return;
    pendingEnter.current = null;
    enter();
  });
  useEffect(() => {
    enterWhenSettled();
  }, [query, settled]);
  useEffect(() => {
    if (failed) pendingEnter.current = null;
  }, [failed]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // An input method (Arabic, CJK…) uses Enter and the arrows to pick its own candidates.
    // Safari reports the Enter that ends a composition with `isComposing` off but keyCode 229.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no standard replacement
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      moveTo(Math.min(Math.max(active + step, 0), options - 1));
      return;
    }
    // The arrow toward the inline end reaches the row's actions from the end of the text; the
    // other walks back and, from the first cell, gives the caret back.
    const input = event.currentTarget;
    const rtl = getComputedStyle(input).direction === 'rtl';
    const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const back = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (forward && activeEntry && column < activeEntry.actions.length) {
      const end = input.value.length;
      if (input.selectionStart !== end || input.selectionEnd !== end) return;
      event.preventDefault();
      setCursor({ query, index: active, column: column + 1 });
      return;
    }
    if (back && column > 0) {
      event.preventDefault();
      setCursor({ query, index: active, column: column - 1 });
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (settled) enter();
    else if (!(failed && typed === query)) pendingEnter.current = typed;
  };

  const branchName =
    session.branches.length > 1
      ? session.branches.find((branch) => branch.id === branchId)?.name
      : undefined;
  const groupHeading = (group: GroupKey) =>
    group === 'contacts'
      ? t('patients:palette.contacts')
      : branchName
        ? t('search.stockIn', { branch: branchName })
        : t('search.stock');
  const rowsOf = (group: GroupKey) =>
    entries.flatMap((entry, index) => (entry.group === group ? [{ entry, index }] : []));

  return (
    <>
      <div className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-[13px]">
        <SearchIcon size={15} className="text-ink-muted" />
        <input
          role="combobox"
          aria-label={words.label}
          aria-autocomplete="list"
          aria-haspopup="grid"
          aria-expanded={hasOptions}
          aria-controls={hasOptions ? gridId : undefined}
          aria-activedescendant={hasOptions ? cellId(active, column) : undefined}
          value={text}
          maxLength={MAX_QUERY}
          placeholder={words.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            pendingEnter.current = null;
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-none bg-transparent text-[14.5px] leading-normal outline-none placeholder:text-ink-muted"
        />
        <kbd
          aria-hidden
          className="flex-none rounded-sm border border-border bg-faint px-[5px] py-[3px] font-mono text-[11px] leading-none font-medium text-ink-muted"
        >
          {t('patients:palette.esc')}
        </kbd>
      </div>
      <div className="max-h-[420px] min-h-0 overflow-y-auto">
        {failed && (
          <div role="alert" className="flex items-center gap-2 px-4 py-5">
            <span className="text-[13px] leading-snug text-ink-secondary">
              {t('patients:palette.failed')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="px-0"
              onClick={() => void people.results.refetch()}
            >
              {t('common:tryAgain')}
            </Button>
          </div>
        )}
        {/* One polite live region, always present, so what the list now shows is announced. */}
        <div role="status">
          {loading && <span className="sr-only">{t('patients:palette.loading')}</span>}
          {hasRows && (
            <div id={headingId('patients')} className={HEADING}>
              {searching ? (
                <>
                  {t('patients:palette.results', { count: people.results.data?.total ?? 0 })}
                  {/* Named with the query too, so a new search with the same count is announced. */}
                  <span className="sr-only">{` ${t('patients:palette.resultsFor', { query })}`}</span>
                </>
              ) : (
                t('patients:palette.recent')
              )}
            </div>
          )}
          {noMatch && (
            <div className="px-6 pt-7 text-center">
              <p className="text-[13.5px] leading-snug font-medium">
                {scope.stock
                  ? t('search.noMatch', { query })
                  : t('patients:palette.noMatch', { query })}
              </p>
              {!scope.stock && (
                <p className="mt-1 text-[12.5px] leading-snug text-ink-muted">
                  {t('patients:palette.noMatchHint')}
                </p>
              )}
            </div>
          )}
          {noPatients && (
            <p className="px-4 py-5 text-[13px] leading-snug text-ink-muted">
              {t('patients:palette.noPatients')}
            </p>
          )}
          {stockIdle && (
            <p className="px-4 py-5 text-[13px] leading-snug text-ink-muted">
              {t('search.stockIdle')}
            </p>
          )}
        </div>
        {loading && <PaletteSkeleton />}
        {noMatch && canCreate && (
          <div className="flex justify-center px-6 pt-4 pb-6">
            <Button
              variant="primary"
              className="max-w-full"
              onClick={() => {
                onCreate(query);
              }}
            >
              <span className="truncate">{t('patients:palette.create', { query })}</span>
            </Button>
          </div>
        )}
        {hasOptions && (
          <div
            id={gridId}
            role="grid"
            aria-labelledby={headingId(entries[0]?.group ?? 'patients')}
            className="pb-1.5"
          >
            {GROUPS.map((group) => {
              const rows = rowsOf(group);
              if (rows.length === 0) return null;
              return (
                <div key={group} role="rowgroup" aria-labelledby={headingId(group)}>
                  {group !== 'patients' && (
                    <div id={headingId(group)} className={HEADING}>
                      {groupHeading(group)}
                    </div>
                  )}
                  {rows.map(({ entry, index }) => (
                    <ResultRow
                      key={entry.key}
                      entry={entry}
                      cellId={(cell) => cellId(index, cell)}
                      active={index === active}
                      activeColumn={index === active ? column : -1}
                      onHover={() => {
                        if (index !== active) setCursor({ query, index, column: 0 });
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/** One result row: the whole row opens it, each action is its own cell (ADR-0102). */
function ResultRow({
  entry,
  cellId,
  active,
  activeColumn,
  onHover,
}: {
  entry: Entry;
  cellId: (column: number) => string;
  active: boolean;
  /** The active cell of this row; -1 when the row is not active. */
  activeColumn: number;
  onHover: () => void;
}) {
  return (
    <div
      role="row"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={entry.open}
      className={cn(
        'group flex cursor-pointer items-center gap-2 pe-3',
        active ? 'bg-primary-tint/60' : 'bg-surface',
      )}
    >
      <div
        role="gridcell"
        id={cellId(0)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 ps-4"
      >
        {entry.content}
      </div>
      {entry.actions.map((action, index) => (
        <div key={action.key} role="gridcell" id={cellId(index + 1)} className="flex-none">
          <Button
            size="sm"
            tabIndex={-1}
            data-active={activeColumn === index + 1 ? '' : undefined}
            onClick={(event) => {
              event.stopPropagation();
              action.run();
            }}
            className={cn(
              'data-active:ring-2 data-active:ring-primary',
              // Shown on the active or hovered row; always on a touch screen.
              active
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100',
            )}
          >
            {action.label}
          </Button>
        </div>
      ))}
    </div>
  );
}

const SKELETON_WIDTHS = [150, 120, 170];

function PaletteSkeleton() {
  return (
    <div aria-hidden className="py-1.5">
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
