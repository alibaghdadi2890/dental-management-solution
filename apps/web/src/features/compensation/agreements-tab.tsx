import type { Agreement, Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Eyebrow, Field, TextInput } from '@/components/ui/field';
import { Pill } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatCalendarDate, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AgreementEditor } from './agreement-editor';
import { type AgreementDraft, draftOf, draftRequest, presetDraft } from './agreement-form';
import { agreementWords } from './agreement-words';
import {
  agreementsQuery,
  changeTerms,
  createAgreement,
  endAgreement,
  invalidateCompensation,
} from './compensation-api';

type Tenant = NonNullable<Session['tenant']>;
type Mode = { kind: 'view' } | { kind: 'edit'; change: boolean } | { kind: 'end' };

/** Server answers shown on the date field rather than above the form. */
const DATE_CODES = new Set([
  'compensation.overlap',
  'compensation.effective_date',
  'compensation.period_closed',
]);

const STATUS_TONES = {
  active: 'success',
  future: 'indigo',
  ended: 'neutral',
  superseded: 'neutral',
} as const;

function AgreementCard({
  agreement,
  tenant,
  current,
}: {
  agreement: Agreement;
  tenant: Tenant;
  current: boolean;
}) {
  const { t, i18n } = useTranslation('compensation');
  const locale = i18n.resolvedLanguage ?? 'en';
  const struck = agreement.status === 'superseded';
  const date = (iso: string) => formatCalendarDate(iso, locale);
  return (
    <article
      className={cn(
        'rounded-lg border px-3.5 py-3',
        current ? 'border-border bg-surface' : 'border-inner-divider bg-faint',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('m-0 text-[13px] font-semibold', struck && 'line-through')}>
          {t(`presets.${agreement.preset}.label`)}
        </h3>
        <Pill tone={STATUS_TONES[agreement.status]}>
          {t(`agreementStatus.${agreement.status}`)}
        </Pill>
      </div>
      <ul
        className={cn(
          'm-0 mt-2 list-none p-0 text-[12.5px] leading-snug',
          struck && 'line-through',
        )}
      >
        {agreementWords(agreement, { t, currency: tenant.currency, locale }).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="m-0 mt-2 text-[12px] text-ink-muted">
        {agreement.effectiveTo === null
          ? t('agreement.from', { from: date(agreement.effectiveFrom) })
          : t('agreement.between', {
              from: date(agreement.effectiveFrom),
              to: date(agreement.effectiveTo),
            })}
        {' · '}
        {t(agreement.statementVisibleToDentist ? 'agreement.visible' : 'agreement.hidden')}
      </p>
      {(agreement.supersedeReason ?? agreement.endReason) && (
        <p className="m-0 mt-1 text-[12px] text-ink-muted">
          {agreement.supersedeReason ?? agreement.endReason}
        </p>
      )}
    </article>
  );
}

/**
 * Settings › Staff › a dentist's Compensation tab (prompt §1, `compensation:manage`): the agreement
 * in force as a card, the earlier ones below, and New agreement / Change terms / End agreement.
 * The form opens in place of the cards — the tab is already a 440px panel.
 */
export function AgreementsTab({ profileId, tenant }: { profileId: string; tenant: Tenant }) {
  const { t, i18n } = useTranslation(['compensation', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const agreements = useQuery(agreementsQuery(profileId));
  const today = todayIn(tenant.timeZone);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [draft, setDraft] = useState<AgreementDraft>(() => presetDraft('revenueShare', today));
  const [showProblems, setShowProblems] = useState(false);
  const [dateError, setDateError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [end, setEnd] = useState({ date: today, reason: '' });

  if (!agreements.data) {
    return agreements.isError ? (
      <p role="alert" className="m-0 text-[12.5px] text-ink-muted">
        {t('compensation:agreement.loadFailed')}
      </p>
    ) : (
      <CardSkeleton label={t('compensation:agreement.loading')} />
    );
  }
  const live = agreements.data.filter((row) => row.status === 'active' || row.status === 'future');
  const current = live[0];
  const history = agreements.data.filter((row) => row !== current);

  const reset = () => {
    setMode({ kind: 'view' });
    setShowProblems(false);
    setDateError(undefined);
    setFailure(undefined);
  };
  const fail = (error: unknown) => {
    const message = apiErrorMessage(error, i18n);
    if (error instanceof ApiError && DATE_CODES.has(error.code)) setDateError(message);
    else setFailure(message);
  };
  const saved = async (message: string) => {
    await invalidateCompensation(queryClient);
    toast(message, { tone: 'success' });
    reset();
  };

  const save = async (change: boolean) => {
    setShowProblems(true);
    setDateError(undefined);
    setFailure(undefined);
    const request = draftRequest(draft, locale);
    if (!request) return;
    setSaving(true);
    try {
      if (change) await changeTerms(profileId, request);
      else await createAgreement(profileId, request);
      await saved(t(change ? 'compensation:agreement.changed' : 'compensation:agreement.created'));
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    if (!current) return;
    setFailure(undefined);
    setDateError(undefined);
    setSaving(true);
    try {
      await endAgreement(profileId, current.id, {
        date: end.date,
        reason: end.reason.trim() === '' ? null : end.reason.trim(),
      });
      await saved(t('compensation:agreement.ended'));
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  const errorBox = failure && (
    <div
      role="alert"
      className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-[12.5px] font-medium text-danger"
    >
      {failure}
    </div>
  );

  if (mode.kind === 'edit') {
    return (
      <div className="flex flex-col gap-4">
        <Eyebrow>
          {t(mode.change ? 'compensation:agreement.changeTerms' : 'compensation:agreement.new')}
        </Eyebrow>
        {mode.change && (
          <p className="m-0 text-[12px] leading-snug text-ink-muted">
            {t('compensation:agreement.changeHint')}
          </p>
        )}
        {errorBox}
        <AgreementEditor
          draft={draft}
          onChange={setDraft}
          showProblems={showProblems}
          dateError={dateError}
          tenant={tenant}
        />
        <div className="flex justify-end gap-2">
          <Button disabled={saving} onClick={reset}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" busy={saving} onClick={() => void save(mode.change)}>
            {t(mode.change ? 'compensation:agreement.saveChange' : 'compensation:agreement.save')}
          </Button>
        </div>
      </div>
    );
  }

  if (mode.kind === 'end' && current) {
    return (
      <div className="flex flex-col gap-4">
        <Eyebrow>{t('compensation:agreement.end')}</Eyebrow>
        <AgreementCard agreement={current} tenant={tenant} current />
        {errorBox}
        <Field label={t('compensation:agreement.lastDay')} error={dateError}>
          {(props) => (
            <DateInput
              {...props}
              value={end.date}
              onChange={(date) => {
                setEnd((value) => ({ ...value, date }));
              }}
              order={dateInputOrder(tenant.country)}
              today={today}
              max="2099-12-31"
              pickerLabel={t('compensation:form.chooseDate')}
            />
          )}
        </Field>
        <Field label={t('compensation:agreement.reason')} hint={t('compensation:form.optional')}>
          {(props) => (
            <TextInput
              {...props}
              value={end.reason}
              maxLength={500}
              onChange={(event) => {
                setEnd((value) => ({ ...value, reason: event.target.value }));
              }}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button disabled={saving} onClick={reset}>
            {t('common:cancel')}
          </Button>
          <Button variant="danger" busy={saving} onClick={() => void finish()}>
            {t('compensation:agreement.end')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {current ? (
        <AgreementCard agreement={current} tenant={tenant} current />
      ) : (
        <p className="m-0 rounded-lg border border-dashed border-border px-3.5 py-4 text-[12.5px] text-ink-muted">
          {t('compensation:agreement.none')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {current ? (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(
                  draftOf(current, today < current.effectiveFrom ? current.effectiveFrom : today),
                );
                setMode({ kind: 'edit', change: true });
              }}
            >
              {t('compensation:agreement.changeTerms')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setEnd({ date: today, reason: '' });
                setMode({ kind: 'end' });
              }}
            >
              {t('compensation:agreement.end')}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              setDraft(presetDraft('revenueShare', today));
              setMode({ kind: 'edit', change: false });
            }}
          >
            {t('compensation:agreement.new')}
          </Button>
        )}
      </div>
      {history.length > 0 && (
        <>
          <Eyebrow className="mt-2">{t('compensation:agreement.history')}</Eyebrow>
          {history.map((agreement) => (
            <AgreementCard
              key={agreement.id}
              agreement={agreement}
              tenant={tenant}
              current={false}
            />
          ))}
        </>
      )}
    </div>
  );
}
