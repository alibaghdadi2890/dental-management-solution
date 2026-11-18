import type { ContactDetail } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Dialog } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { Pill } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { FamilyMembers, FamilyStatementButton } from '@/features/billing/family-card';
import { familyQuery } from '@/features/billing/payments-api';
import { formatPhone } from '@/lib/format';
import { contactDetailQuery } from '../contacts-api';
import { usePatientNavigation } from '../patient-navigation';
import { LoadState } from '../panels/load-state';

/**
 * A contact, wherever they are found (families C): a slide-over from the inline end with their
 * phone and e-mail, the patient record they are (Open record) or **Register as patient** (a
 * contact who is no patient, `patient:write`), the patients who link them with each link's
 * relationship and roles, and — with `payment:read`, for a billing contact — the family's balance
 * (`FamilyMembers`: members, total, Record family payment, Family statement).
 */
export function ContactPanel({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const { t } = useTranslation(['patients', 'common']);
  const detail = useQuery(contactDetailQuery(contactId));
  const name = detail.data?.contact.fullName ?? '';
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.28)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 end-0 z-50 flex w-[440px] max-w-full animate-slidein flex-col border-s border-border bg-surface shadow-[0_18px_48px_rgba(27,26,31,.18)]"
        >
          <div className="flex flex-none items-start gap-3 border-b border-inner-divider px-[18px] pt-4 pb-3.5">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase">
                {t('contactPanel.eyebrow')}
              </div>
              <Dialog.Title className="m-0 truncate text-base leading-tight font-semibold tracking-[-0.01em]">
                {name || t('contactPanel.eyebrow')}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <IconButton aria-label={t('common:close')}>
                <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
                  <path d="m2 2 8 8M10 2 2 10" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
            {detail.data ? (
              <ContactBody detail={detail.data} onClose={onClose} />
            ) : (
              <LoadState
                error={detail.isError}
                failed={t('contactPanel.failed')}
                onRetry={() => void detail.refetch()}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ContactBody({ detail, onClose }: { detail: ContactDetail; onClose: () => void }) {
  const { t, i18n } = useTranslation('patients');
  const { data: session } = useSession();
  const country = session?.tenant?.country ?? 'LB';
  const canWrite = usePermission('patient:write');
  const canSeeMoney = usePermission('payment:read');
  const { openPatient, openNewPatient } = usePatientNavigation();
  const { contact, patients } = detail;
  const billing = patients.some((row) => row.isBillingContact);
  const family = useQuery({ ...familyQuery(contact.id), enabled: canSeeMoney && billing });
  const linked = contact.linkedPatient;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2 text-[12.5px] leading-snug">
        {contact.phone && (
          <span dir="ltr" className="self-start font-mono tabular-nums">
            {formatPhone(contact.phone, country)}
          </span>
        )}
        {contact.email && <span className="break-all text-ink-secondary">{contact.email}</span>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {linked ? (
            <>
              <Pill tone="indigo">
                {t('contactPanel.patient', { number: linked.displayNumber })}
              </Pill>
              <Button
                size="sm"
                onClick={() => {
                  onClose();
                  openPatient(linked.id);
                }}
              >
                {t('contactPanel.openRecord')}
              </Button>
            </>
          ) : (
            canWrite && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onClose();
                  openNewPatient({
                    fullName: contact.fullName,
                    ...(contact.phone ? { phone: contact.phone } : {}),
                    ...(contact.email ? { email: contact.email } : {}),
                    contactId: contact.id,
                  });
                }}
              >
                {t('contactPanel.register')}
              </Button>
            )
          )}
        </div>
      </section>

      <section aria-labelledby="contact-panel-linked" className="flex flex-col gap-1.5">
        <h3
          id="contact-panel-linked"
          className="m-0 text-[12px] leading-none font-medium text-ink-muted"
        >
          {t('contactPanel.linked')}
        </h3>
        {patients.length === 0 ? (
          <p className="m-0 text-[12.5px] text-ink-muted">{t('contactPanel.none')}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {patients.map((row) => (
              <li
                key={row.patient.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-inner-divider py-2 text-[12.5px] last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: row.patient.id }}
                    onClick={onClose}
                    className="font-medium text-ink hover:text-primary hover:underline"
                  >
                    {row.patient.fullName}
                  </Link>
                  <span className="block text-[11.5px] text-ink-muted">
                    {t(`contacts.relationships.${row.relationship}`)}
                    {row.patient.archived && ` · ${t('record.archived')}`}
                  </span>
                </span>
                {row.isGuardian && <Pill tone="indigo">{t('contacts.roles.guardian')}</Pill>}
                {row.isBillingContact && <Pill tone="neutral">{t('contacts.roles.billing')}</Pill>}
                {row.isEmergencyContact && (
                  <Pill tone="neutral">{t('contacts.roles.emergency')}</Pill>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {family.data && (
        <section aria-labelledby="contact-panel-money" className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3
              id="contact-panel-money"
              className="m-0 text-[12px] leading-none font-medium text-ink-muted"
            >
              {t('contactPanel.money')}
            </h3>
            <FamilyStatementButton contactId={contact.id} />
          </div>
          <FamilyMembers family={family.data} contactId={contact.id} locale={i18n.language} />
        </section>
      )}
    </div>
  );
}
