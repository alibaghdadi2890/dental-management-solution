import type { Patient, PatientChart, Visit } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { STEP_BODY } from '../flow-styles';
import { HistoryCard } from '../history-card';
import { ReasonField } from '../reason-field';
import { LastVisitCard, OpenTreatmentCard } from '../step-cards';

/**
 * **Intake** (feature 10, V3), the first step of an examination and a consultation: what the
 * dentist checks before looking in the mouth. Left, the medical history — corrected and
 * confirmed with the patient — and the reason for the visit; right, the last visit and the
 * treatment still open.
 */
export function IntakeStep({
  visit,
  patient,
  chart,
  canWrite,
}: {
  visit: Visit;
  patient: Patient | undefined;
  chart: PatientChart | undefined;
  canWrite: boolean;
}) {
  const { t } = useTranslation('clinical');
  return (
    <div data-step="intake" className={STEP_BODY}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {patient ? (
            <HistoryCard visit={visit} patient={patient} canWrite={canWrite} />
          ) : (
            <section className="rounded-xl border border-border bg-surface px-5 py-[18px]">
              <CardSkeleton label={t('workspace.loading')} />
            </section>
          )}
          <section className="rounded-xl border border-border bg-surface px-5 py-4">
            <ReasonField visit={visit} canWrite={canWrite} />
          </section>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <LastVisitCard patientId={visit.patientId} />
          <OpenTreatmentCard chart={chart} visitId={visit.id} />
        </div>
      </div>
    </div>
  );
}
