import { SPECIALTIES } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { ChipCheckboxGroup } from '@/components/ui/chip-checkbox';
import { Field, Select } from '@/components/ui/field';
import { type SpecialtyChoice, toggleSpecialty } from './specialty-choice';

/**
 * A dentist's specialties and which one is primary (ADR-0050), in the user panel and the new
 * clinic's owner section. The primary is chosen among the ticked ones only.
 */
export function SpecialtyFields({
  choice,
  onChange,
  error,
}: {
  choice: SpecialtyChoice;
  onChange: (choice: SpecialtyChoice) => void;
  error?: string | undefined;
}) {
  const { t } = useTranslation('admin');
  return (
    <>
      <ChipCheckboxGroup
        label={t('users.fields.specialties')}
        options={SPECIALTIES.map((key) => ({ value: key, label: t(`users.specialties.${key}`) }))}
        selected={choice.specialties}
        onToggle={(value) => {
          const key = SPECIALTIES.find((specialty) => specialty === value);
          if (key) onChange(toggleSpecialty(choice, key));
        }}
        error={error}
      />
      <Field label={t('users.fields.primarySpecialty')}>
        {(props) => (
          <Select
            {...props}
            value={choice.primarySpecialty ?? ''}
            disabled={choice.specialties.length === 0}
            onChange={(event) => {
              const key = choice.specialties.find((specialty) => specialty === event.target.value);
              if (key) onChange({ ...choice, primarySpecialty: key });
            }}
          >
            {choice.specialties.length === 0 && <option value="" />}
            {choice.specialties.map((key) => (
              <option key={key} value={key}>
                {t(`users.specialties.${key}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}
