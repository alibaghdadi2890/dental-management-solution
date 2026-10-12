import type { ServiceItem } from '@dcm/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';

/** How many frequent services are offered as chips, and how many search results are listed. */
const MAX_CHIPS = 6;
const MAX_RESULTS = 6;

/**
 * Picks a treatment to propose (feature 10, V7): the catalog's frequently used services as
 * chips, and a search of the catalog by name or code. It lists `services` as given: its parent
 * decides which ones fit where the treatment goes.
 */
export function ServicePicker({
  services,
  searchLabel,
  onPick,
}: {
  services: readonly ServiceItem[];
  /** The search box's accessible name: what the treatment is for. */
  searchLabel: string;
  onPick: (item: ServiceItem) => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const [query, setQuery] = useState('');
  const pick = (item: ServiceItem) => {
    onPick(item);
    setQuery('');
  };

  const needle = query.trim().toLocaleLowerCase();
  const results =
    needle === ''
      ? []
      : services
          .filter(
            (item) =>
              item.name.toLocaleLowerCase().includes(needle) ||
              item.code.toLocaleLowerCase().includes(needle),
          )
          .slice(0, MAX_RESULTS);
  const frequent = services.filter((item) => item.frequent).slice(0, MAX_CHIPS);

  return (
    <>
      {frequent.length > 0 && (
        <div
          role="group"
          aria-label={t('flow.proposal.frequent')}
          className="flex flex-wrap gap-1.5"
        >
          {frequent.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={t('flow.proposal.proposeNamed', { name: item.name })}
              onClick={() => {
                pick(item);
              }}
              className="flex h-[30px] cursor-pointer items-center gap-[7px] rounded-[15px] border border-border-control bg-surface px-[11px] text-[12.5px] leading-none font-medium whitespace-nowrap hover:border-primary hover:text-primary"
            >
              {t('quickAdd.chip', { name: item.name })}
              <span dir="ltr" className="font-mono text-[12px] font-medium text-ink-muted">
                {formatMoney(item.price, locale)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="max-w-[420px]">
        <input
          type="search"
          value={query}
          aria-label={searchLabel}
          placeholder={t('flow.proposal.search')}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="h-[34px] w-full rounded-[7px] border border-border-control bg-surface px-[11px] text-[12.5px] text-ink focus:border-primary"
        />
        {needle !== '' &&
          (results.length === 0 ? (
            <p className="m-0 mt-1.5 text-[12.5px] leading-[1.4] text-ink-muted">
              {t('flow.proposal.noMatch')}
            </p>
          ) : (
            <ul className="m-0 mt-1 list-none overflow-hidden rounded-lg border border-border p-0">
              {results.map((item) => (
                <li key={item.id} className="border-t border-row-divider first:border-t-0">
                  <button
                    type="button"
                    onClick={() => {
                      pick(item);
                    }}
                    className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 border-0 bg-surface px-[11px] text-start text-[12.5px] hover:bg-selected"
                  >
                    <span className="w-11 flex-none font-mono text-[11.5px] font-medium text-ink-muted">
                      {item.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span dir="ltr" className="font-mono font-medium tabular-nums">
                      {formatMoney(item.price, locale)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </>
  );
}
