import type { Patient, ToothCode } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { usePermission } from '@/features/auth/use-permission';
import { ChartLegend } from '../chart/chart-legend';
import { DentalChart } from '../chart/dental-chart';
import { ToothHistoryDialog } from '../dialogs/tooth-history-dialog';
import { chartQuery } from '../visits-api';
import { ChartCardFrame } from '../workspace/chart-card';
import { DentitionSelect } from '../workspace/dentition-select';

/**
 * The record's Dental chart tab (4b, L5, D17): the full chart at 12px cells, read-only — charting
 * happens in a visit — with the legend (no "Treated today") and the dentition selector from 4a.
 * Clicking a tooth opens its history, which offers to chart it in the live visit or start one.
 */
export function ChartTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation('visits');
  const canWrite = usePermission('visit:write');
  const chart = useQuery(chartQuery(patient.id));
  const teeth = useMemo(
    () => new Map((chart.data?.teeth ?? []).map((tooth) => [tooth.code, tooth])),
    [chart.data],
  );
  const [historyTooth, setHistoryTooth] = useState<ToothCode | null>(null);

  if (!chart.data) {
    return chart.isError ? (
      <p role="alert" className="text-[12.5px] text-ink-muted">
        {t('chartTab.failed')}
      </p>
    ) : (
      <CardSkeleton label={t('chartTab.loading')} />
    );
  }
  return (
    <>
      <ChartCardFrame
        subtitle={
          <div className="mt-2.5">
            <DentitionSelect
              patient={patient}
              dentition={chart.data.dentition}
              canWrite={canWrite}
            />
          </div>
        }
        aside={<ChartLegend dentition={chart.data.dentition.stage} showToday={false} />}
      >
        <DentalChart
          teeth={teeth}
          dentition={chart.data.dentition.stage}
          toothStatus={chart.data.toothStatus}
          size={12}
          selected={historyTooth}
          onToothClick={setHistoryTooth}
        />
      </ChartCardFrame>
      <ToothHistoryDialog
        patientId={patient.id}
        patientName={patient.fullName}
        code={historyTooth}
        onCodeChange={setHistoryTooth}
        canStart={patient.archivedAt === null}
      />
    </>
  );
}
