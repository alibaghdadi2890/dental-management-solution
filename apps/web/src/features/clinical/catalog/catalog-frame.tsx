import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewTabs } from '@/components/ui/list';
import { CATALOG_VIEWS, type CatalogView } from './catalog-draft';

/** Header, tabs and frame shared by the loading and error states, the editor and the lists tab. */
export function CatalogFrame({
  tab,
  onTabChange,
  counts,
  action,
  children,
  footer,
}: {
  tab: CatalogView;
  onTabChange: (tab: CatalogView) => void;
  counts?: Partial<Record<CatalogView, number>> | undefined;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation('catalog');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-[26px] pt-6 pb-8">
          <div className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="mb-1 text-[21px] leading-tight font-semibold tracking-[-0.02em]">
                {t('title')}
              </h1>
              <p className="text-[13px] leading-snug text-ink-tertiary">{t('subtitle')}</p>
            </div>
            {action}
          </div>
          <ViewTabs
            label={t('tabs.label')}
            active={tab}
            onChange={onTabChange}
            tabs={CATALOG_VIEWS.map((key) => ({
              key,
              label: t(`tabs.${key}`),
              count: counts?.[key],
            }))}
          />
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}
