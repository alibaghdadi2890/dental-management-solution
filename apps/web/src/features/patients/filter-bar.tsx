import { AGE_BANDS, type PatientListQuery, type Practitioner } from '@dcm/contracts';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FilterChip, SearchInput } from '@/components/ui/list';
import { activeFilterCount, clearFilters, withFilter } from './list-query';

const SEARCH_DEBOUNCE_MS = 250;
/** `patientListQuerySchema.q`'s limit. */
const SEARCH_MAX_LENGTH = 100;

function oneOf<T extends string>(values: readonly T[], value: string): T | undefined {
  return values.find((candidate) => candidate === value);
}

/**
 * Search (debounced 250ms) and the Dentist, Last visit, Age and Alerts chips (README §Patients,
 * list anatomy 4). Last visit offers "Any time" and "Never" (4b, D18).
 * Every edit goes through `withFilter`, so it lands on page 1.
 */
export function FilterBar({
  query,
  practitioners,
  dentistNames,
  onChange,
}: {
  query: PatientListQuery;
  /** Active dentists: the chip's options. */
  practitioners: readonly Practitioner[];
  /** Every known dentist's name, to label a URL's dentist who is no longer active. */
  dentistNames: ReadonlyMap<string, string>;
  onChange: (next: PatientListQuery, options?: { replace?: boolean }) => void;
}) {
  const { t } = useTranslation('patients');
  const committed = query.q ?? '';
  const [text, setText] = useState(committed);
  const [seen, setSeen] = useState(committed);
  // The value this box last committed itself, until it comes back through the URL.
  const [ownCommit, setOwnCommit] = useState<string | null>(null);
  if (committed !== seen) {
    setSeen(committed);
    if (committed === ownCommit) {
      // Our own debounced commit: the box may already hold more (or a trailing space) — keep it.
      setOwnCommit(null);
    } else if (committed !== text.trim()) {
      // Changed from outside (Clear filters, back/forward): show it.
      setText(committed);
    }
  }

  const commit = useEffectEvent((q: string) => {
    setOwnCommit(q);
    onChange(withFilter(query, { q: q || undefined }), { replace: true });
  });
  useEffect(() => {
    const next = text.trim();
    if (next === committed) return undefined;
    const timer = setTimeout(() => {
      commit(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text, committed]);

  const unlistedDentist =
    query.dentist !== undefined &&
    query.dentist !== 'none' &&
    !practitioners.some((p) => p.id === query.dentist)
      ? query.dentist
      : undefined;

  const set = (patch: Partial<PatientListQuery>) => {
    onChange(withFilter(query, patch));
  };

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <SearchInput
        value={text}
        onChange={setText}
        placeholder={t('search.placeholder')}
        label={t('search.label')}
        maxLength={SEARCH_MAX_LENGTH}
      />
      <FilterChip
        label={t('filters.dentist')}
        value={query.dentist ?? ''}
        options={[
          { value: '', label: t('filters.anyDentist') },
          ...practitioners.map((p) => ({ value: p.id, label: p.displayName })),
          ...(unlistedDentist
            ? [
                {
                  value: unlistedDentist,
                  label: dentistNames.get(unlistedDentist) ?? t('filters.unknownDentist'),
                },
              ]
            : []),
          { value: 'none', label: t('filters.noDentist') },
        ]}
        onChange={(value) => {
          set({ dentist: value || undefined });
        }}
      />
      <FilterChip
        label={t('filters.lastVisit')}
        value={query.lastVisit === 'never' ? 'never' : ''}
        options={[
          { value: '', label: t('filters.anyTime') },
          { value: 'never', label: t('filters.never') },
        ]}
        onChange={(value) => {
          set({ lastVisit: value === 'never' ? 'never' : undefined });
        }}
      />
      <FilterChip
        label={t('filters.age')}
        value={query.age ?? ''}
        options={[
          { value: '', label: t('filters.allAges') },
          ...AGE_BANDS.map((band) => ({ value: band, label: t(`filters.${band}`) })),
        ]}
        onChange={(value) => {
          set({ age: oneOf(AGE_BANDS, value) });
        }}
      />
      <FilterChip
        label={t('filters.alerts')}
        value={query.alerts ?? ''}
        options={[
          { value: '', label: t('filters.anyAlerts') },
          { value: 'yes', label: t('filters.hasAlerts') },
          { value: 'no', label: t('filters.noAlerts') },
        ]}
        onChange={(value) => {
          set({ alerts: oneOf(['yes', 'no'] as const, value) });
        }}
      />
      {activeFilterCount(query) > 0 && (
        <Button
          variant="ghost"
          className="px-2.5"
          onClick={() => {
            onChange(clearFilters(query));
          }}
        >
          {t('filters.clear')}
        </Button>
      )}
    </div>
  );
}
