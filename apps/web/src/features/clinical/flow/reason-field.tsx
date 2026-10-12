import type { Visit } from '@dcm/contracts';
import { MutationObserver, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveState } from '@/components/ui/save-state';
import { cn } from '@/lib/utils';
import { useSaveGroup } from '../use-save-group';
import { useVisitMutations } from '../visit-mutations';
import { FIELD_LABEL } from './flow-styles';

const REASON_MAX = 500;

/** The save group key of the visit's reason: Intake's line and Complaint's textarea share it. */
const REASON_KEY = 'reason';

const sameText = (a: string, b: string) => a.trim() === b.trim();

/**
 * The visit's **reason** — the chief complaint (feature 10, V3, V4) — as one autosaved group,
 * like the notes: a line in Intake, a textarea in an emergency's Complaint. Read-only without
 * `visit:write`: the reason as text.
 */
export function ReasonField({
  visit,
  canWrite,
  multiline = false,
}: {
  visit: Visit;
  canWrite: boolean;
  multiline?: boolean;
}) {
  const { t } = useTranslation('clinical');
  const id = useId();
  const label = t(multiline ? 'flow.complaint.label' : 'flow.reason.label');
  if (!canWrite) {
    return (
      <div>
        <span className={FIELD_LABEL}>{label}</span>
        <p className="m-0 text-[13px] leading-[1.5] whitespace-pre-line text-ink-secondary">
          {visit.reason ?? t('flow.reason.none')}
        </p>
      </div>
    );
  }
  return <ReasonEditor visit={visit} id={id} label={label} multiline={multiline} />;
}

function ReasonEditor({
  visit,
  id,
  label,
  multiline,
}: {
  visit: Visit;
  id: string;
  label: string;
  multiline: boolean;
}) {
  const { t } = useTranslation('clinical');
  const queryClient = useQueryClient();
  const { setReason } = useVisitMutations(visit.id);
  const reason = useSaveGroup({
    key: REASON_KEY,
    serverValue: visit.reason ?? '',
    // Outlives the field, like every save group's save.
    save: (text) => new MutationObserver(queryClient, setReason).mutate(text),
    sameValue: sameText,
  });
  const control =
    'block w-full rounded-[7px] border border-border-control bg-surface text-[13px] text-ink focus:border-primary';
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2.5">
        <label htmlFor={id} className="text-[12.5px] leading-none font-medium">
          {label}
        </label>
        <span className="ms-auto">
          <SaveState status={reason.state} onRetry={reason.retry} />
        </span>
      </div>
      {multiline ? (
        <textarea
          id={id}
          maxLength={REASON_MAX}
          value={reason.value}
          placeholder={t('flow.complaint.placeholder')}
          onChange={(event) => {
            reason.setValue(event.target.value);
          }}
          className={cn(control, 'min-h-[84px] resize-y px-3 py-2.5 leading-[1.55]')}
        />
      ) : (
        <input
          id={id}
          type="text"
          maxLength={REASON_MAX}
          value={reason.value}
          placeholder={t('flow.reason.placeholder')}
          onChange={(event) => {
            reason.setValue(event.target.value);
          }}
          className={cn(control, 'h-[38px] px-[11px]')}
        />
      )}
    </div>
  );
}
