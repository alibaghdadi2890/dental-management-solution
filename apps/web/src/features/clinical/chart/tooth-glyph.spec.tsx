import type { ToothState } from '@dcm/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ToothGlyph } from './tooth-glyph';

function tooth(overrides: Partial<ToothState> & Pick<ToothState, 'code'>): ToothState {
  return {
    state: 'none',
    surfaces: {},
    wholeTooth: null,
    hasActiveDiagnosis: false,
    openPlanIds: [],
    historyCount: 0,
    titleParts: { diagnoses: [], plans: [], historyCount: 0 },
    ...overrides,
  };
}

function marks(container: HTMLElement): Record<string, string | undefined> {
  const bySurface: Record<string, string | undefined> = {};
  for (const cell of container.querySelectorAll<HTMLElement>('[data-surface]')) {
    bySurface[cell.dataset.surface ?? ''] = cell.dataset.mark;
  }
  return bySurface;
}

const surfaceOrder = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-surface]')].map(
    (cell) => cell.dataset.surface,
  );

const glyphBox = (container: HTMLElement) => {
  const box = container.querySelector<HTMLElement>('[data-glyph]');
  if (!box) throw new Error('no glyph');
  return box;
};

describe('ToothGlyph', () => {
  afterEach(cleanup);

  it('fills only the treated surface', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="16"
        tooth={tooth({ code: '16', state: 'treated', surfaces: { O: 'treated' }, historyCount: 1 })}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
      />,
    );

    expect(marks(container)).toEqual({ B: 'none', M: 'none', O: 'treated', D: 'none', L: 'none' });
  });

  it('fills every cell for a whole-tooth service, with this visit’s surface on top', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="16"
        tooth={tooth({
          code: '16',
          state: 'treated_today',
          wholeTooth: 'treated',
          surfaces: { M: 'treated_today' },
        })}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
      />,
    );

    expect(marks(container)).toEqual({
      B: 'treated',
      M: 'treated_today',
      O: 'treated',
      D: 'treated',
      L: 'treated',
    });
  });

  it('washes every unmarked cell of a planned tooth', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="16"
        tooth={tooth({ code: '16', state: 'planned', openPlanIds: ['p1'] })}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
      />,
    );

    expect(new Set(Object.values(marks(container)))).toEqual(new Set(['planned']));
  });

  it('lays the surfaces out anatomically: mesial toward the midline, incisal on anterior teeth', () => {
    const glyph = (
      code: '16' | '11',
      orientation: 'patient_right_on_right' | 'patient_right_on_left',
    ) =>
      render(
        <ToothGlyph
          variant="chart"
          code={code}
          tooth={undefined}
          mode="surface"
          orientation={orientation}
          size={12}
        />,
      ).container;

    expect(surfaceOrder(glyph('16', 'patient_right_on_right'))).toEqual(['B', 'M', 'O', 'D', 'L']);
    cleanup();
    expect(surfaceOrder(glyph('16', 'patient_right_on_left'))).toEqual(['B', 'D', 'O', 'M', 'L']);
    cleanup();
    expect(surfaceOrder(glyph('11', 'patient_right_on_right'))).toEqual(['B', 'M', 'I', 'D', 'L']);
  });

  it('renders a 3×3 grid of the cell size, primary teeth at 0.78×', () => {
    const { container, rerender } = render(
      <ToothGlyph
        variant="chart"
        code="16"
        tooth={undefined}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
      />,
    );
    expect(glyphBox(container).style.gridTemplateColumns).toBe('repeat(3, 12px)');

    rerender(
      <ToothGlyph
        variant="chart"
        code="55"
        tooth={undefined}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
      />,
    );
    expect(glyphBox(container).style.gridTemplateColumns).toBe('repeat(3, 9px)');

    rerender(
      <ToothGlyph
        variant="chart"
        code="55"
        tooth={undefined}
        mode="surface"
        orientation="patient_right_on_right"
        size={8}
      />,
    );
    expect(glyphBox(container).style.gridTemplateColumns).toBe('repeat(3, 6px)');
  });

  it('renders one whole-tooth cell in simple mode, sized from the cell size', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="16"
        tooth={tooth({ code: '16', state: 'treated', surfaces: { O: 'treated' }, historyCount: 1 })}
        mode="simple"
        orientation="patient_right_on_right"
        size={12}
      />,
    );

    const cells = container.querySelectorAll<HTMLElement>('[data-mark]');
    expect(cells).toHaveLength(1);
    expect(cells[0]?.dataset.mark).toBe('treated');
    expect(container.querySelector('[data-surface]')).toBeNull();
    expect(glyphBox(container).style.gridTemplateColumns).toBe('26px');
    expect(glyphBox(container).style.gridTemplateRows).toBe('32px');
  });

  it('draws not-yet-erupted positions as dashed outlines', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="17"
        tooth={undefined}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
        notErupted
      />,
    );

    const cells = [...container.querySelectorAll<HTMLElement>('[data-surface]')];
    expect(cells).toHaveLength(5);
    for (const cell of cells) expect(cell.className).toContain('border-dashed');
  });

  it('makes the enlarged panel surfaces toggle buttons with their full names', () => {
    const onSurfaceClick = vi.fn();
    render(
      <ToothGlyph
        variant="panel"
        code="16"
        tooth={tooth({ code: '16', state: 'treated', surfaces: { O: 'treated' }, historyCount: 1 })}
        mode="surface"
        orientation="patient_right_on_right"
        pendingSurfaces={['M']}
        onSurfaceClick={onSurfaceClick}
      />,
    );

    const occlusal = screen.getByRole('button', { name: 'Occlusal · treated' });
    expect(occlusal.textContent).toBe('O');
    expect(occlusal.getAttribute('title')).toBe('Occlusal · treated');
    expect(occlusal.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Mesial' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getAllByRole('button')).toHaveLength(5);

    fireEvent.click(occlusal);
    expect(onSurfaceClick).toHaveBeenCalledWith('O');
  });

  it('shows the panel glyph as one plain cell in simple mode', () => {
    const { container } = render(
      <ToothGlyph
        variant="panel"
        code="16"
        tooth={undefined}
        mode="simple"
        orientation="patient_right_on_right"
        pendingSurfaces={[]}
        onSurfaceClick={() => undefined}
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('[data-mark]')).toHaveLength(1);
  });

  it('renders the history glyph read-only at 15 px', () => {
    const { container } = render(
      <ToothGlyph
        variant="history"
        code="16"
        tooth={tooth({ code: '16', state: 'treated', surfaces: { D: 'treated' }, historyCount: 1 })}
        mode="surface"
        orientation="patient_right_on_right"
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(glyphBox(container).style.gridTemplateColumns).toBe('repeat(3, 15px)');
    expect(marks(container).D).toBe('treated');
  });
});
