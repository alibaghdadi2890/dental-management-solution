import {
  type Agreement,
  type AgreementComponent,
  type AgreementPreset,
  COMPONENT_KINDS,
  type ComponentKind,
  createAgreementSchema,
  type CreateAgreementRequest,
  PRESET_COMPONENTS,
  type RateOverride,
  type ShareBasis,
  VISIT_TYPES,
  type VisitType,
} from '@dcm/contracts';
import { parseAmount } from '@/lib/amount';

/**
 * The agreement form's state (prompt §1): a preset only pre-fills it; each component has an
 * on/off switch (Custom shows all four) and text fields, read into the API's component set on
 * save. Pure, so the rules are tested without rendering.
 */
export interface AgreementDraft {
  preset: AgreementPreset;
  effectiveFrom: string;
  visible: boolean;
  note: string;
  on: Record<ComponentKind, boolean>;
  fixed: { amount: string; direction: 'pay' | 'charge'; prorate: boolean };
  share: {
    percent: string;
    basis: ShareBasis;
    overrides: RateOverride[];
    threshold: string;
  };
  perVisit: { amount: string; byType: Partial<Record<VisitType, string>>; chargedOnly: boolean };
  perDay: { amount: string };
}

/** The field a problem is shown on. */
export type DraftField =
  | 'components'
  | 'fixed.amount'
  | 'share.percent'
  | 'share.overrides'
  | 'share.threshold'
  | 'perVisit.amount'
  | 'perDay.amount';

export type DraftProblem = 'required' | 'amount' | 'percent' | 'none';

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

/** A typed amount or percent as a plain decimal (`12,50` in French → `12.50`); null when it is
 * not one, '' when blank. */
function read(text: string, locale: string): string | null {
  const value = parseAmount(text, locale);
  if (value === null || value === '') return value;
  return AMOUNT.test(value) ? value : null;
}

const validPercent = (text: string, locale: string) => {
  const value = read(text, locale);
  return value !== null && value !== '' && Number(value) <= 100;
};

/** A fresh draft for `preset` (C4 defaults: collected share, pro-rated, every visit counts). */
export function presetDraft(preset: AgreementPreset, effectiveFrom: string): AgreementDraft {
  const kinds = PRESET_COMPONENTS[preset];
  return {
    preset,
    effectiveFrom,
    visible: true,
    note: '',
    on: Object.fromEntries(COMPONENT_KINDS.map((kind) => [kind, kinds.includes(kind)])) as Record<
      ComponentKind,
      boolean
    >,
    fixed: { amount: '', direction: preset === 'chairRent' ? 'charge' : 'pay', prorate: true },
    share: {
      percent: preset === 'chairRent' ? '100' : '',
      basis: 'collection',
      overrides: [],
      threshold: '',
    },
    perVisit: { amount: '', byType: {}, chargedOnly: false },
    perDay: { amount: '' },
  };
}

/** The draft of an existing agreement, to change its terms from `effectiveFrom`. */
export function draftOf(agreement: Agreement, effectiveFrom: string): AgreementDraft {
  const draft = presetDraft(agreement.preset, effectiveFrom);
  draft.visible = agreement.statementVisibleToDentist;
  draft.note = agreement.note ?? '';
  draft.on = { monthlyFixed: false, share: false, perVisit: false, perDay: false };
  for (const component of agreement.components) {
    draft.on[component.kind] = true;
    if (component.kind === 'monthlyFixed') {
      const charge = component.amount.startsWith('-');
      draft.fixed = {
        amount: charge ? component.amount.slice(1) : component.amount,
        direction: charge ? 'charge' : 'pay',
        prorate: component.prorate,
      };
    } else if (component.kind === 'share') {
      draft.share = {
        percent: component.percent,
        basis: component.basis,
        overrides: component.rateOverrides,
        threshold: component.threshold ?? '',
      };
    } else if (component.kind === 'perVisit') {
      draft.perVisit = {
        amount: component.amount,
        byType: component.byType,
        chargedOnly: component.chargedOnly,
      };
    } else {
      draft.perDay = { amount: component.amount };
    }
  }
  return draft;
}

/** The first problem of each field, empty when the draft can be saved. */
export function draftProblems(
  draft: AgreementDraft,
  locale: string,
): Partial<Record<DraftField, DraftProblem>> {
  const problems: Partial<Record<DraftField, DraftProblem>> = {};
  const amount = (field: DraftField, text: string, required = true) => {
    const value = read(text, locale);
    if (value === '') {
      if (required) problems[field] = 'required';
    } else if (value === null) problems[field] = 'amount';
  };
  if (!COMPONENT_KINDS.some((kind) => draft.on[kind])) problems.components = 'none';
  if (draft.on.monthlyFixed) {
    amount('fixed.amount', draft.fixed.amount);
    if (!problems['fixed.amount'] && Number(read(draft.fixed.amount, locale)) === 0) {
      problems['fixed.amount'] = 'amount';
    }
  }
  if (draft.on.share) {
    if (draft.share.percent.trim() === '') problems['share.percent'] = 'required';
    else if (!validPercent(draft.share.percent, locale)) problems['share.percent'] = 'percent';
    if (
      draft.share.overrides.some(
        (override) => override.key.trim() === '' || !validPercent(override.percent, locale),
      )
    ) {
      problems['share.overrides'] = 'percent';
    }
    amount('share.threshold', draft.share.threshold, false);
  }
  if (draft.on.perVisit) {
    amount('perVisit.amount', draft.perVisit.amount);
    if (Object.values(draft.perVisit.byType).some((text) => read(text, locale) === null)) {
      problems['perVisit.amount'] = 'amount';
    }
  }
  if (draft.on.perDay) {
    amount('perDay.amount', draft.perDay.amount);
    if (!problems['perDay.amount'] && Number(read(draft.perDay.amount, locale)) === 0) {
      problems['perDay.amount'] = 'amount';
    }
  }
  return problems;
}

/** The component set of a valid draft, in the catalog's order. */
export function draftComponents(draft: AgreementDraft, locale: string): AgreementComponent[] {
  const plain = (text: string) => read(text, locale) ?? '';
  const components: AgreementComponent[] = [];
  if (draft.on.monthlyFixed) {
    const amount = plain(draft.fixed.amount);
    components.push({
      kind: 'monthlyFixed',
      amount: draft.fixed.direction === 'charge' ? `-${amount}` : amount,
      prorate: draft.fixed.prorate,
    });
  }
  if (draft.on.share) {
    components.push({
      kind: 'share',
      percent: plain(draft.share.percent),
      basis: draft.share.basis,
      rateOverrides: draft.share.overrides.map((override) => ({
        ...override,
        key: override.key.trim(),
        percent: plain(override.percent),
      })),
      threshold: plain(draft.share.threshold) === '' ? null : plain(draft.share.threshold),
    });
  }
  if (draft.on.perVisit) {
    const byType: Partial<Record<VisitType, string>> = {};
    for (const type of VISIT_TYPES) {
      const text = plain(draft.perVisit.byType[type] ?? '');
      if (text !== '') byType[type] = text;
    }
    components.push({
      kind: 'perVisit',
      amount: plain(draft.perVisit.amount),
      byType,
      chargedOnly: draft.perVisit.chargedOnly,
    });
  }
  if (draft.on.perDay) components.push({ kind: 'perDay', amount: plain(draft.perDay.amount) });
  return components;
}

/** The create request of a valid draft, checked against the shared schema; null otherwise. */
export function draftRequest(draft: AgreementDraft, locale: string): CreateAgreementRequest | null {
  if (Object.keys(draftProblems(draft, locale)).length > 0) return null;
  const request: CreateAgreementRequest = {
    preset: draft.preset,
    components: draftComponents(draft, locale),
    effectiveFrom: draft.effectiveFrom,
    statementVisibleToDentist: draft.visible,
    note: draft.note.trim() === '' ? null : draft.note.trim(),
  };
  return createAgreementSchema.safeParse(request).success ? request : null;
}
