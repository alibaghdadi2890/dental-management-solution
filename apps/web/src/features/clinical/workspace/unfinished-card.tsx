import type { PatientChart } from '@dcm/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { unfinishedWork } from './unfinished';
import { UnfinishedRow } from './unfinished-row';

/**
 * The patient's unfinished services on the patient record's Chart tab (unfinished spec U8): what
 * a visit will be asked to continue. Nothing is worked on outside a visit, so each row offers
 * only **Cancel**. Nothing is shown without any.
 */
export function UnfinishedCard({ chart, canWrite }: { chart: PatientChart; canWrite: boolean }) {
  const { t } = useTranslation('clinical');
  const titleId = useId();
  const { toContinue } = unfinishedWork(chart.plans, null);
  if (toContinue.length === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 overflow-hidden rounded-xl border border-warning-border bg-surface"
    >
      <h2
        id={titleId}
        className="m-0 border-b border-warning-border bg-warning-bg px-4 py-3.5 text-[14px] leading-none font-semibold text-warning"
      >
        {t('unfinished.recordTitle')}
      </h2>
      <ul className="m-0 list-none p-0">
        {toContinue.map((plan) => (
          <li key={plan.id} className="border-b border-warning-border last:border-b-0">
            <UnfinishedRow plan={plan} canWrite={canWrite} target className="px-4 py-3" />
          </li>
        ))}
      </ul>
    </section>
  );
}
