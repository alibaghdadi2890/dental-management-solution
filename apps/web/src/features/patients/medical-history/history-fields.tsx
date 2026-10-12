import type {
  MedicalHistory,
  MedicalHistoryInput,
  MedicalOption,
  MedicalOptionKind,
} from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { cn } from '@/lib/utils';
import { addItem, isNone, pillsOf, removeItem, suggestionsOf, toggleNone } from './history-model';
import { ItemsField } from './items-field';
import { addMedicalOption, medicalOptionsQuery } from './medical-options-api';

const NO_OPTIONS: MedicalOption[] = [];

/**
 * A patient's medical history as it is entered (feature 10, V3, V13): the allergies and the
 * conditions, each a box of pills that suggests the clinic's names as one types (`ItemsField`),
 * and the medication line. A name the clinic does not have yet is added to its list on the way
 * (`POST /medical-history/options`), so the next patient is offered it. `stored` names what the
 * patient already has that the list no longer holds. Where every change is saved at once (the
 * visit's Intake), `commitMedicationOnBlur` holds the medication line until the field is left.
 */
export function HistoryFields({
  value,
  onChange,
  stored,
  disabled = false,
  commitMedicationOnBlur = false,
  className,
}: {
  value: MedicalHistoryInput;
  onChange: (next: MedicalHistoryInput) => void;
  /** The patient's saved history, when editing one. */
  stored?: MedicalHistory | undefined;
  disabled?: boolean;
  commitMedicationOnBlur?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation('patients');
  const toast = useToast();
  const queryClient = useQueryClient();
  const options = useQuery(medicalOptionsQuery()).data ?? NO_OPTIONS;
  const medicationId = useId();
  // The line as typed, while it is held back; null = showing the value.
  const [typing, setTyping] = useState<string | null>(null);
  const medication = typing ?? value.medication ?? '';

  // A new name comes back from the server later: it joins the history as it is by then.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const create = useMutation({
    mutationFn: addMedicalOption,
    onSuccess: (option) => {
      queryClient.setQueryData(medicalOptionsQuery().queryKey, (list) => [
        ...(list ?? []).filter((known) => known.id !== option.id),
        option,
      ]);
      onChange(addItem(latest.current, option.kind, option.id));
    },
    onError: (error, { name }) => {
      toast(t('history.addFailed', { name, reason: apiErrorMessage(error, i18n) }), {
        tone: 'danger',
      });
    },
  });

  const list = (kind: MedicalOptionKind) => (
    <ItemsField
      kind={kind}
      label={t(`history.${kind}.label`)}
      noneLabel={t(`history.${kind}.none`)}
      placeholder={t(`history.${kind}.placeholder`)}
      none={isNone(value, kind)}
      pills={pillsOf(value, kind, options, stored)}
      suggest={(text) => suggestionsOf(value, kind, options, text)}
      disabled={disabled}
      busy={create.isPending && create.variables.kind === kind}
      onNone={() => {
        onChange(toggleNone(value, kind));
      }}
      onAdd={(id) => {
        onChange(addItem(value, kind, id));
      }}
      onCreate={(name) => {
        create.mutate({ kind, name });
      }}
      onRemove={(id) => {
        onChange(removeItem(value, kind, id));
      }}
    />
  );

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {list('allergy')}
      {list('condition')}
      <div>
        <label
          htmlFor={medicationId}
          className="mb-1.5 block text-[12.5px] leading-none font-medium"
        >
          {t('history.medication')}
        </label>
        <input
          id={medicationId}
          type="text"
          maxLength={500}
          disabled={disabled}
          placeholder={t('history.medicationPlaceholder')}
          value={medication}
          onChange={(event) => {
            if (commitMedicationOnBlur) setTyping(event.target.value);
            else onChange({ ...value, medication: event.target.value });
          }}
          onBlur={() => {
            if (typing === null) return;
            setTyping(null);
            if (typing.trim() !== (value.medication ?? '').trim()) {
              onChange({ ...value, medication: typing });
            }
          }}
          className="h-[38px] w-full rounded-[7px] border border-border-control bg-surface px-[11px] text-[13px] text-ink disabled:opacity-60"
        />
      </div>
    </div>
  );
}
