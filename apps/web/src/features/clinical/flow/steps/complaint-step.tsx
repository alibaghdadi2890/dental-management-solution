import {
  PAIN_SCORE_MAX,
  PAIN_SINCE,
  type PainSince,
  type Visit,
  type VisitComplaintInput,
} from '@dcm/contracts';
import { MutationObserver, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSaveGroup } from '../../use-save-group';
import { useVisitMutations } from '../../visit-mutations';
import { FIELD_LABEL, STEP_BODY } from '../flow-styles';
import { ReasonField } from '../reason-field';
import { LastVisitCard } from '../step-cards';

/** The save group key of an emergency's pain score and "since". */
const COMPLAINT_KEY = 'complaint';

/** The keys that leave a slider resting at its minimum where it is. */
const ZERO_KEYS: ReadonlySet<string> = new Set(['Home', 'ArrowLeft', 'ArrowDown', 'PageDown']);

/** How a pain score reads: mild in green, moderate in amber, severe in red. */
function painTone(score: number | null): string {
  if (score === null) return 'text-ink-muted';
  return score >= 7 ? 'text-danger' : score >= 4 ? 'text-warning' : 'text-success';
}

/**
 * **Complaint** (feature 10, V4), the first step of an emergency: what the patient reports, how
 * much it hurts — 0 to 10, "Not rated" until the slider is moved — and since when. Right, the
 * last visit. Pain and "since" are one autosaved group; the reason is the visit's own
 * (`ReasonField`).
 */
export function ComplaintStep({ visit, canWrite }: { visit: Visit; canWrite: boolean }) {
  return (
    <div data-step="complaint" className={STEP_BODY}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-surface px-5 py-[18px]">
          <ReasonField visit={visit} canWrite={canWrite} multiline />
          {canWrite ? (
            <PainEditor visit={visit} />
          ) : (
            <PainFields
              value={{ painScore: visit.painScore, painSince: visit.painSince }}
              onChange={undefined}
            />
          )}
        </section>
        <LastVisitCard patientId={visit.patientId} />
      </div>
    </div>
  );
}

function PainEditor({ visit }: { visit: Visit }) {
  const queryClient = useQueryClient();
  const { setComplaint } = useVisitMutations(visit.id);
  const complaint = useSaveGroup<VisitComplaintInput>({
    key: COMPLAINT_KEY,
    serverValue: { painScore: visit.painScore, painSince: visit.painSince },
    save: (input) => new MutationObserver(queryClient, setComplaint).mutate(input),
  });
  return <PainFields value={complaint.value} onChange={complaint.setValue} />;
}

function PainFields({
  value,
  onChange,
}: {
  value: VisitComplaintInput;
  /** Left out when the visit is read-only. */
  onChange: ((next: VisitComplaintInput) => void) | undefined;
}) {
  const { t } = useTranslation('clinical');
  const painId = useId();
  const sinceId = useId();
  const { painScore, painSince } = value;
  const readOnly = onChange === undefined;
  const pickSince = (since: PainSince) => {
    onChange?.({ ...value, painSince: painSince === since ? null : since });
  };
  return (
    <>
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <label htmlFor={painId} className="text-[12.5px] leading-none font-medium">
            {t('flow.pain.label')}
          </label>
          <span className="flex items-baseline gap-2.5">
            {painScore !== null && !readOnly && (
              <button
                type="button"
                onClick={() => {
                  onChange({ ...value, painScore: null });
                }}
                className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-medium text-primary hover:underline"
              >
                {t('flow.pain.clear')}
              </button>
            )}
            <output
              htmlFor={painId}
              className={cn('font-mono text-[15px] leading-none font-bold', painTone(painScore))}
            >
              {painScore === null
                ? t('flow.pain.notRated')
                : t('flow.pain.score', { score: painScore, max: PAIN_SCORE_MAX })}
            </output>
          </span>
        </div>
        <input
          id={painId}
          type="range"
          min={0}
          max={PAIN_SCORE_MAX}
          step={1}
          disabled={readOnly}
          value={painScore ?? 0}
          aria-valuetext={
            painScore === null
              ? t('flow.pain.notRated')
              : t('flow.pain.score', { score: painScore, max: PAIN_SCORE_MAX })
          }
          onChange={(event) => {
            onChange?.({ ...value, painScore: Number(event.target.value) });
          }}
          // An unrated slider rests at 0, where a click or a key that means "0" changes nothing
          // the browser reports: rate it 0 anyway.
          onPointerUp={() => {
            if (painScore === null) onChange?.({ ...value, painScore: 0 });
          }}
          onKeyDown={(event) => {
            if (painScore === null && ZERO_KEYS.has(event.key)) {
              onChange?.({ ...value, painScore: 0 });
            }
          }}
          className="m-0 block w-full accent-danger"
        />
        <div
          aria-hidden
          className="mt-1.5 flex justify-between font-mono text-[11.5px] leading-none text-ink-muted"
        >
          <span>0</span>
          <span>5</span>
          <span>10</span>
        </div>
      </div>
      <div role="group" aria-labelledby={sinceId}>
        <span id={sinceId} className={FIELD_LABEL}>
          {t('flow.since.label')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PAIN_SINCE.map((since) => {
            const on = painSince === since;
            return (
              <button
                key={since}
                type="button"
                aria-pressed={on}
                disabled={readOnly}
                onClick={() => {
                  pickSince(since);
                }}
                className={cn(
                  'h-8 cursor-pointer rounded-2xl border px-[13px] text-[12.5px] leading-none font-medium disabled:cursor-default',
                  on
                    ? 'border-ink bg-ink text-white'
                    : 'border-border-control bg-surface text-ink hover:border-ink-muted',
                )}
              >
                {t(`flow.since.${since}`)}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
