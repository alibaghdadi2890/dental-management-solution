import type { FamilySuggestion, Session } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { formatPhone, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RelationshipSelect } from '../contact-picker';
import { Toggle } from '../contact-row';
import { LoadState } from '../panels/load-state';
import { failureText } from '../panels/form-server-errors';
import { dismissFamily, familiesQuery, invalidatePatientData, linkFamily } from '../patients-api';
import {
  type FamilyDraft,
  initialDraft,
  type MemberDraft,
  payerOptions,
  peopleOf,
  toLinkInput,
  withPayer,
} from './family-review';

type Tenant = NonNullable<Session['tenant']>;

/**
 * The possible families, one card at a time (families B, F7; `?panel=families`): who pays or is
 * guardian, each other patient with the payer's relationship and the roles, then **Link family**,
 * **Not a family** or **Skip** (to the next card, around to the first). A card linked or
 * dismissed leaves the list, and the next one shows.
 */
export function FamiliesPanel({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { t } = useTranslation('patients');
  const families = useQuery(familiesQuery());
  const [cursor, setCursor] = useState<string | null>(null);
  const list = families.data ?? [];
  const at = Math.max(
    0,
    list.findIndex((family) => family.phoneKey === cursor),
  );
  const current = list[at];

  let body;
  if (!families.isSuccess) {
    body = (
      <LoadState
        error={families.isError}
        failed={t('families.failed')}
        onRetry={() => void families.refetch()}
      />
    );
  } else if (!current) {
    body = <p className="m-0 text-[13px] leading-normal text-ink-muted">{t('families.done')}</p>;
  } else {
    body = (
      <FamilyCard
        key={current.phoneKey}
        family={current}
        tenant={tenant}
        onSkip={() => {
          setCursor(list[(at + 1) % list.length]?.phoneKey ?? null);
        }}
        onDone={() => {
          // The answered card leaves the list: the one after it takes its place.
          setCursor(list[at + 1]?.phoneKey ?? list[0]?.phoneKey ?? null);
        }}
      />
    );
  }

  return (
    <RightPanel
      eyebrow={current ? t('families.progress', { index: at + 1, count: list.length }) : undefined}
      title={t('families.title')}
      dirty={false}
      onClose={onClose}
    >
      {body}
    </RightPanel>
  );
}

function FamilyCard({
  family,
  tenant,
  onSkip,
  onDone,
}: {
  family: FamilySuggestion;
  tenant: Tenant;
  onSkip: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('patients');
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('patient:write');
  const today = todayIn(tenant.timeZone);
  const options = payerOptions(family, today);
  const [draft, setDraft] = useState<FamilyDraft>(() => initialDraft(family, today));
  const input = toLinkInput(family, draft);

  const settle = async (message: string) => {
    onDone();
    toast(message);
    await invalidatePatientData(queryClient);
  };
  const failed = (error: unknown) => {
    toast(t('families.failedAction', { reason: failureText(t, error) }), { tone: 'danger' });
  };
  const link = useMutation({
    mutationFn: () => (input ? linkFamily(input) : Promise.reject(new Error('nothing to link'))),
    onSuccess: () => settle(t('families.linked')),
    onError: failed,
  });
  const dismiss = useMutation({
    mutationFn: () => dismissFamily({ phoneKey: family.phoneKey, people: peopleOf(family) }),
    onSuccess: () => settle(t('families.dismissed')),
    onError: failed,
  });
  const busy = link.isPending || dismiss.isPending;
  const payer = options.find((option) => option.key === draft.payerKey);
  const payerName =
    payer && payer.kind !== 'new'
      ? payer.fullName
      : draft.newName.trim() || t('families.someoneElse');

  const setMember = (patientId: string, change: Partial<MemberDraft>) => {
    setDraft((current) => ({
      ...current,
      members: current.members.map((member) =>
        member.patientId === patientId ? { ...member, ...change } : member,
      ),
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[12.5px] leading-snug text-ink-secondary">
        <span dir="ltr" className="font-mono">
          {t('families.share', { phone: formatPhone(family.phone, tenant.country) })}
        </span>
        {family.sameFamilyName && ` · ${t('families.sameName')}`}
      </p>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[12.5px] leading-none font-medium">
          {t('families.payer')}
        </legend>
        {options.map((option) => (
          <label
            key={option.key}
            className="flex cursor-pointer items-center gap-2 text-[13px] leading-snug"
          >
            <input
              type="radio"
              name={`payer-${family.phoneKey}`}
              checked={draft.payerKey === option.key}
              disabled={busy}
              onChange={() => {
                setDraft((current) => withPayer(family, current, option.key, today));
              }}
            />
            {option.kind === 'new' ? (
              t('families.someoneElse')
            ) : (
              <span>
                {option.fullName}
                <span className="ms-1.5 text-xs text-ink-muted">
                  {option.kind === 'patient' ? option.displayNumber : t('palette.contact')}
                </span>
              </span>
            )}
          </label>
        ))}
        {draft.payerKey === 'new' && (
          <Field label={t('families.name')} className="ms-6">
            {(props) => (
              <TextInput
                {...props}
                value={draft.newName}
                disabled={busy}
                onChange={(event) => {
                  const newName = event.target.value;
                  setDraft((current) => ({ ...current, newName }));
                }}
              />
            )}
          </Field>
        )}
      </fieldset>

      <section aria-labelledby={`members-${family.phoneKey}`} className="flex flex-col gap-1.5">
        <h3
          id={`members-${family.phoneKey}`}
          className="m-0 text-[12.5px] leading-none font-medium"
        >
          {t('families.members')}
        </h3>
        <ul className="m-0 list-none p-0">
          {draft.members.map((member) => (
            <li
              key={member.patientId}
              className={cn(
                'flex flex-col gap-2 border-b border-inner-divider py-2.5 last:border-b-0',
                !member.include && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-2">
                {member.alreadyLinked ? (
                  <span className="text-[13px] font-medium">{member.fullName}</span>
                ) : (
                  <Toggle
                    label={member.fullName}
                    checked={member.include}
                    disabled={busy}
                    onChange={(include) => {
                      setMember(member.patientId, { include });
                    }}
                  />
                )}
                <span className="text-xs text-ink-muted">
                  {member.displayNumber}
                  {member.minor && ` · ${t('families.minor')}`}
                </span>
                {member.alreadyLinked && (
                  <span className="ms-auto text-xs text-ink-muted">
                    {t('families.alreadyLinked')}
                  </span>
                )}
              </div>
              {member.include && !member.alreadyLinked && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 ps-6">
                  <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
                    {t('families.relationship', { payer: payerName })}
                    <RelationshipSelect
                      aria-label={t('families.relationshipOf', { name: member.fullName })}
                      value={member.relationship}
                      disabled={busy}
                      onChange={(relationship) => {
                        setMember(member.patientId, { relationship });
                      }}
                    />
                  </label>
                  <Toggle
                    label={t('contacts.roleOptions.guardian')}
                    checked={member.isGuardian}
                    disabled={busy}
                    onChange={(isGuardian) => {
                      setMember(member.patientId, { isGuardian });
                    }}
                  />
                  <Toggle
                    label={t('contacts.roleOptions.billing')}
                    checked={member.isBillingContact}
                    disabled={busy}
                    onChange={(isBillingContact) => {
                      setMember(member.patientId, { isBillingContact });
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={busy || input === null}
            onClick={() => {
              link.mutate();
            }}
          >
            {t('families.link')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              dismiss.mutate();
            }}
          >
            {t('families.dismiss')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onSkip}>
            {t('families.skip')}
          </Button>
        </div>
      )}
    </div>
  );
}
