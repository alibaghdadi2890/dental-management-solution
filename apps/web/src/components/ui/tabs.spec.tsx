import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs } from './tabs';

const TABS = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta' },
  { key: 'c', label: 'Gamma' },
] as const;
type Key = (typeof TABS)[number]['key'];

function Harness({ dir, onChange }: { dir?: 'rtl'; onChange?: (key: Key) => void }) {
  const [active, setActive] = useState<Key>('a');
  return (
    <div dir={dir}>
      <Tabs
        idBase="t"
        label="Sections"
        tabs={TABS}
        active={active}
        onChange={(key) => {
          onChange?.(key);
          setActive(key);
        }}
      />
      <TabPanel idBase="t" tabKey={active}>
        {`Panel ${active}`}
      </TabPanel>
    </div>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  afterEach(cleanup);

  it('wires tabs to the panel and keeps one Tab stop on the selected tab', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy();
    expect(tab('Alpha').getAttribute('aria-selected')).toBe('true');
    expect(tab('Alpha').tabIndex).toBe(0);
    expect(tab('Beta').tabIndex).toBe(-1);
    const panel = screen.getByRole('tabpanel', { name: 'Alpha' });
    expect(tab('Alpha').getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.textContent).toBe('Panel a');
  });

  it('moves focus with the arrows, wrapping, and Home/End, without selecting', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Beta'));
    fireEvent.keyDown(tab('Beta'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Gamma'));
    fireEvent.keyDown(tab('Gamma'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Alpha'));
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Gamma'));
    fireEvent.keyDown(tab('Gamma'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('Alpha'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mirrors the arrows right-to-left', () => {
    render(<Harness dir="rtl" />);
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Beta'));
    fireEvent.keyDown(tab('Beta'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Alpha'));
  });

  it('selects the focused tab on activation', () => {
    render(<Harness />);
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' });
    fireEvent.click(tab('Beta'));
    expect(tab('Beta').getAttribute('aria-selected')).toBe('true');
    expect(tab('Beta').tabIndex).toBe(0);
    expect(screen.getByRole('tabpanel', { name: 'Beta' }).textContent).toBe('Panel b');
  });
});
