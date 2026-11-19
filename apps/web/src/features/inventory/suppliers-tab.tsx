import type { Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, Pill, SkeletonRows, TableCard, TableHead } from '@/components/ui/list';
import { Switch } from '@/components/ui/switch';
import { usePermission } from '@/features/auth/use-permission';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { accountsQuery, suppliersQuery } from './inventory-api';
import { useInventoryWords } from './inventory-words';
import { SupplierFormPanel } from './supplier-panels';

type Tenant = NonNullable<Session['tenant']>;
const FIGURE = 'text-end font-mono tabular-nums';

/**
 * Suppliers (Part D): the directory for everyone who sees stock; with inventory money, each
 * supplier's outstanding and the clinic's total. A supplier opens on its own page.
 */
export function SuppliersTab({ tenant }: { tenant: Tenant }) {
  const { t, locale } = useInventoryWords();
  const navigate = useNavigate();
  const canMoney = usePermission('inventory:money_read');
  const canManage = usePermission('inventory:manage');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const suppliers = useQuery(suppliersQuery(showInactive));
  const accounts = useQuery(accountsQuery(canMoney));
  const byId = new Map(
    (accounts.data?.suppliers ?? []).map((row) => [row.supplierId, row] as const),
  );
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const columns = canMoney
    ? 'minmax(180px,1.4fr) minmax(180px,1.2fr) 140px 110px 100px'
    : 'minmax(180px,1.4fr) minmax(180px,1.2fr) 100px';
  const rows = suppliers.data ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <Switch
            checked={showInactive}
            onCheckedChange={setShowInactive}
            label={t('filters.inactive')}
          />
          {t('filters.inactive')}
        </label>
        {canManage && (
          <Button
            variant="primary"
            className="ms-auto"
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('suppliers.add')}
          </Button>
        )}
      </div>
      <TableCard
        minWidth={canMoney ? 760 : 520}
        footer={
          canMoney && accounts.data && rows.length > 0 ? (
            <div
              className="grid items-center gap-2.5 border-t border-border bg-faint px-3 py-2.5 text-[13px] font-medium"
              style={{ gridTemplateColumns: columns }}
            >
              <span>{t('suppliers.total')}</span>
              <span />
              <span dir="ltr" className={FIGURE}>
                {money(accounts.data.total.outstanding)}
              </span>
              <span className={FIGURE}>{accounts.data.total.toPrice || ''}</span>
              <span />
            </div>
          ) : undefined
        }
      >
        <div role="table" aria-label={t('tabs.suppliers')}>
          <TableHead
            columns={columns}
            labels={[
              t('suppliers.columns.name'),
              t('suppliers.columns.contact'),
              ...(canMoney
                ? [
                    <span key="o" className="block text-end">
                      {t('suppliers.columns.outstanding')}
                    </span>,
                    <span key="p" className="block text-end">
                      {t('receipt.toPrice')}
                    </span>,
                  ]
                : []),
              '',
            ]}
          />
          {suppliers.isPending ? (
            <SkeletonRows columns={columns} label={t('loading')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('suppliers.empty')} body="" />
          ) : (
            rows.map((supplier) => {
              const account = byId.get(supplier.id);
              return (
                <div
                  key={supplier.id}
                  role="row"
                  className={cn(
                    'grid min-h-12 cursor-pointer items-center gap-2.5 border-t border-row-divider px-3 text-[13px] hover:bg-faint',
                    !supplier.active && 'text-ink-muted',
                  )}
                  style={{ gridTemplateColumns: columns }}
                  onClick={() => {
                    void navigate({
                      to: '/inventory/suppliers/$supplierId',
                      params: { supplierId: supplier.id },
                    });
                  }}
                >
                  <span role="cell" className="truncate font-medium">
                    {supplier.name}
                  </span>
                  <span role="cell" className="truncate">
                    {[supplier.contactPerson, supplier.phone].filter(Boolean).join(' · ') || '—'}
                  </span>
                  {canMoney && (
                    <>
                      <span
                        role="cell"
                        dir="ltr"
                        className={cn(
                          FIGURE,
                          account?.outstanding.startsWith('-') && 'text-success',
                        )}
                      >
                        {account ? money(account.outstanding) : '—'}
                      </span>
                      <span role="cell" className={FIGURE}>
                        {account?.toPrice || ''}
                      </span>
                    </>
                  )}
                  <span role="cell">
                    {!supplier.active && <Pill tone="neutral">{t('suppliers.inactive')}</Pill>}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </TableCard>
      {adding && (
        <SupplierFormPanel
          onClose={() => {
            setAdding(false);
          }}
          onSaved={(supplier) => {
            void navigate({
              to: '/inventory/suppliers/$supplierId',
              params: { supplierId: supplier.id },
            });
          }}
        />
      )}
    </>
  );
}
