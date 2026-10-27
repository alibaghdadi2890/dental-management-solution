import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { CardSkeleton } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/list';
import { ApiError } from '@/lib/api';
import { myMonthsQuery, myStatementQuery } from './compensation-api';
import { MonthPicker } from './month-picker';
import { StatementView } from './statement-view';

function Statement({ month }: { month: string }) {
  const { t } = useTranslation('compensation');
  const statement = useQuery(myStatementQuery(month));
  if (statement.data) return <StatementView statement={statement.data} provisionalNote />;
  if (statement.isError) {
    return (
      <ErrorState
        title={t('statement.errorTitle')}
        body={t('statement.errorBody')}
        requestId={statement.error instanceof ApiError ? statement.error.requestId : undefined}
        error={statement.error}
        onRetry={() => void statement.refetch()}
      />
    );
  }
  return <CardSkeleton label={t('statement.loading')} />;
}

/**
 * My statement (prompt §3, `compensation:read`): the dentist's own months only — the picker
 * steps through the months the clinic lets them read — and the statement read-only, with the
 * Provisional note while the month is open. No clinic totals, no other dentist.
 */
export function MyStatementPage({
  month,
  onMonth,
}: {
  month: string | undefined;
  onMonth: (month: string) => void;
}) {
  const { t } = useTranslation('compensation');
  const months = useQuery(myMonthsQuery());
  const available = months.data ?? [];
  const shown = month !== undefined && available.includes(month) ? month : available[0];
  return (
    <Page
      title={t('mine.title')}
      subtitle={t('mine.subtitle')}
      actions={
        shown && (
          <MonthPicker
            month={shown}
            latest={available[0] ?? shown}
            months={available}
            onChange={onMonth}
          />
        )
      }
    >
      {months.isPending ? (
        <CardSkeleton label={t('statement.loading')} />
      ) : shown ? (
        <Statement month={shown} />
      ) : (
        <EmptyState title={t('mine.emptyTitle')} body={t('mine.emptyBody')} />
      )}
    </Page>
  );
}
