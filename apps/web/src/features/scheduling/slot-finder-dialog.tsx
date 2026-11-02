import { Dialog } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { SlotFinder, type SlotRequestContext } from './slot-finder';

/** The finder on its own, over the Today board or the record. */
export function SlotFinderDialog({
  context,
  onClose,
}: {
  context: SlotRequestContext;
  onClose: () => void;
}) {
  const { t } = useTranslation('scheduling');
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.34)]" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 flex max-h-[calc(100%-48px)] w-[calc(100%-48px)] max-w-[600px] -translate-x-1/2 -translate-y-1/2 animate-popin flex-col overflow-auto rounded-xl bg-surface p-[22px] shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2">
          <Dialog.Title className="m-0 mb-3 text-[16.5px] leading-[1.2] font-semibold">
            {context.rescheduleId ? t('finder.moveTitle') : t('finder.title')}
          </Dialog.Title>
          <Dialog.Description className="sr-only">{context.patientName}</Dialog.Description>
          <SlotFinder
            context={context}
            cancelLabel={t('confirm.cancel')}
            onCancel={onClose}
            onBooked={onClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
