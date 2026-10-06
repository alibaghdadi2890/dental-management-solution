import type { DiagnosisRecord } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { madeHere, useChartingActions } from '../charting-actions';
import { Badge, EmptyBlock, LinkButton, PanelSection } from './panel-section';
import { SurfaceTag } from './surface-tag';

/**
 * The Diagnosis stage (spec §Selected Tooth Panel → Body 1): per record a dot (danger while
 * active), the name (struck through once resolved) with a Resolved badge, the note, then the
 * date and dentist with **Resolve / Reopen** (in a visit only) and — only for a record added
 * where the charting happens, this visit or the patient record — **Remove** (others are
 * resolved, never deleted: W13, ADR-0031). Read-only without the scope's write permission.
 */
export function DiagnosisSection({
  diagnoses,
  canWrite,
  open,
  onToggle,
  onAdd,
}: {
  diagnoses: readonly DiagnosisRecord[];
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const active = diagnoses.filter((record) => record.status === 'active');
  const summary =
    diagnoses.length === 0
      ? t('panel.diagnosis.none')
      : active.length === 0
        ? t('panel.diagnosis.allResolved')
        : active.map((record) => record.name).join(t('title.listSeparator'));

  return (
    <PanelSection
      tone="diagnosis"
      label={t('panel.diagnosis.label')}
      summary={summary}
      open={open}
      onToggle={onToggle}
      add={
        canWrite
          ? { label: t('panel.add'), name: t('panel.diagnosis.add'), onClick: onAdd }
          : undefined
      }
    >
      {diagnoses.length === 0 ? (
        <EmptyBlock
          title={t('panel.diagnosis.emptyTitle')}
          action={canWrite ? { label: t('panel.diagnosis.addCta'), onClick: onAdd } : undefined}
        />
      ) : (
        diagnoses.map((record) => {
          const isActive = record.status === 'active';
          return (
            <div
              key={record.id}
              data-record={record.id}
              className={cn(
                'mb-[7px] rounded-lg border bg-surface px-3 py-2.5',
                isActive ? 'border-border' : 'border-inner-divider',
              )}
            >
              <div className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'size-[7px] flex-none translate-y-[-1px] rounded-full',
                    isActive ? 'bg-danger' : 'bg-border-strong',
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 text-[13px] leading-[1.35] font-semibold',
                    !isActive && 'text-ink-muted line-through',
                  )}
                >
                  {record.name}
                </span>
                <SurfaceTag surfaces={record.surfaces} className="text-danger" />
                {!isActive && <Badge tone="success">{t('panel.diagnosis.resolved')}</Badge>}
              </div>
              {record.note && (
                <div className="ms-[15px] mt-[5px] text-[12.5px] leading-normal text-ink-secondary">
                  {record.note}
                </div>
              )}
              <div className="ms-[15px] mt-[7px] flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-[12.5px] leading-[1.4] text-ink-muted">
                  {formatCalendarDate(record.recordedDate, locale)}
                </span>
                <span className="text-[12.5px] leading-[1.4] text-ink-muted">
                  {record.dentistName}
                </span>
                {canWrite && actions.scope.kind === 'visit' && (
                  <LinkButton
                    className="ms-auto"
                    label={t(isActive ? 'panel.diagnosis.resolve' : 'panel.diagnosis.reopen')}
                    name={t(
                      isActive ? 'panel.diagnosis.resolveNamed' : 'panel.diagnosis.reopenNamed',
                      {
                        name: record.name,
                      },
                    )}
                    onClick={() => {
                      if (isActive) actions.resolveDiagnosis(record.id);
                      else actions.reopenDiagnosis(record.id);
                    }}
                  />
                )}
                {canWrite &&
                  madeHere(actions.scope, record) &&
                  (actions.scope.kind === 'visit' || isActive) && (
                    <LinkButton
                      tone="danger"
                      label={t('panel.remove')}
                      name={t('panel.removeNamed', { name: record.name })}
                      onClick={() => {
                        actions.removeDiagnosis(record.id);
                      }}
                    />
                  )}
              </div>
            </div>
          );
        })
      )}
    </PanelSection>
  );
}
