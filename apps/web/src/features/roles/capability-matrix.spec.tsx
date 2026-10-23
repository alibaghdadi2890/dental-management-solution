import type { GrantablePermission } from '@dcm/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { CapabilityMatrix } from './capability-matrix';

function Harness({
  initial = [],
  locked,
  errors,
  readOnly,
  onSeen,
}: {
  initial?: GrantablePermission[];
  locked?: ReadonlyMap<GrantablePermission, string>;
  errors?: ReadonlyMap<GrantablePermission, string>;
  readOnly?: boolean;
  onSeen?: (value: GrantablePermission[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CapabilityMatrix
      value={value}
      locked={locked}
      errors={errors}
      readOnly={readOnly}
      onChange={(next) => {
        setValue(next);
        onSeen?.(next);
      }}
    />
  );
}

const toggle = (name: string) => screen.getByRole('switch', { name });
const isOn = (name: string) => toggle(name).getAttribute('aria-checked') === 'true';
const rowOf = (name: string) => toggle(name).closest('li') as HTMLElement;

describe('CapabilityMatrix (ADR-0055)', () => {
  afterEach(cleanup);

  it('lists the catalog in its groups, each permission by its label', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Money' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Staff & roles' })).toBeTruthy();
    expect(toggle('See clinic finances')).toBeTruthy();
    expect(screen.queryByText('platform:admin')).toBeNull();
  });

  it('ticks and locks what a permission needs, and frees it again', () => {
    const seen: GrantablePermission[][] = [];
    render(
      <Harness
        onSeen={(value) => {
          seen.push(value);
        }}
      />,
    );
    fireEvent.click(toggle('Record payments'));
    expect(seen.at(-1)).toEqual(['payment:read', 'payment:write']);
    expect(isOn('See patient balances & payments')).toBe(true);
    expect(toggle('See patient balances & payments').hasAttribute('disabled')).toBe(true);
    expect(
      within(rowOf('See patient balances & payments')).getByText('Needed by Record payments'),
    ).toBeTruthy();

    fireEvent.click(toggle('Record payments'));
    expect(seen.at(-1)).toEqual(['payment:read']);
    expect(toggle('See patient balances & payments').hasAttribute('disabled')).toBe(false);
  });

  it('shows what a role already gives as on and locked, with its caption', () => {
    render(<Harness locked={new Map([['visit:read', 'from Dentist']])} />);
    expect(isOn('See own visits')).toBe(true);
    expect(toggle('See own visits').hasAttribute('disabled')).toBe(true);
    expect(within(rowOf('See own visits')).getByText('from Dentist')).toBeTruthy();
  });

  it('shows a refused grant on its switch, and changes nothing when read-only', () => {
    render(
      <Harness
        initial={['finance:read', 'payment:read']}
        errors={new Map([['finance:read', 'You can’t grant this: you don’t have it yourself.']])}
        readOnly
      />,
    );
    expect(within(rowOf('See clinic finances')).getByRole('alert').textContent).toContain(
      'you don’t have it yourself',
    );
    expect(toggle('Apply discounts').hasAttribute('disabled')).toBe(true);
  });
});
