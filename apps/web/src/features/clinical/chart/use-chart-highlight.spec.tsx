import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHART_CARD, useChartHighlight } from './use-chart-highlight';
import { setChartView } from './use-chart-view';

const FILLING = { kind: 'service', id: 'CMP' } as const;
const CROWN = { kind: 'service', id: 'ZIR' } as const;

describe('useChartHighlight', () => {
  afterEach(() => {
    cleanup();
    setChartView('both');
  });

  it('highlights one item at a time; the same item again clears it', () => {
    const { result } = renderHook(() => useChartHighlight('permanent'));
    expect(result.current.highlight).toBeNull();
    act(() => {
      result.current.toggle(FILLING);
    });
    expect(result.current.highlight).toEqual(FILLING);
    act(() => {
      result.current.toggle(CROWN);
    });
    expect(result.current.highlight).toEqual(CROWN);
    act(() => {
      result.current.toggle(CROWN);
    });
    expect(result.current.highlight).toBeNull();
  });

  it('ends with the view it was made in, and does not come back with it', () => {
    const { result } = renderHook(() => useChartHighlight('permanent'));
    act(() => {
      result.current.toggle(FILLING);
    });
    act(() => {
      setChartView('diagnoses');
    });
    expect(result.current.highlight).toBeNull();
    act(() => {
      setChartView('both');
    });
    expect(result.current.highlight).toBeNull();
  });

  it('ends when the chart on screen changes', () => {
    const { result, rerender } = renderHook(({ chart }) => useChartHighlight(chart), {
      initialProps: { chart: 'permanent' },
    });
    act(() => {
      result.current.toggle(FILLING);
    });
    rerender({ chart: 'primary' });
    expect(result.current.highlight).toBeNull();
  });
});

describe('useChartHighlight: Esc', () => {
  afterEach(() => {
    cleanup();
    setChartView('both');
  });

  /** A card with a legend line, a field beside it, and the page's own Esc handler. */
  function Page({ onPageEscape }: { onPageEscape: () => void }) {
    const { highlight, toggle } = useChartHighlight('permanent');
    return (
      // The page deselects the tooth on Esc, as the workspace does.
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') onPageEscape();
        }}
      >
        <section {...{ [CHART_CARD]: '' }}>
          <button
            type="button"
            aria-pressed={highlight !== null}
            onClick={() => {
              toggle(FILLING);
            }}
          >
            {'Composite'}
          </button>
        </section>
        <input aria-label="Notes" />
        <button type="button">{'Elsewhere'}</button>
      </div>
    );
  }
  const line = () => screen.getByRole('button', { name: 'Composite' });
  const pressed = () => line().getAttribute('aria-pressed');

  it('clears the highlight from inside the card, before the page sees the key', () => {
    const onPageEscape = vi.fn();
    render(<Page onPageEscape={onPageEscape} />);
    fireEvent.click(line());
    expect(pressed()).toBe('true');

    fireEvent.keyDown(line(), { key: 'Escape' });
    expect(pressed()).toBe('false');
    expect(onPageEscape).not.toHaveBeenCalled();

    // Nothing highlighted: the key is the page's again.
    fireEvent.keyDown(line(), { key: 'Escape' });
    expect(onPageEscape).toHaveBeenCalledTimes(1);
  });

  it('leaves the key to a field, to a control outside the card and to an open dialog', () => {
    const onPageEscape = vi.fn();
    render(<Page onPageEscape={onPageEscape} />);
    fireEvent.click(line());

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Elsewhere' }), { key: 'Escape' });
    expect(pressed()).toBe('true');
    expect(onPageEscape).toHaveBeenCalledTimes(2);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    try {
      fireEvent.keyDown(line(), { key: 'Escape' });
      expect(pressed()).toBe('true');
    } finally {
      dialog.remove();
    }
  });
});
