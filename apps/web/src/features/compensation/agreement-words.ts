import type { Agreement, AgreementComponent, VisitType } from '@dcm/contracts';
import type { TFunction } from 'i18next';
import { formatMoney } from '@/lib/format';

/** A percent as written in an agreement: `40`, `30.5` (no trailing zeros). */
export function percentText(percent: string): string {
  return String(Number(percent));
}

/**
 * One component in the clinic's words (prompt §1): "40 % of collected amounts · Implants 30 %",
 * "USD 1,500 / month, pro-rated", "USD 15 per visit · Consultation USD 0".
 */
export function componentWords(
  component: AgreementComponent,
  context: { t: TFunction<'compensation'>; currency: string; locale: string },
): string {
  const { t, currency, locale } = context;
  const money = (amount: string) => formatMoney({ amount, currency }, locale);
  switch (component.kind) {
    case 'share': {
      const parts = [
        t(`words.share.${component.basis}`, { percent: percentText(component.percent) }),
        ...component.rateOverrides.map((override) =>
          t('words.override', { name: override.key, percent: percentText(override.percent) }),
        ),
      ];
      if (component.threshold !== null) {
        parts.push(t('words.threshold', { amount: money(component.threshold) }));
      }
      return parts.join(' · ');
    }
    case 'monthlyFixed': {
      const negative = component.amount.startsWith('-');
      const amount = money(negative ? component.amount.slice(1) : component.amount);
      const words = t(negative ? 'words.rent' : 'words.fixed', { amount });
      return component.prorate ? `${words}${t('words.prorated')}` : words;
    }
    case 'perVisit': {
      const byType = (Object.entries(component.byType) as [VisitType, string][]).map(
        ([type, amount]) =>
          t('words.byType', { type: t(`visitTypes.${type}`), amount: money(amount) }),
      );
      const base = t('words.perVisit', { amount: money(component.amount) });
      const charged = component.chargedOnly ? [t('words.chargedOnly')] : [];
      return [base, ...byType, ...charged].join(' · ');
    }
    case 'perDay':
      return t('words.perDay', { amount: money(component.amount) });
  }
}

/** Every component of an agreement, one line each. */
export function agreementWords(
  agreement: Pick<Agreement, 'components'>,
  context: { t: TFunction<'compensation'>; currency: string; locale: string },
): string[] {
  return agreement.components.map((component) => componentWords(component, context));
}
