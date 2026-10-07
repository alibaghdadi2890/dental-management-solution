import type { ToothState } from '@dcm/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ToothGlyph } from './tooth-glyph';

function tooth(overrides: Partial<ToothState> & Pick<ToothState, 'code'>): ToothState {
  return {
    presence: 'present',
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

  it('renders a 3×3 grid of the cell size, primary teeth the same size as permanent ones', () => {
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
    expect(glyphBox(container).style.gridTemplateColumns).toBe('repeat(3, 12px)');

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
    expect(glyphBox(container).style.gridTemplateColumns).toBe('repeat(3, 8px)');
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

  it('draws a not-erupted position as one dotted box, with no surfaces and no cross', () => {
    for (const mode of ['surface', 'simple'] as const) {
      const { container } = render(
        <ToothGlyph
          variant="chart"
          code="17"
          tooth={undefined}
          mode={mode}
          orientation="patient_right_on_right"
          size={12}
          presence="not_erupted"
        />,
      );
      expect(container.querySelector('[data-glyph]')?.getAttribute('data-presence')).toBe(
        'not_erupted',
      );
      expect(container.querySelectorAll('[data-surface]')).toHaveLength(0);
      const [box, ...others] = container.querySelectorAll<HTMLElement>('[data-mark]');
      expect(others).toHaveLength(0);
      expect(box?.className).toContain('border-dotted');
      expect(container.querySelector('[data-presence-cross]')).toBeNull();
      cleanup();
    }
  });

  it('draws a missing tooth as a faded dashed box with a cross, keeping a planned wash', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="36"
        tooth={tooth({ code: '36', presence: 'missing', state: 'planned', openPlanIds: ['p'] })}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
      />,
    );
    const glyph = container.querySelector<HTMLElement>('[data-glyph]');
    expect(glyph?.getAttribute('data-presence')).toBe('missing');
    // An implant planned on a gap still shows: the ring and the wash stay.
    expect(glyph?.getAttribute('data-ring')).toBe('planned');
    expect(container.querySelectorAll('[data-surface]')).toHaveLength(0);
    const box = container.querySelector<HTMLElement>('[data-mark]');
    expect(box?.getAttribute('data-mark')).toBe('planned');
    expect(box?.className).toContain('border-dashed');
    expect(box?.className).toContain('bg-planned-bg');
    expect(box?.parentElement?.className).toContain('opacity-60');
    expect(container.querySelector('[data-presence-cross]')).not.toBeNull();
  });

  it('draws an implant as the normal glyph, at full opacity, inside a second outline with a post', () => {
    for (const mode of ['surface', 'simple'] as const) {
      const { container } = render(
        <ToothGlyph
          variant="chart"
          code="46"
          tooth={tooth({
            code: '46',
            presence: 'implant',
            state: 'treated',
            wholeTooth: 'treated',
          })}
          mode={mode}
          orientation="patient_right_on_right"
          size={12}
        />,
      );
      const glyph = container.querySelector<HTMLElement>('[data-glyph]');
      expect(glyph?.getAttribute('data-presence')).toBe('implant');
      expect(glyph?.className).toContain('outline-ink');
      expect(glyph?.className).not.toContain('opacity-60');
      // The crown on it still reads: the cells keep their treated marks.
      expect(container.querySelectorAll('[data-mark="treated"]').length).toBe(
        mode === 'surface' ? 5 : 1,
      );
      // A lower tooth's root is below it.
      expect(container.querySelector<SVGElement>('[data-implant-post]')?.style.bottom).not.toBe('');
      cleanup();
    }
  });

  it('leaves a plain natural tooth without any presence mark', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="16"
        tooth={undefined}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
      />,
    );
    const glyph = container.querySelector<HTMLElement>('[data-glyph]');
    expect(glyph?.getAttribute('data-presence')).toBe('present');
    expect(glyph?.className).not.toContain('outline-ink');
    expect(container.querySelector('[data-implant-post], [data-presence-cross]')).toBeNull();
    expect(container.querySelectorAll('[data-surface]')).toHaveLength(5);
  });

  it('edges a selected tooth’s untreated cells in the accent, keeping treated edges', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="16"
        tooth={tooth({ code: '16', state: 'treated', surfaces: { O: 'treated' }, historyCount: 1 })}
        mode="surface"
        orientation="patient_right_on_right"
        size={12}
        selected
      />,
    );

    const cell = (surface: string) =>
      container.querySelector<HTMLElement>(`[data-surface="${surface}"]`)?.classList;
    expect(cell('M')?.contains('border-primary')).toBe(true);
    expect(cell('O')?.contains('border-primary')).toBe(false);
    expect(cell('O')?.contains('border-primary-tint-strong')).toBe(true);
    expect(glyphBox(container).dataset.ring).toBe('selected');
  });

  it('accepts any cell size for previews', () => {
    const { container } = render(
      <ToothGlyph
        variant="chart"
        code="16"
        tooth={undefined}
        mode="surface"
        orientation="patient_right_on_right"
        size={9}
      />,
    );
    expect(glyphBox(container).style.gridTemplateColumns).toBe('repeat(3, 9px)');
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

    const group = screen.getByRole('group', { name: 'Tooth surfaces' });
    const occlusal = within(group).getByRole('button', { name: 'Occlusal (O) · treated' });
    expect(occlusal.textContent).toBe('O');
    expect(occlusal.getAttribute('title')).toBe('Occlusal (O) · treated');
    expect(occlusal.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Mesial (M)' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getAllByRole('button')).toHaveLength(5);

    fireEvent.click(occlusal);
    expect(onSurfaceClick).toHaveBeenCalledWith('O');
  });

  it('says a surface was treated as part of the whole tooth', () => {
    render(
      <ToothGlyph
        variant="panel"
        code="16"
        tooth={tooth({
          code: '16',
          state: 'treated',
          wholeTooth: 'treated',
          surfaces: { O: 'treated_today' },
          historyCount: 1,
        })}
        mode="surface"
        orientation="patient_right_on_right"
        onSurfaceClick={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Distal (D) · whole tooth treated' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Occlusal (O) · treated' })).toBeTruthy();
  });

  it('renders read-only panel surfaces without buttons', () => {
    render(
      <ToothGlyph
        variant="panel"
        code="16"
        tooth={undefined}
        mode="surface"
        orientation="patient_right_on_right"
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const group = screen.getByRole('group', { name: 'Tooth surfaces' });
    expect(within(group).getAllByRole('img')).toHaveLength(5);
    expect(within(group).getByRole('img', { name: 'Buccal / facial (B)' }).textContent).toBe('B');
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
