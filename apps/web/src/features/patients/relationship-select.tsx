import { CONTACT_RELATIONSHIPS, type ContactRelationship } from '@dcm/contracts';
import type { SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/field';

/** The relationship `<select>`: the six relations of a contact *to the patient*, localized. */
export function RelationshipSelect({
  value,
  onChange,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  value: ContactRelationship;
  onChange: (relationship: ContactRelationship) => void;
}) {
  const { t } = useTranslation('patients');
  return (
    <Select
      {...props}
      value={value}
      onChange={(event) => {
        const picked = CONTACT_RELATIONSHIPS.find((option) => option === event.target.value);
        if (picked) onChange(picked);
      }}
    >
      {CONTACT_RELATIONSHIPS.map((relationship) => (
        <option key={relationship} value={relationship}>
          {t(`contacts.relationships.${relationship}`)}
        </option>
      ))}
    </Select>
  );
}
