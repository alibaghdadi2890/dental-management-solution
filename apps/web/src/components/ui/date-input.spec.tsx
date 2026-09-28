import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { DateInput } from './date-input';

const TODAY = '2026-09-28';

function Harness({
  initial = '',
  onChange = () => undefined,
  min,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  min?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateInput
      aria-label="Date of birth"
      order="DMY"
      today={TODAY}
      {...(min === undefined ? {} : { min })}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const input = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Date of birth' });
const openCalendar = async (name = 'Choose date') => {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog');
};

describe('DateInput', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('still takes a typed date in the tenant order', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(input(), { target: { value: '01/05/1990' } });
    expect(onChange).toHaveBeenLastCalledWith('1990-05-01');
    expect(input().value).toBe('01/05/1990');
  });

  it('picks a day from the calendar: the ISO value, the typed text, closed, focus back', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} min="1900-01-01" />);
    const calendar = await openCalendar();
    fireEvent.change(within(calendar).getByRole('combobox', { name: 'Choose the Year' }), {
      target: { value: '1990' },
    });
    fireEvent.change(within(calendar).getByRole('combobox', { name: 'Choose the Month' }), {
      target: { value: '4' },
    });
    expect(within(calendar).getByRole('grid', { name: 'May 1990' })).toBeTruthy();
    fireEvent.click(within(calendar).getByRole('button', { name: /May 1st, 1990/ }));

    expect(onChange).toHaveBeenLastCalledWith('1990-05-01');
    expect(input().value).toBe('01/05/1990');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(input());
  });

  it('opens on the current value, else on the month of today', async () => {
    render(<Harness initial="1990-05-01" />);
    const calendar = await openCalendar();
    expect(within(calendar).getByRole('grid', { name: 'May 1990' })).toBeTruthy();
    cleanup();
    render(<Harness />);
    expect(within(await openCalendar()).getByRole('grid', { name: 'September 2026' })).toBeTruthy();
  });

  it('disables days after today and before the minimum, and years outside them', async () => {
    render(<Harness min="1900-01-01" />);
    const calendar = await openCalendar();
    expect(within(calendar).getByRole('button', { name: /September 28th, 2026/ })).toHaveProperty(
      'disabled',
      false,
    );
    expect(within(calendar).getByRole('button', { name: /September 29th, 2026/ })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      within(calendar)
        .getByRole('button', { name: 'Go to the Next Month' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    const years = within(
      within(calendar).getByRole('combobox', { name: 'Choose the Year' }),
    ).getAllByRole('option');
    expect(years[0]?.textContent).toBe('1900');
    expect(years.at(-1)?.textContent).toBe('2026');
  });

  it('closes on Escape and gives focus back to the input', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await openCalendar();
    const active = document.activeElement ?? document.body;
    fireEvent.keyDown(active, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(input());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the calendar right to left in Arabic, weeks starting on Saturday', async () => {
    await i18n.changeLanguage('ar');
    render(<Harness />);
    const calendar = await openCalendar('اختيار التاريخ');
    expect(calendar.querySelector('[dir="rtl"]')).toBeTruthy();
    // The weekday row is aria-hidden: each day button's label already names its weekday.
    const [first] = within(calendar).getAllByRole('columnheader', { hidden: true });
    expect(first?.getAttribute('aria-label')).toBe('السبت');
  });
});
