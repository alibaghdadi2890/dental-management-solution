import type { DiagnosisItem, DiagnosisRecord, ToothCode, Visit } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ToothImages } from '@/features/files/file-rows';
import { diagnosesQuery } from '../../catalog/catalog-api';
import { useChartSettings } from '../../chart/use-chart-settings';
import { type DrawerMode, useChartingActions } from '../charting-actions';
import { useToothSelection } from '../tooth-selection';
import { DiagnosisSection } from './diagnosis-section';

/** How many frequent diagnoses are offered as chips; the rest are in the drawer. */
const MAX_CHIPS = 8;

/**
 * The tooth panel's body in **findings mode** (feature 10, V5), under the same header as ever —
 * the glyph for the surfaces, the Presence control: the clinic's frequently used diagnoses as
 * chips, recorded in one click on the tooth and its pending surfaces, and a search that opens
 * the drawer; what is recorded on the tooth, each with its **Seen on**; the tooth's images; and
 * **Add a service to this tooth**, for the dentist who treats on the spot.
 */
export function FindingsBody({
  patientId,
  visit,
  code,
  diagnoses,
  canWrite,
  onOpenDrawer,
}: {
  patientId: string;
  visit: Visit;
  code: ToothCode;
  /** Everything recorded on the tooth. */
  diagnoses: readonly DiagnosisRecord[];
  canWrite: boolean;
  onOpenDrawer: (mode: DrawerMode) => void;
}) {
  const { t } = useTranslation('clinical');
  const actions = useChartingActions();
  const selection = useToothSelection();
  const { mode } = useChartSettings();
  const [listOpen, setListOpen] = useState(true);
  const catalog = useQuery({ ...diagnosesQuery(), enabled: canWrite });
  const frequent = (catalog.data ?? [])
    .filter((item) => item.active && item.frequent)
    .slice(0, MAX_CHIPS);

  const record = (item: DiagnosisItem) => {
    actions.recordDiagnosis(item, {
      tooth: code,
      surfaces: mode === 'surface' ? selection.surfaces : [],
    });
    // The pending scope was used (spec invariant 9).
    selection.select(code);
  };

  return (
    <div className="px-4 py-[15px]">
      {canWrite && (
        <div data-findings-add className="mb-4">
          {frequent.length > 0 && (
            <div
              role="group"
              aria-label={t('flow.findings.frequent')}
              className="mb-2.5 flex flex-wrap gap-1.5"
            >
              {frequent.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={t('flow.findings.recordNamed', { name: item.name })}
                  onClick={() => {
                    record(item);
                  }}
                  className="h-[28px] max-w-full cursor-pointer truncate rounded-[14px] border border-danger-border bg-danger-bg px-[11px] text-[12px] leading-none font-medium text-danger hover:border-danger"
                >
                  {t('quickAdd.chip', { name: item.name })}
                </button>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            onClick={() => {
              onOpenDrawer('diagnosis');
            }}
          >
            {t('flow.findings.search')}
          </Button>
        </div>
      )}
      <DiagnosisSection
        diagnoses={diagnoses}
        canWrite={canWrite}
        evidence
        open={listOpen}
        onToggle={() => {
          setListOpen((current) => !current);
        }}
        onAdd={() => {
          onOpenDrawer('diagnosis');
        }}
      />
      <ToothImages patientId={patientId} code={code} visit={visit} />
      {canWrite && (
        <Button
          variant="outline"
          size="sm"
          className="mt-[18px] w-full justify-center"
          onClick={() => {
            onOpenDrawer('service');
          }}
        >
          {t('flow.findings.addService')}
        </Button>
      )}
    </div>
  );
}
