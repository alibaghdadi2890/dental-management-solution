import type { FileOrientation, PatientFile } from '@dcm/contracts';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileText } from '../file-text';
import { addRotation, rotateClockwise } from '../rotation';
import { ImageStage } from './stage';
import { NO_FILTERS, type RelativeView } from './stage-types';
import { ViewerButton, ViewerIcon } from './viewer-button';

type Side = 'first' | 'second';

/**
 * Two images side by side (feature 8 §4, the gallery's Compare): the obvious use is before and
 * after, and it works for any two. Each has its own zoom, pan and rotation, with its filename
 * and date under it; **Sync zoom** — on to begin with — makes one follow the other, measured
 * against each image's own fitted size so two pictures of different sizes stay in step.
 */
export function CompareView({
  first,
  second,
  onClose,
}: {
  first: PatientFile;
  second: PatientFile;
  onClose: () => void;
}) {
  const { t } = useTranslation('files');
  const text = useFileText();
  const [sync, setSync] = useState(true);
  const [lead, setLead] = useState<{ side: Side; view: RelativeView } | null>(null);
  const [turned, setTurned] = useState<Record<Side, FileOrientation>>({ first: 0, second: 0 });

  const pane = (side: Side, file: PatientFile) =>
    file.viewUrl !== null && (
      <figure className="m-0 flex min-h-0 min-w-0 flex-1 flex-col">
        <ImageStage
          src={file.viewUrl}
          label={text.describe(file)}
          orientation={addRotation(file.orientation, turned[side])}
          filters={NO_FILTERS}
          onView={(view) => {
            if (sync) setLead({ side, view: view.relative });
          }}
          follow={sync && lead && lead.side !== side ? lead.view : null}
        />
        <figcaption className="flex flex-none items-center gap-2 border-t border-white/10 px-3 py-2 text-[12.5px] leading-[1.3]">
          <span dir="auto" className="min-w-0 flex-1 truncate font-medium">
            {file.originalFilename}
          </span>
          <span className="flex-none text-white/60">{text.dateTime(file.takenAt)}</span>
          <ViewerButton
            label={`${t('viewer.rotate')}${t('separator')}${t(side === 'first' ? 'viewer.left' : 'viewer.right')}`}
            onClick={() => {
              setTurned((current) => ({ ...current, [side]: rotateClockwise(current[side]) }));
            }}
          >
            <ViewerIcon name="rotate" />
          </ViewerButton>
        </figcaption>
      </figure>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label={t('viewer.compare')}
        className="flex flex-none items-center gap-3 border-b border-white/10 px-3 py-2"
      >
        <Dialog.Title className="m-0 flex-1 text-[13.5px] leading-[1.3] font-semibold">
          {t('viewer.compare')}
        </Dialog.Title>
        <ViewerButton
          label={t('viewer.syncZoom')}
          pressed={sync}
          onClick={() => {
            setSync((on) => !on);
            setLead(null);
          }}
          className="px-2.5"
        >
          {t('viewer.syncZoom')}
        </ViewerButton>
        <ViewerButton label={t('viewer.close')} shortcut="Esc" onClick={onClose}>
          <ViewerIcon name="close" />
        </ViewerButton>
      </div>
      <div className="flex min-h-0 flex-1 divide-x divide-white/10 rtl:divide-x-reverse">
        {pane('first', first)}
        {pane('second', second)}
      </div>
    </div>
  );
}
