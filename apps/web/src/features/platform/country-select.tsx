import { Field, Select } from '@/components/ui/field';
import { useCountryOptions } from './use-country-options';

/**
 * Country `<Select>` shared by the new-tenant panel and the clinic settings tab, so both stay in
 * sync on labelling, sorting and caching (`useCountryOptions`).
 */
export function CountrySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = useCountryOptions();
  return (
    <Field label={label}>
      {(props) => (
        <Select
          {...props}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {options.map((country) => (
            <option key={country.code} value={country.code}>
              {country.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
