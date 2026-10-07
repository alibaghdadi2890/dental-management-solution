import { ADJUSTMENT_REASONS, type AdjustmentReason } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';

const isKnown = (reason: string): reason is AdjustmentReason =>
  ADJUSTMENT_REASONS.some((known) => known === reason);

/**
 * An adjustment's reason as the clinic reads it: the label of a listed reason, or the text as
 * it was typed on an entry older than the list (feature 7, H4). Empty when there is none.
 */
export function useAdjustmentReasonLabel(): (reason: string | null) => string {
  const { t } = useTranslation('billing');
  return (reason) => {
    if (reason === null) return '';
    return isKnown(reason) ? t(`adjust.reasons.${reason}`) : reason;
  };
}
