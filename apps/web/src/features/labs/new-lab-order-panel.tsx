import {
  fromCents,
  LAB_ITEM_TARGETS,
  type LabItemTarget,
  type LabOrder,
  type LabPriority,
  type LabSubmission,
  parseTooth,
  patientListQuerySchema,
  type Session,
  toCents,
  type ToothCode,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { MoneyInput } from '@/features/billing/money-input';
import { useChartSettings, useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { patientListQuery } from '@/features/patients/patients-api';
import { useStaffNames } from '@/features/users/use-staff-names';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { orderNumber } from './lab-words';
import {
  createLabOrder,
  invalidateLabs,
  labProposalQuery,
  labsQuery,
  updateLabOrder,
} from './labs-api';

interface ItemDraft {
  serviceId: string;
  description: string;
  quantity: string;
  shade: string;
  target: LabItemTarget;
  teethText: string;
}

/** What the caller already knows: from a visit, the patient, dentist, visit and selected teeth. */
export interface LabOrderDefaults {
  patient?: { id: string; fullName: string };
  dentistId?: string;
  visitId?: string;
  teeth?: readonly ToothCode[];
  /** The teeth worked on in the visit: offered under each item's teeth, one click to add. */
  suggestedTeeth?: readonly ToothCode[];
}

const FREE = '';

/**
 * New lab order and Edit (B1): patient, dentist (the visit's, or the user when a dentist), lab,
 * branch (the current one), items (a service of the lab or free text, quantity, shade, teeth or
 * arch), priority, submission, expected wait (from the items and the lab unless changed), the
 * appointment it is needed for (the proposal: same dentist, else the next), notes, and — only for
 * those who manage lab money — the cost. Nobody else sees a price.
 */
export function NewLabOrderPanel({
  session,
  defaults = {},
  editing,
  onClose,
  onCreated,
}: {
  session: Session;
  defaults?: LabOrderDefaults;
  editing?: LabOrder;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const canMoney = usePermission('lab:money_manage');
  const { notation } = useChartSettings();
  const toothLabel = useToothLabel();
  const labs = useQuery(labsQuery(false));
  const staff = useStaffNames();
  const tenant = session.tenant;
  const ownProfile =
    session.profile?.practitionerType === 'dentist' ? session.profile.id : undefined;

  const [patient, setPatient] = useState(
    editing ? { id: editing.patient.id, fullName: editing.patient.fullName } : defaults.patient,
  );
  const [labId, setLabId] = useState(editing?.labId ?? '');
  const [dentistId, setDentistId] = useState(
    editing?.dentistId ?? defaults.dentistId ?? ownProfile ?? '',
  );
  const [branchId, setBranchId] = useState(
    editing?.branchId ?? session.branch?.id ?? session.branches[0]?.id ?? '',
  );
  // From a visit the work is on teeth: an item starts on *Teeth*, not on an arch.
  const newTarget: LabItemTarget =
    defaults.visitId !== undefined || (defaults.teeth?.length ?? 0) > 0 ? 'teeth' : 'upper';
  const suggested = [...new Set(defaults.suggestedTeeth ?? [])].sort();
  const toothText = (code: ToothCode) => toothLabel(code).replace('#', '');
  const [items, setItems] = useState<ItemDraft[]>(
    editing
      ? editing.items.map((item) => ({
          serviceId: item.serviceId ?? FREE,
          description: item.serviceId ? '' : item.description,
          quantity: String(item.quantity),
          shade: item.shade ?? '',
          target: item.target,
          teethText: item.teeth.map((code) => toothLabel(code).replace('#', '')).join(' '),
        }))
      : [
          {
            serviceId: FREE,
            description: '',
            quantity: '1',
            shade: '',
            target: newTarget,
            teethText: (defaults.teeth ?? []).map(toothText).join(' '),
          },
        ],
  );
  const [priority, setPriority] = useState<LabPriority>(editing?.priority ?? 'normal');
  const [submission, setSubmission] = useState<LabSubmission>(editing?.submission ?? 'physical');
  const [caseRef, setCaseRef] = useState(editing?.labCaseRef ?? '');
  const [caseUrl, setCaseUrl] = useState(editing?.labCaseUrl ?? '');
  const [expectedText, setExpectedText] = useState(editing ? String(editing.expectedDays) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [costText, setCostText] = useState(editing?.costSetByHand ? (editing.cost ?? '') : '');
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const touch = () => {
    setDirty(true);
    setError(undefined);
  };

  const proposal = useQuery({
    ...labProposalQuery(patient?.id ?? '', dentistId || undefined),
    enabled: patient !== undefined && editing === undefined,
  });
  // Until the user picks one, the proposal (B5): the next appointment with the dentist, else the next.
  const chosenAppointment = appointmentId ?? proposal.data?.appointment?.id ?? '';

  const lab = labs.data?.find((row) => row.id === labId);
  const activeServices = (lab?.services ?? []).filter((service) => service.active);
  const serviceOf = (id: string) => lab?.services.find((service) => service.id === id);
  const parsedItems = items.map((item) => {
    const codes = item.teethText
      .split(/[\s,]+/)
      .filter((part) => part !== '')
      .map((part) => parseTooth(part, notation));
    return { ...item, codes, badTeeth: codes.some((code) => code === null) };
  });
  const knownDays = items
    .map((item) => serviceOf(item.serviceId)?.turnaroundDays ?? null)
    .filter((days): days is number => days !== null);
  const defaultDays = knownDays.length > 0 ? Math.max(...knownDays) : (lab?.turnaroundDays ?? null);
  const estimate = canMoney
    ? fromCents(
        items.reduce((sum, item) => {
          const price = serviceOf(item.serviceId)?.price;
          return sum + (price ? toCents(price) * BigInt(Number(item.quantity) || 1) : 0n);
        }, 0n),
      )
    : null;
  const cost = parseAmount(costText, locale);
  const expectedDays = expectedText.trim() === '' ? null : Number(expectedText);

  const problems = {
    patient: patient === undefined,
    lab: labId === '',
    dentist: dentistId === '',
    items: parsedItems.some(
      (item) =>
        (item.serviceId === FREE && item.description.trim() === '') ||
        !(Number(item.quantity) >= 1 && Number(item.quantity) <= 99) ||
        (item.target === 'teeth' && (item.codes.length === 0 || item.badTeeth)),
    ),
    expected:
      expectedDays !== null &&
      !(Number.isInteger(expectedDays) && expectedDays >= 1 && expectedDays <= 365),
    cost: costText.trim() !== '' && (cost === null || cost === ''),
  };
  const ready = Object.values(problems).every((problem) => !problem);

  const close = () => {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    confirm({
      title: t('common:discardTitle'),
      body: t('common:discardBody'),
      okLabel: t('common:discardLeave'),
      cancelLabel: t('common:keepEditing'),
      tone: 'warn',
      onConfirm: onClose,
    });
  };

  const submit = async () => {
    setTried(true);
    if (!ready || !patient || saving) return;
    setSaving(true);
    const body = {
      dentistId,
      labId,
      branchId,
      items: parsedItems.map((item) => ({
        serviceId: item.serviceId === FREE ? null : item.serviceId,
        description: item.serviceId === FREE ? item.description.trim() : null,
        quantity: Number(item.quantity),
        shade: item.shade.trim() === '' ? null : item.shade.trim(),
        target: item.target,
        teeth:
          item.target === 'teeth'
            ? item.codes.filter((code): code is ToothCode => code !== null)
            : [],
      })),
      priority,
      submission,
      labCaseRef: submission === 'digital' && caseRef.trim() !== '' ? caseRef.trim() : null,
      labCaseUrl: submission === 'digital' && caseUrl.trim() !== '' ? caseUrl.trim() : null,
      notes: notes.trim() === '' ? null : notes.trim(),
      ...(canMoney && typeof cost === 'string' && cost !== '' ? { cost } : {}),
    };
    try {
      if (editing) {
        await updateLabOrder(editing.id, {
          ...body,
          ...(expectedDays !== null ? { expectedDays } : {}),
        });
        await invalidateLabs(queryClient);
        toast(t('labs:order.updated'), { tone: 'success' });
        onCreated(editing.id);
      } else {
        const request = {
          ...body,
          patientId: patient.id,
          visitId: defaults.visitId ?? null,
          appointmentId: chosenAppointment === '' ? null : chosenAppointment,
          expectedDays,
        };
        const created = await createLabOrder(request, keyFor(request));
        await invalidateLabs(queryClient);
        toast(t('labs:form.created', { number: orderNumber(created).slice(2) }), {
          tone: 'success',
        });
        onCreated(created.id);
      }
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
    } finally {
      setSaving(false);
    }
  };

  const setItem = (index: number, patch: Partial<ItemDraft>) => {
    setItems(items.map((item, at) => (at === index ? { ...item, ...patch } : item)));
    touch();
  };
  const fail = (bad: boolean) => (tried && bad ? t('labs:dialogs.required') : undefined);
  if (!tenant) return null;

  return (
    <>
      <div
        aria-hidden
        onClick={close}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('labs:form.eyebrow')}
        title={
          editing
            ? t('labs:form.editTitle', { number: orderNumber(editing).slice(2) })
            : t('labs:form.newTitle')
        }
        dirty={dirty}
        onClose={close}
        closeDisabled={saving}
        initialFocus="field"
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button disabled={saving} onClick={close}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void submit()}>
              {editing ? t('labs:form.saveEdit') : t('labs:form.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {labs.data && labs.data.length === 0 && (
            <p className="m-0 text-[13px] text-warning">{t('labs:form.noLabs')}</p>
          )}
          {patient ? (
            <Field label={t('labs:form.patient')}>
              {(props) => <TextInput {...props} value={patient.fullName} readOnly />}
            </Field>
          ) : (
            <PatientField
              label={t('labs:form.patient')}
              error={fail(problems.patient)}
              onPick={(picked) => {
                setPatient(picked);
                touch();
              }}
            />
          )}
          <Field label={t('labs:form.lab')} error={fail(problems.lab)}>
            {(props) => (
              <Select
                {...props}
                value={labId}
                disabled={editing !== undefined && editing.tripCount > 0}
                onChange={(event) => {
                  setLabId(event.target.value);
                  setItems(items.map((item) => ({ ...item, serviceId: FREE })));
                  touch();
                }}
              >
                <option value="" disabled>
                  {t('labs:form.chooseLab')}
                </option>
                {(labs.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('labs:form.dentist')} error={fail(problems.dentist)}>
            {(props) => (
              <Select
                {...props}
                value={dentistId}
                onChange={(event) => {
                  setDentistId(event.target.value);
                  setAppointmentId(null);
                  touch();
                }}
              >
                <option value="" disabled>
                  {t('labs:orders.allDentists')}
                </option>
                {(staff.practitioners ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {session.branches.length > 1 && (
            <Field label={t('labs:form.branch')}>
              {(props) => (
                <Select
                  {...props}
                  value={branchId}
                  onChange={(event) => {
                    setBranchId(event.target.value);
                    touch();
                  }}
                >
                  {session.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="mb-1 text-[12.5px] font-medium">{t('labs:form.items')}</legend>
            {parsedItems.map((item, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <Field label={t('labs:form.service')}>
                  {(props) => (
                    <Select
                      {...props}
                      value={item.serviceId}
                      onChange={(event) => {
                        setItem(index, { serviceId: event.target.value });
                      }}
                    >
                      <option value={FREE}>{t('labs:form.freeText')}</option>
                      {activeServices.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.price !== null
                            ? `${service.name} · ${formatMoney({ amount: service.price, currency: service.currency }, locale)}`
                            : service.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {item.serviceId === FREE && (
                  <Field
                    label={t('labs:form.description')}
                    error={fail(item.description.trim() === '')}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        value={item.description}
                        maxLength={200}
                        onChange={(event) => {
                          setItem(index, { description: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                )}
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                  <Field label={t('labs:form.where')}>
                    {(props) => (
                      <Select
                        {...props}
                        value={item.target}
                        onChange={(event) => {
                          setItem(index, { target: event.target.value as LabItemTarget });
                        }}
                      >
                        {LAB_ITEM_TARGETS.map((value) => (
                          <option key={value} value={value}>
                            {value === 'teeth' ? t('labs:form.teeth') : t(`labs:target.${value}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={t('labs:form.quantity')}>
                    {(props) => (
                      <TextInput
                        {...props}
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(event) => {
                          setItem(index, { quantity: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                  <Field label={t('labs:form.shade')} hint={t('labs:dialogs.optional')}>
                    {(props) => (
                      <TextInput
                        {...props}
                        value={item.shade}
                        maxLength={20}
                        onChange={(event) => {
                          setItem(index, { shade: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                </div>
                {item.target === 'teeth' && (
                  <Field
                    label={t('labs:form.teeth')}
                    hint={t('labs:form.teethHint')}
                    error={
                      tried && (item.codes.length === 0 || item.badTeeth)
                        ? t('labs:form.teethInvalid')
                        : undefined
                    }
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        dir="ltr"
                        value={item.teethText}
                        onChange={(event) => {
                          setItem(index, { teethText: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                )}
                {item.target === 'teeth' && suggested.length > 0 && (
                  <div
                    role="group"
                    aria-label={t('labs:form.suggestedTeeth')}
                    className="-mt-1 flex flex-wrap items-center gap-1.5"
                  >
                    <span className="text-[12px] text-ink-muted">
                      {t('labs:form.suggestedTeeth')}
                    </span>
                    {suggested.map((code) => {
                      const on = item.codes.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          dir="ltr"
                          aria-pressed={on}
                          onClick={() => {
                            const kept = item.codes.filter(
                              (value): value is ToothCode => value !== null && value !== code,
                            );
                            setItem(index, {
                              teethText: (on ? kept : [...kept, code]).map(toothText).join(' '),
                            });
                          }}
                          className={cn(
                            'h-[26px] cursor-pointer rounded-[13px] border px-2.5 font-mono text-[12px] font-medium',
                            on
                              ? 'border-primary bg-primary-tint text-primary'
                              : 'border-border-control bg-surface hover:border-ink',
                          )}
                        >
                          {toothLabel(code)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {items.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-end"
                    onClick={() => {
                      setItems(items.filter((_, at) => at !== index));
                      touch();
                    }}
                  >
                    {t('labs:form.removeItem')}
                  </Button>
                )}
              </div>
            ))}
            {items.length < 20 && (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => {
                  setItems([
                    ...items,
                    {
                      serviceId: FREE,
                      description: '',
                      quantity: '1',
                      shade: '',
                      target: newTarget,
                      teethText: '',
                    },
                  ]);
                  touch();
                }}
              >
                {t('labs:form.addItem')}
              </Button>
            )}
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t('labs:form.priority')}>
              {(props) => (
                <Select
                  {...props}
                  value={priority}
                  onChange={(event) => {
                    setPriority(event.target.value as LabPriority);
                    touch();
                  }}
                >
                  <option value="normal">{t('labs:priority.normal')}</option>
                  <option value="urgent">{t('labs:priority.urgent')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('labs:form.submission')}>
              {(props) => (
                <Select
                  {...props}
                  value={submission}
                  onChange={(event) => {
                    setSubmission(event.target.value as LabSubmission);
                    touch();
                  }}
                >
                  <option value="physical">{t('labs:submission.physical')}</option>
                  <option value="digital">{t('labs:submission.digital')}</option>
                </Select>
              )}
            </Field>
          </div>
          {submission === 'digital' && (
            <>
              <Field label={t('labs:form.caseRef')} hint={t('labs:dialogs.optional')}>
                {(props) => (
                  <TextInput
                    {...props}
                    value={caseRef}
                    maxLength={100}
                    onChange={(event) => {
                      setCaseRef(event.target.value);
                      touch();
                    }}
                  />
                )}
              </Field>
              <Field label={t('labs:form.caseUrl')} hint={t('labs:dialogs.optional')}>
                {(props) => (
                  <TextInput
                    {...props}
                    dir="ltr"
                    value={caseUrl}
                    maxLength={500}
                    onChange={(event) => {
                      setCaseUrl(event.target.value);
                      touch();
                    }}
                  />
                )}
              </Field>
            </>
          )}
          <Field
            label={t('labs:form.expectedDays')}
            hint={
              defaultDays !== null
                ? t('labs:form.expectedDefault', { count: defaultDays })
                : undefined
            }
            error={tried && problems.expected ? t('labs:dialogs.required') : undefined}
          >
            {(props) => (
              <TextInput
                {...props}
                inputMode="numeric"
                value={expectedText}
                placeholder={defaultDays !== null ? String(defaultDays) : ''}
                onChange={(event) => {
                  setExpectedText(event.target.value);
                  touch();
                }}
              />
            )}
          </Field>
          {!editing && patient && (
            <Field label={t('labs:form.appointment')}>
              {(props) => (
                <Select
                  {...props}
                  value={chosenAppointment}
                  onChange={(event) => {
                    setAppointmentId(event.target.value);
                    touch();
                  }}
                >
                  <option value="">{t('labs:form.noAppointment')}</option>
                  {(proposal.data?.upcoming ?? []).map((ref) => (
                    <option key={ref.id} value={ref.id}>
                      {`${formatDateTime(ref.startsAt, { timeZone: tenant.timeZone, locale })} · ${ref.dentistName}`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={t('labs:form.notes')} hint={t('labs:dialogs.optional')}>
            {(props) => (
              <TextInput
                {...props}
                value={notes}
                maxLength={2000}
                onChange={(event) => {
                  setNotes(event.target.value);
                  touch();
                }}
              />
            )}
          </Field>
          {canMoney && (
            <Field
              label={t('labs:form.cost')}
              hint={
                estimate !== null
                  ? t('labs:form.costHint', {
                      amount: formatMoney({ amount: estimate, currency: tenant.currency }, locale),
                    })
                  : undefined
              }
            >
              {(props) => (
                <MoneyInput
                  {...props}
                  value={costText}
                  onChange={(value) => {
                    setCostText(value);
                    touch();
                  }}
                  currency={tenant.currency}
                  locale={locale}
                />
              )}
            </Field>
          )}
          {error && (
            <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </RightPanel>
    </>
  );
}

/** A patient search for an order started outside a visit or a record. */
function PatientField({
  label,
  error,
  onPick,
}: {
  label: string;
  error: string | undefined;
  onPick: (patient: { id: string; fullName: string }) => void;
}) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim(), 200);
  const results = useQuery({
    ...patientListQuery(patientListQuerySchema.parse({ q: debounced, size: 10 })),
    enabled: debounced !== '',
  });
  return (
    <Field label={label} error={error}>
      {(props) => (
        <div>
          <TextInput
            {...props}
            value={q}
            autoComplete="off"
            maxLength={100}
            onChange={(event) => {
              setQ(event.target.value);
            }}
          />
          {(results.data?.items ?? []).length > 0 && (
            <ul className="m-0 mt-1 list-none rounded-md border border-border p-0">
              {(results.data?.items ?? []).map((patient) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    className="block w-full cursor-pointer border-none bg-transparent px-2.5 py-1.5 text-start text-[12.5px] hover:bg-sunken"
                    onClick={() => {
                      onPick({ id: patient.id, fullName: patient.fullName });
                    }}
                  >
                    {patient.fullName}
                    <span className="ms-1.5 text-ink-muted">{patient.displayNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
