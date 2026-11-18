import type { Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { EmptyState, Pill, SkeletonRows, TableCard, TableHead } from '@/components/ui/list';
import { Switch } from '@/components/ui/switch';
import { usePermission } from '@/features/auth/use-permission';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LabFormPanel } from './lab-form-panel';
import { labAccountsQuery, labsQuery } from './labs-api';

type Tenant = NonNullable<Session['tenant']>;

const FIGURE = 'text-end font-mono tabular-nums';

/**
 * The labs the clinic works with (Part A), and for whoever sees lab money each lab's outstanding
 * and in-progress amounts and the clinic's total (Part D). A lab opens its own page; *Add lab*
 * is a short form, after which the new lab's page opens for its services and account.
 */
export function LabsTab({ tenant }: { tenant: Tenant }) {
  const navigate = useNavigate();
  const onOpen = (labId: string) => {
    void navigate({ to: '/labs/$labId', params: { labId } });
  };
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  const canMoney = usePermission('lab:money_read');
  const canManage = usePermission('lab:money_manage');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const labs = useQuery(labsQuery(showInactive));
  const accounts = useQuery(labAccountsQuery(canMoney));
  const byLab = new Map((accounts.data?.labs ?? []).map((row) => [row.labId, row] as const));
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const columns = canMoney
    ? 'minmax(160px,1.4fr) minmax(160px,1.2fr) 110px 130px 160px 114px'
    : 'minmax(160px,1.4fr) minmax(160px,1.2fr) 110px 90px';
  const rows = labs.data ?? [];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <Switch
            checked={showInactive}
            onCheckedChange={setShowInactive}
            label={t('labsTab.showInactive')}
          />
          {t('labsTab.showInactive')}
        </label>
        {canManage && (
          <Button
            variant="primary"
            className="ms-auto"
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('labsTab.add')}
          </Button>
        )}
      </div>
      <TableCard
        minWidth={canMoney ? 924 : 664}
        footer={
          canMoney && accounts.data && rows.length > 0 ? (
            <div
              className="grid items-center gap-2.5 border-t border-border bg-faint px-3 py-2.5 text-[13px] font-medium"
              style={{ gridTemplateColumns: columns }}
            >
              <span>{t('labsTab.total')}</span>
              <span />
              <span />
              <span dir="ltr" className={FIGURE}>
                {money(accounts.data.total.outstanding)}
              </span>
              <span dir="ltr" className={FIGURE}>
                {t('labsTab.inProgressCount', {
                  count: accounts.data.total.inProgressCount,
                  amount: money(accounts.data.total.inProgressAmount),
                })}
              </span>
              <span />
            </div>
          ) : undefined
        }
      >
        <div role="table" aria-label={t('tabs.labs')}>
          <TableHead
            columns={columns}
            labels={[
              t('labsTab.columns.name'),
              t('labsTab.columns.contact'),
              t('labsTab.columns.turnaround'),
              ...(canMoney
                ? [
                    <span key="o" className="block text-end">
                      {t('labsTab.columns.outstanding')}
                    </span>,
                    <span key="p" className="block text-end">
                      {t('labsTab.columns.inProgress')}
                    </span>,
                  ]
                : []),
              // Clear of the right-aligned figures before it.
              <span key="s" className="block ps-6">
                {t('labsTab.columns.status')}
              </span>,
            ]}
          />
          {labs.isPending ? (
            <SkeletonRows columns={columns} label={t('loading')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('labsTab.empty.title')} body={t('labsTab.empty.body')} />
          ) : (
            rows.map((lab) => {
              const account = byLab.get(lab.id);
              return (
                <div
                  key={lab.id}
                  role="row"
                  className={cn(
                    'grid min-h-12 cursor-pointer items-center gap-2.5 border-t border-row-divider px-3 text-[13px] hover:bg-faint',
                    !lab.active && 'text-ink-muted',
                  )}
                  style={{ gridTemplateColumns: columns }}
                  onClick={() => {
                    onOpen(lab.id);
                  }}
                >
                  <span role="cell" className="truncate font-medium">
                    {lab.name}
                  </span>
                  <span role="cell" className="truncate">
                    {[lab.contactPerson, lab.phone].filter(Boolean).join(' · ') || '—'}
                  </span>
                  <span role="cell">{t('labsTab.days', { count: lab.turnaroundDays })}</span>
                  {canMoney && (
                    <>
                      <span
                        role="cell"
                        dir="ltr"
                        className={cn(
                          FIGURE,
                          account && account.outstanding.startsWith('-') && 'text-success',
                        )}
                      >
                        {account ? money(account.outstanding) : '—'}
                      </span>
                      <span role="cell" dir="ltr" className={cn(FIGURE, 'text-ink-secondary')}>
                        {account && account.inProgressCount > 0
                          ? t('labsTab.inProgressCount', {
                              count: account.inProgressCount,
                              amount: money(account.inProgressAmount),
                            })
                          : '—'}
                      </span>
                    </>
                  )}
                  <span role="cell" className="ps-6">
                    <Pill tone={lab.active ? 'success' : 'neutral'}>
                      {lab.active ? t('labsTab.active') : t('labsTab.inactive')}
                    </Pill>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </TableCard>
      {adding && (
        <LabFormPanel
          onClose={() => {
            setAdding(false);
          }}
          onSaved={(lab) => {
            // A new lab has no price list yet: that is what comes next.
            void navigate({
              to: '/labs/$labId',
              params: { labId: lab.id },
              search: { tab: 'services' },
            });
          }}
        />
      )}
    </>
  );
}
