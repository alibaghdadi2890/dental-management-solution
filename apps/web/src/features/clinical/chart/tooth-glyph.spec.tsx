import {
  type ChartMode,
  type ChartOrientation,
  MARK_COLORS,
  type ToothCode,
  type ToothState,
} from '@dcm/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { renderOf, toothDiagnosis, toothService, toothState } from './chart.test-utils';
import { chartGlyphBox } from './glyph-style';
import { ToothGlyph } from './tooth-glyph';
import type { ToothRenderOptions } from './tooth-render';

/** A chart glyph of `tooth` (or of an empty `code`), drawn from its `ToothRender`. */
function chartGlyph(
  tooth: ToothState | ToothCode,
  options: Partial<ToothRenderOptions> & {
    size?: number;
    orientation?: ChartOrientation;
  } = {},
) {
  const { size = 12, orientation = 'patient_right_on_right', ...rest } = options;
  const state = typeof tooth === 'string' ? undefined : tooth;
  const code = typeof tooth === 'string' ? tooth : tooth.code;
  const mode: ChartMode = rest.mode ?? 'surface';
  return render(
    <ToothGlyph
      variant="chart"
      code={code}
      render={renderOf(state, { code, ...rest })}
      mode={mode}
      orientation={orientation}
      size={size}
    />,
  ).container;
}

function fills(container: HTMLElement): Record<string, string | undefined> {
  const bySurface: Record<string, string | undefined> = {};
  for (const cell of container.querySelectorAll<HTMLElement>('[data-surface]')) {
    bySurface[cell.dataset.surface ?? ''] = cell.dataset.fill;
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
const cellOf = (container: HTMLElement, surface: string) => {
  const cell = container.querySelector<HTMLElement>(`[data-surface="${surface}"]`);
  if (!cell) throw new Error(`no surface ${surface}`);
  return cell;
};
const chipsOf = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-chip]')].map((chip) => chip.dataset.chip);

const filling = toothService({ surfaces: ['O', 'D'] });
const crown = toothService({ code: 'ZIR', name: 'Zircon crown', color: 'amber', icon: 'crown' });
const caries = toothDiagnosis({ surfaces: ['M'] });

describe('ToothGlyph: the crown', () => {
  afterEach(cleanup);

  it('Services view: paints the surfaces of a filling in its colour, at the tone of its date', () => {
    const tooth = toothState({ code: '36', services: [filling], diagnoses: [caries] });
    const container = chartGlyph(tooth, { view: 'services' });
    expect(fills(container)).toEqual({
      B: 'none',
      M: 'none',
      O: 'blue/past',
      D: 'blue/past',
      L: 'none',
    });
    expect(cellOf(container, 'O').style.backgroundColor).toBe('var(--color-mark-blue-tint)');
    expect(cellOf(container, 'M').style.backgroundColor).toBe('var(--color-surface)');
  });

  it('Diagnoses view: paints the diagnosed surface, and nothing for the services', () => {
    const tooth = toothState({ code: '36', services: [filling], diagnoses: [caries] });
    const container = chartGlyph(tooth, { view: 'diagnoses' });
    expect(fills(container)).toMatchObject({ M: 'rose/today', O: 'none', D: 'none' });
  });

  it('Both view: paints the services only; the dots are the chart’s', () => {
    const tooth = toothState({ code: '36', services: [filling], diagnoses: [caries] });
    expect(fills(chartGlyph(tooth))).toMatchObject({ M: 'none', O: 'blue/past' });
  });

  it('gives work of today the saturated fill and a 1.5 px strong edge', () => {
    const today = toothService({ surfaces: ['O'], status: 'treated_today' });
    const cell = cellOf(chartGlyph(toothState({ code: '46', services: [today] })), 'O');
    expect(cell.dataset.fill).toBe('blue/today');
    expect(cell.style.backgroundColor).toBe('var(--color-mark-blue)');
    expect(cell.style.borderColor).toBe('var(--color-mark-blue-strong)');
    expect(cell.style.borderWidth).toBe('1.5px');
  });

  it('washes every unmarked cell of a planned tooth', () => {
    const container = chartGlyph(toothState({ code: '16', openPlanIds: ['p1'] }));
    expect(new Set(Object.values(fills(container)))).toEqual(new Set(['planned/wash']));
    expect(glyphBox(container).dataset.ring).toBe('planned');
  });

  it('lays the surfaces out anatomically: mesial toward the midline, incisal on anterior teeth', () => {
    expect(surfaceOrder(chartGlyph('16'))).toEqual(['B', 'M', 'O', 'D', 'L']);
    cleanup();
    expect(surfaceOrder(chartGlyph('16', { orientation: 'patient_right_on_left' }))).toEqual([
      'B',
      'D',
      'O',
      'M',
      'L',
    ]);
    cleanup();
    expect(surfaceOrder(chartGlyph('11'))).toEqual(['B', 'M', 'I', 'D', 'L']);
  });

  it('renders one whole-tooth body in simple mode, painted by the first item', () => {
    const container = chartGlyph(toothState({ code: '16', services: [filling, crown] }), {
      mode: 'simple',
    });
    const body = container.querySelector<HTMLElement>('[data-body]');
    expect(container.querySelectorAll('[data-surface]')).toHaveLength(0);
    expect(body?.dataset.fill).toBe('blue/past');
    // 12 px cells: 26 px wide, the crown 32 px high, a 4 px radius.
    expect(body?.style.width).toBe('26px');
    expect(body?.style.height).toBe('32px');
    expect(body?.style.borderRadius).toBe('4px');
    expect(chipsOf(container)).toEqual(['service:ZIR']);
  });

  it('edges a selected tooth’s plain cells in the accent, a mark keeping its own', () => {
    const container = chartGlyph(toothState({ code: '36', services: [filling] }), {
      selected: true,
    });
    expect(glyphBox(container).dataset.ring).toBe('selected');
    expect(cellOf(container, 'M').style.borderColor).toBe('var(--color-primary)');
    expect(cellOf(container, 'O').style.borderColor).toBe('var(--color-border-control)');
  });
});

describe('ToothGlyph: the band (M4)', () => {
  afterEach(cleanup);

  it('sits at the root end: above an upper tooth, below a lower one', () => {
    const upper = glyphBox(chartGlyph(toothState({ code: '16', services: [crown] })));
    expect(upper.firstElementChild?.hasAttribute('data-band')).toBe(true);
    cleanup();
    const lower = glyphBox(chartGlyph(toothState({ code: '46', services: [crown] })));
    expect(lower.lastElementChild?.hasAttribute('data-band')).toBe(true);
  });

  it('shows a whole-tooth service as its icon on its colour', () => {
    const container = chartGlyph(toothState({ code: '16', services: [crown] }));
    expect(glyphBox(container).dataset.bandCount).toBe('1');
    const chip = container.querySelector<HTMLElement>('[data-chip="service:ZIR"]');
    expect(chip?.style.backgroundColor).toBe('var(--color-mark-amber-tint)');
    expect(chip?.querySelector('[data-mark-icon="crown"]')).not.toBeNull();
    // 12 px cells: a chip is 10 px.
    expect(chip?.style.height).toBe('10px');
    expect(chip?.style.width).toBe('10px');
  });

  it('shows a whole-tooth diagnosis as a round swatch, in the Diagnoses view', () => {
    const container = chartGlyph(
      toothState({ code: '16', diagnoses: [toothDiagnosis({ code: 'DX-PERIO', color: 'green' })] }),
      { view: 'diagnoses' },
    );
    const chip = container.querySelector<HTMLElement>('[data-chip="diagnosis:DX-PERIO"]');
    expect(chip?.className).toContain('rounded-full');
    expect(chip?.querySelector('svg')).toBeNull();
  });

  it('shows three chips and +N, narrowed to share the tooth’s width', () => {
    const services = ['A', 'B', 'C', 'D', 'E'].map((code) => toothService({ code }));
    const container = chartGlyph(toothState({ code: '16', services }));
    expect(chipsOf(container)).toEqual(['service:A', 'service:B', 'service:C']);
    expect(container.querySelector('[data-band-overflow]')?.textContent).toBe('+2');
    const widths = [...container.querySelectorAll<HTMLElement>('[data-chip]')].map((chip) =>
      Number.parseFloat(chip.style.width),
    );
    const plus = Number.parseFloat(
      container.querySelector<HTMLElement>('[data-band-overflow]')?.style.width ?? '',
    );
    // Three chips, +N and three 1 px gaps fit the 38 px crown.
    expect(widths.reduce((sum, width) => sum + width, 0) + plus + 3).toBeLessThanOrEqual(38);
    // Too narrow for an icon: the colour alone.
    expect(container.querySelector('[data-mark-icon]')).toBeNull();
  });

  it('collapses to dots on the compact chart, with no +N', () => {
    const services = ['A', 'B', 'C', 'D'].map((code) => toothService({ code }));
    const container = chartGlyph(toothState({ code: '16', services }), {
      compact: true,
      size: 8,
    });
    expect(container.querySelectorAll('[data-chip]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-band-dot]')).toHaveLength(3);
    expect(container.querySelector('[data-band-overflow]')).toBeNull();
  });

  it('rings the highlighted item’s chip and cells, and fades a tooth without it', () => {
    const highlight = { kind: 'service', id: 'ZIR' } as const;
    const container = chartGlyph(toothState({ code: '16', services: [crown] }), { highlight });
    expect(container.querySelector('[data-chip]')?.getAttribute('data-ringed')).toBe('true');
    expect(cellOf(container, 'O').dataset.ringed).toBe('true');
    expect(glyphBox(container).dataset.faded).toBeUndefined();
    cleanup();
    const other = glyphBox(
      chartGlyph(toothState({ code: '36', services: [filling] }), { highlight }),
    );
    expect(other.dataset.faded).toBe('true');
    expect(other.className).toContain('opacity-35');
  });
});

describe('ToothGlyph: size (M8)', () => {
  afterEach(cleanup);

  it.each([
    ['surface', 12, 38, 51],
    ['surface', 8, 26, 35],
    ['simple', 12, 26, 43],
    ['simple', 20, 44, 72],
  ] as const)(
    'a %s glyph at %ipx cells is %i×%i inside its padding, whatever is on it',
    (mode, size, width, height) => {
      // The box the chart reserves: the glyph plus 1 px of padding on each side.
      expect(chartGlyphBox(mode, size)).toEqual({ width: width + 2, height: height + 2 });
      for (const tooth of [
        toothState({ code: '16' }),
        toothState({ code: '16', services: [filling, crown] }),
        toothState({ code: '16', presence: 'missing' }),
      ]) {
        const box = glyphBox(chartGlyph(tooth, { mode, size }));
        const [first, second] = [...box.children] as HTMLElement[];
        const gap = Number.parseFloat(box.style.gap);
        const heightOf = (element: HTMLElement | undefined) => {
          if (!element) throw new Error('no glyph part');
          const own = Number.parseFloat(element.style.height);
          if (!Number.isNaN(own)) return own;
          // The surface grid: three rows of cells and two gaps.
          return size * 3 + Number.parseFloat(element.style.gap) * 2;
        };
        expect(heightOf(first) + gap + heightOf(second)).toBe(height);
        cleanup();
      }
    },
  );

  it('keeps primary teeth the same size as permanent ones', () => {
    const permanent = glyphBox(chartGlyph('16')).innerHTML.length;
    cleanup();
    expect(glyphBox(chartGlyph('55')).innerHTML.length).toBe(permanent);
  });
});

describe('ToothGlyph: presence (feature 7)', () => {
  afterEach(cleanup);

  it('draws a not-erupted position as one dotted box, with no surfaces, cross or band', () => {
    for (const mode of ['surface', 'simple'] as const) {
      const container = chartGlyph(toothState({ code: '17', presence: 'not_erupted' }), { mode });
      expect(glyphBox(container).dataset.presence).toBe('not_erupted');
      expect(container.querySelectorAll('[data-surface]')).toHaveLength(0);
      expect(container.querySelector('[data-presence-cross]')).toBeNull();
      expect(container.querySelector('[data-band]')).toBeNull();
      expect(container.querySelector('.border-dotted')).not.toBeNull();
      cleanup();
    }
  });

  it('draws a missing tooth as a faded dashed box with a cross, keeping a planned wash', () => {
    const container = chartGlyph(
      toothState({ code: '18', presence: 'missing', services: [crown], openPlanIds: ['p1'] }),
    );
    expect(container.querySelector('[data-presence-cross]')).not.toBeNull();
    expect(container.querySelector('.border-dashed')).not.toBeNull();
    expect(container.querySelector('[data-fill="planned/wash"]')).not.toBeNull();
    // What was done on it is in its title, not on the glyph.
    expect(container.querySelectorAll('[data-chip]')).toHaveLength(0);
    expect(glyphBox(container).dataset.ring).toBe('planned');
  });

  it('draws an implant as the normal glyph with its band, inside a second outline with a post', () => {
    const container = chartGlyph(
      toothState({ code: '24', presence: 'implant', services: [crown] }),
    );
    const box = glyphBox(container);
    expect(box.className).toContain('outline-ink');
    expect(container.querySelectorAll('[data-surface]')).toHaveLength(5);
    expect(chipsOf(container)).toEqual(['service:ZIR']);
    // The post is on the root side of the whole glyph, beyond the band.
    const post = container.querySelector<SVGElement>('[data-implant-post]');
    expect(post?.parentElement).toBe(box);
    expect(post?.style.top).not.toBe('');
  });

  it('leaves a plain natural tooth without any presence mark', () => {
    const container = chartGlyph('16');
    expect(glyphBox(container).className).not.toContain('outline-ink');
    expect(container.querySelector('[data-implant-post]')).toBeNull();
    expect(container.querySelector('[data-presence-cross]')).toBeNull();
  });
});

describe('ToothGlyph: rings and the keyboard focus (M15, D20)', () => {
  afterEach(cleanup);

  it('draws one ring: selected over in progress over planned', () => {
    const planned = toothState({ code: '16', openPlanIds: ['p1'] });
    expect(glyphBox(chartGlyph(planned)).dataset.ring).toBe('planned');
    cleanup();
    const started = { ...planned, planInProgress: true };
    expect(glyphBox(chartGlyph(started)).dataset.ring).toBe('in_progress');
    cleanup();
    expect(glyphBox(chartGlyph(started, { selected: true })).dataset.ring).toBe('selected');
    cleanup();
    expect(glyphBox(chartGlyph('16')).dataset.ring).toBeUndefined();
  });

  it.each(MARK_COLORS)(
    'keeps the selected ring on a tooth fully painted %s, today or before',
    (color) => {
      for (const status of ['treated', 'treated_today'] as const) {
        const tooth = toothState({ code: '16', services: [toothService({ color, status })] });
        const box = glyphBox(chartGlyph(tooth, { selected: true }));
        // The ring is the accent shadow around the glyph, outside every fill.
        expect(box.dataset.ring).toBe('selected');
        expect(box.className).toContain('var(--color-primary)');
        expect(new Set(Object.values(fills(box)))).toEqual(
          new Set([`${color}/${status === 'treated' ? 'past' : 'today'}`]),
        );
        cleanup();
      }
    },
  );
});

describe('ToothGlyph: the panel and history variants', () => {
  afterEach(cleanup);

  const panel = (
    tooth: ToothState,
    props: Partial<{ mode: ChartMode; onSurfaceClick: (surface: string) => void }> = {},
  ) =>
    render(
      <ToothGlyph
        variant="panel"
        code={tooth.code}
        render={renderOf(tooth, { mode: props.mode ?? 'surface' })}
        mode={props.mode ?? 'surface'}
        orientation="patient_right_on_right"
        pendingSurfaces={['M']}
        {...(props.onSurfaceClick && { onSurfaceClick: props.onSurfaceClick })}
      />,
    ).container;

  it('makes the enlarged panel surfaces toggle buttons named after what is on them', () => {
    const onSurfaceClick = vi.fn();
    panel(toothState({ code: '16', services: [toothService({ surfaces: ['O'] })] }), {
      onSurfaceClick,
    });

    const group = screen.getByRole('group', { name: 'Tooth surfaces' });
    const occlusal = within(group).getByRole('button', {
      name: 'Occlusal (O) · Composite filling',
    });
    expect(occlusal.textContent).toBe('O');
    expect(occlusal.dataset.fill).toBe('blue/past');
    expect(occlusal.style.backgroundColor).toBe('var(--color-mark-blue-tint)');
    expect(occlusal.getAttribute('aria-pressed')).toBe('false');
    // The pending surface is the accent, whatever is on it.
    const mesial = screen.getByRole('button', { name: 'Mesial (M)' });
    expect(mesial.getAttribute('aria-pressed')).toBe('true');
    expect(mesial.className).toContain('bg-primary');
    expect(screen.getAllByRole('button')).toHaveLength(5);

    fireEvent.click(occlusal);
    expect(onSurfaceClick).toHaveBeenCalledWith('O');
  });

  it('shows a planned surface as a plain one: the panel is about what is there', () => {
    const container = panel(toothState({ code: '16', openPlanIds: ['p1'] }));
    expect(container.querySelector('[data-surface="O"]')?.getAttribute('data-fill')).toBe('none');
  });

  it('renders read-only panel surfaces without buttons', () => {
    panel(toothState({ code: '16' }));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('img')).toHaveLength(5);
  });

  it('shows the panel glyph as one cell in simple mode, in the first item’s colour', () => {
    const container = panel(toothState({ code: '16', services: [crown] }), { mode: 'simple' });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('[data-body]')?.getAttribute('data-fill')).toBe('amber/past');
  });

  it('renders the history glyph read-only at 15 px, with its band', () => {
    const tooth = toothState({ code: '16', services: [crown] });
    const { container } = render(
      <ToothGlyph
        variant="history"
        code="16"
        render={renderOf(tooth)}
        mode="surface"
        orientation="patient_right_on_right"
      />,
    );
    expect(container.querySelectorAll('[data-surface]')).toHaveLength(5);
    expect(container.querySelector<HTMLElement>('[data-chip]')?.style.height).toBe('13px');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
