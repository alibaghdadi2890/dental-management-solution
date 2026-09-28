import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  CONTACT_ROLES,
  type ContactRole,
  type ContactRowModel,
  type RoleFlags,
} from './contact-rows';
import type { ContactDisplay } from './patient-form';
import { PatientAvatar } from './patients-table';

const pill =
  'inline-flex h-[18px] flex-none items-center gap-1 rounded-[4px] border px-1.5 text-[11.5px] leading-4 font-medium whitespace-nowrap';

/** Guardian indigo (the record's guardian chip), billing green, emergency amber. */
const ROLE_TONES: Record<ContactRole, string> = {
  guardian: 'border-primary-tint-border bg-primary-tint text-primary',
  billing: 'border-success-border bg-success-bg text-success',
  emergency: 'border-warning-border bg-warning-bg text-warning',
};

/**
 * A contact's role pills (Guardian / Billing / Emergency). The primary of a role carries a dot,
 * and says so to screen readers ("Guardian · Primary").
 */
export function RolePills({ roles, primary }: { roles: RoleFlags; primary: RoleFlags | null }) {
  const { t } = useTranslation('patients');
  const held = CONTACT_ROLES.filter((role) => roles[role]);
  if (held.length === 0) return null;
  return (
    <ul aria-label={t('contacts.roles.label')} className="m-0 flex list-none flex-wrap gap-1 p-0">
      {held.map((role) => (
        <li key={role} className={cn(pill, ROLE_TONES[role])}>
          {primary?.[role] && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
          {t(`contacts.roles.${role}`)}
          {primary?.[role] && (
            <span className="sr-only">{` · ${t('contacts.roles.primary')}`}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

const badge = cn(pill, 'border-primary-tint-border bg-primary-tint text-primary');

/** "Patient P-…" — a link to that record where the panel can leave for it (the quick view), else
 * a badge (a form, which leaving would interrupt). */
function PatientBadge({
  patient,
  asLink,
}: {
  patient: NonNullable<ContactRowModel['patient']>;
  asLink: boolean;
}) {
  const { t } = useTranslation('patients');
  const text = t('contacts.picker.patientBadge', { number: patient.number });
  if (asLink && patient.id !== null) {
    return (
      <Link
        to="/patients/$patientId"
        params={{ patientId: patient.id }}
        className={cn(badge, 'hover:underline')}
      >
        {text}
      </Link>
    );
  }
  return <span className={badge}>{text}</span>;
}

function Phone({ phone, country }: { phone: string; country: string }) {
  return (
    <span dir="ltr" className="font-mono text-xs leading-[1.4] text-ink-muted tabular-nums">
      {formatPhone(phone, country)}
    </span>
  );
}

/**
 * One contact line (design addendum "Frontend"): avatar · name · relationship, then the role
 * pills, the Mono phone (always left-to-right) and "Patient P-…" when the contact is a patient.
 * `actions` sit at the row's end, `note` after the pills (the merge's "from P-…"); `children`
 * (an inline editor) and `error` go beneath.
 */
export function ContactRow({
  row,
  country,
  patientLink = false,
  note,
  actions,
  error,
  children,
}: {
  row: ContactRowModel;
  country: string;
  patientLink?: boolean;
  note?: ReactNode;
  actions?: ReactNode;
  error?: string | undefined;
  children?: ReactNode;
}) {
  const { t } = useTranslation('patients');
  return (
    <li className="flex flex-col gap-2 border-t border-row-divider py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <PatientAvatar name={row.fullName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-[13px] leading-[1.3] font-medium [overflow-wrap:anywhere]">
              {row.fullName}
            </span>
            <span aria-hidden className="text-xs text-ink-muted">
              {'·'}
            </span>
            <span className="text-xs leading-[1.3] text-ink-muted">
              {t(`contacts.relationships.${row.relationship}`)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <RolePills roles={row.roles} primary={row.primary} />
            {row.phone !== null && <Phone phone={row.phone} country={country} />}
            {row.patient && <PatientBadge patient={row.patient} asLink={patientLink} />}
            {note}
          </div>
        </div>
        {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
      </div>
      {error && (
        <p className="m-0 text-xs leading-tight font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      {children}
    </li>
  );
}

/** Who a picked contact is, before it is linked: avatar, name, phone, "Patient P-…". */
export function ContactIdentity({
  display,
  country,
}: {
  display: ContactDisplay;
  country: string;
}) {
  const { t } = useTranslation('patients');
  return (
    <div className="flex items-center gap-2.5">
      <PatientAvatar name={display.fullName} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] leading-[1.3] font-medium">{display.fullName}</div>
        {display.phone !== null && <Phone phone={display.phone} country={country} />}
      </div>
      {display.patientNumber !== null && (
        <span className={badge}>
          {t('contacts.picker.patientBadge', { number: display.patientNumber })}
        </span>
      )}
    </div>
  );
}

/** A checkbox with its label (the role toggles). */
export function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-1.5 text-[12.5px] leading-none font-medium',
        disabled ? 'cursor-default text-ink-disabled' : 'cursor-pointer text-ink',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="size-3.5 flex-none cursor-pointer accent-primary disabled:cursor-default"
      />
      {label}
    </label>
  );
}

/**
 * The three role checkboxes as one labelled group ("Roles"): Guardian, Billing contact, Emergency
 * contact. `extra` renders beside a role (the editor's primary control).
 */
export function RoleCheckboxes({
  roles,
  disabled,
  onChange,
  extra,
  hint,
}: {
  roles: RoleFlags;
  disabled: boolean;
  onChange: (roles: RoleFlags) => void;
  extra?: (role: ContactRole) => ReactNode;
  hint?: string | undefined;
}) {
  const { t } = useTranslation('patients');
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[12.5px] leading-none font-medium">
        {t('contacts.roles.label')}
      </legend>
      {CONTACT_ROLES.map((role) => (
        <div key={role} className="flex min-h-6 items-center justify-between gap-2">
          <Toggle
            label={t(`contacts.roleOptions.${role}`)}
            checked={roles[role]}
            disabled={disabled}
            onChange={(checked) => {
              onChange({ ...roles, [role]: checked });
            }}
          />
          {extra?.(role)}
        </div>
      ))}
      {hint && <span className="text-xs leading-tight text-ink-muted">{hint}</span>}
    </fieldset>
  );
}
