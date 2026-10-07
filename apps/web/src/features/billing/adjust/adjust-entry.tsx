import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useAdjustBalance } from './adjust-balance-context';

/**
 * The balance card's secondary action (feature 7, H4): **Adjust balance** for a caller who may
 * (`payment:refund`), the "Ask a dentist to adjust" note for one who only reads payments, nothing
 * otherwise.
 */
export function AdjustBalanceButton({
  patientId,
  className,
}: {
  patientId: string;
  className?: string;
}) {
  const { t } = useTranslation('billing');
  const adjust = useAdjustBalance();
  if (!adjust) return null;
  const { open } = adjust;
  if (!open) {
    return (
      <p className="m-0 mt-2.5 text-center text-[11.5px] leading-tight text-ink-muted">
        {t('adjust.askDentist')}
      </p>
    );
  }
  return (
    <Button
      variant="secondary"
      size="lg"
      className={className}
      onClick={() => {
        open(patientId);
      }}
    >
      {t('adjust.title')}
    </Button>
  );
}

/**
 * The ⋯ menu that holds Adjust balance where there is no room for a button: the Overview's
 * balance card and a Payments › Outstanding row. Without `payment:refund` the item is there,
 * disabled, and says who to ask.
 */
export function AdjustBalanceMenu({ patientId, label }: { patientId: string; label: string }) {
  const { t } = useTranslation('billing');
  const adjust = useAdjustBalance();
  if (!adjust) return null;
  const { open } = adjust;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton aria-label={label}>
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        </IconButton>
      </MenuTrigger>
      <MenuContent className={open ? undefined : 'w-[220px]'}>
        <MenuItem
          disabled={!open}
          onSelect={() => {
            open?.(patientId);
          }}
        >
          {open ? t('adjust.title') : t('adjust.askDentist')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
