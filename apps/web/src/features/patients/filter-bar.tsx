import { AGE_BANDS, type PatientListQuery, type Practitioner } from '@dcm/contracts';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/list';
import { cn } from '@/lib/utils';
import { activeFilterCount, clearFilters, withFilter } from './list-query';

const SEARCH_DEBOUNCE_MS = 250;

/** A labelled select chip; tinted `#eceef8`/`#c3c7ea` once it differs from its default (POC). */
function FilterChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  /** `''` is the chip's default ("Any", "All", "Any time"). */
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const on = value !== '';
  return (
    <label
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg border ps-[11px] pe-1.5',
        on ? 'border-primary-tint-border bg-primary-tint' : 'border-border-control bg-surface',
      )}
    >
      <span className="text-[12.5px] leading-none whitespace-nowrap text-ink-muted">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="cursor-pointer border-none bg-transparent pe-0.5 text-[12.5px] leading-none font-medium outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function oneOf<T extends string>(values: readonly T[], value: string): T | undefined {
  return values.find((candidate) => candidate === value);
}

/**
 * Search (debounced 250ms) and the Dentist, Last visit, Age and Alerts chips (README §Patients,
 * list anatomy 4). Last visit offers only "Any time" and "Never" until visits exist (design Q14).
 * Every edit goes through `withFilter`, so it lands on page 1.
 */
export function FilterBar({
  query,
  practitioners,
  onChange,
}: {
  query: PatientListQuery;
  practitioners: readonly Practitioner[];
  onChange: (next: PatientListQuery, options?: { replace?: boolean }) => void;
}) {
  const { t } = useTranslation('patients');
  const committed = query.q ?? '';
  const [text, setText] = useState(committed);
  const [seen, setSeen] = useState(committed);
  // "Clear filters" or a back navigation changes `q` from outside: show it in the box.
  if (committed !== seen) {
    setSeen(committed);
    setText(committed);
  }

  const commit = useEffectEvent((q: string) => {
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
      />
      <FilterChip
        label={t('filters.dentist')}
        value={query.dentist ?? ''}
        options={[
          { value: '', label: t('filters.anyDentist') },
          ...practitioners.map((p) => ({ value: p.userId, label: p.displayName })),
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
