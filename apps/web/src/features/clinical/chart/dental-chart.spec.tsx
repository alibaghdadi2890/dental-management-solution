import type {
  ChartMode,
  ChartOrientation,
  Session,
  ToothCode,
  ToothNotation,
} from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { sessionQueryOptions } from '@/features/auth/session';
import { ChartLegend } from './chart-legend';
import { teethOf, toothDiagnosis, toothService, toothState as tooth } from './chart.test-utils';
import { DentalChart } from './dental-chart';
import { chartWidth } from './fit-cell-size';
import { FittedChart } from './fitted-chart';
import { chartGlyphBox } from './glyph-style';
import { LEGEND_GROUP_LIMIT } from './legend-items';
import { setChartView } from './use-chart-view';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

interface Settings {
  mode?: ChartMode;
  notation?: ToothNotation;
  orientation?: ChartOrientation;
}

function sessionWith({
  mode = 'surface',
  notation = 'fdi',
  orientation = 'patient_right_on_right',
}: Settings): Session {
  return {
    user: { id: id(90), displayName: 'Dr. Reyes', email: 'reyes@example.com' },
    platformAdmin: false,
    mustChangePassword: false,
    tenant: {
      id: id(91),
      name: 'Northgate Dental',
      slug: 'northgate',
      timeZone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
      country: 'LB',
      chartMode: mode,
      toothNotation: notation,
      chartOrientation: orientation,
    },
    branch: null,
    branches: [],
    roles: [{ key: 'dentist', name: 'Dentist' }],
    permissions: ['visit:read'],
    idleTimeoutSeconds: 900,
  };
}

function renderWith(ui: ReactNode, settings: Settings = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(settings));
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function chart(
  props: Partial<Parameters<typeof DentalChart>[0]> = {},
): Parameters<typeof DentalChart>[0] {
  return {
    teeth: new Map(),
    dentition: 'permanent',
    size: 12,
    ...props,
  };
}

const column = (code: string) => {
  const button = document.querySelector<HTMLElement>(`[data-column="${code}"]`);
  if (!button) throw new Error(`no column ${code}`);
  return button;
};
const numberOf = (code: string) => column(code).querySelector<HTMLElement>('[data-number]');
const ringOf = (code: string) =>
  column(code).querySelector<HTMLElement>('[data-glyph]')?.dataset.ring;
const columnsOf = (arch: string) =>
  [...screen.getByRole('group', { name: arch }).querySelectorAll<HTMLElement>('[data-column]')].map(
    (element) => element.dataset.column,
  );
const legendItems = () =>
  [...document.querySelectorAll<HTMLElement>('[data-legend-item]')].map((item) => item.textContent);
const dotsOf = (code: string) =>
  [...column(code).querySelectorAll<HTMLElement>('[data-diagnosis-dot]')].map(
    (dot) => dot.dataset.diagnosisDot,
  );

/** The chart view is this browser's: each test starts from the default. */
const resetView = () => {
  cleanup();
  setChartView('both');
};

describe('DentalChart', () => {
  afterEach(resetView);

  it('labels teeth in FDI or Universal notation', () => {
    renderWith(<DentalChart {...chart()} />, { notation: 'fdi' });
    expect(numberOf('16')?.textContent).toBe('16');
    expect(column('16').getAttribute('aria-label')).toMatch(/^#16 · Upper right first molar · /);
    cleanup();

    renderWith(<DentalChart {...chart()} />, { notation: 'universal' });
    expect(numberOf('16')?.textContent).toBe('3');
    expect(column('16').getAttribute('aria-label')).toMatch(/^#3 · Upper right first molar · /);
    cleanup();

    renderWith(<DentalChart {...chart({ dentition: 'primary' })} />, { notation: 'universal' });
    expect(numberOf('15')?.textContent).toBe('A');
    expect(column('15').getAttribute('aria-label')).toMatch(
      /^A · Upper right primary second molar · primary tooth · /,
    );
  });

  it('the permanent chart has 32 teeth, the primary chart its 20', () => {
    renderWith(<DentalChart {...chart()} />);
    expect(document.querySelectorAll('[data-column]')).toHaveLength(32);
    expect(numberOf('15')?.textContent).toBe('15');
    cleanup();

    renderWith(<DentalChart {...chart({ dentition: 'primary' })} />);
    expect(document.querySelectorAll('[data-column]')).toHaveLength(20);
    expect(numberOf('15')?.textContent).toBe('55');
    expect(document.querySelector('[data-column="16"]')).toBeNull();
  });

  it('flips the column order and the R/L markers with the orientation', () => {
    renderWith(<DentalChart {...chart()} />, { orientation: 'patient_right_on_right' });
    expect(columnsOf('Upper arch').slice(0, 2)).toEqual(['28', '27']);
    expect(columnsOf('Lower arch').slice(0, 2)).toEqual(['38', '37']);
    expect(
      screen
        .getByTitle("Patient's left")
        .compareDocumentPosition(screen.getByTitle("Patient's right")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    cleanup();

    renderWith(<DentalChart {...chart()} />, { orientation: 'patient_right_on_left' });
    expect(columnsOf('Upper arch').slice(0, 2)).toEqual(['18', '17']);
    expect(columnsOf('Lower arch').slice(0, 2)).toEqual(['48', '47']);
    expect(
      screen
        .getByTitle("Patient's right")
        .compareDocumentPosition(screen.getByTitle("Patient's left")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('puts numbers above the upper arch and below the lower', () => {
    renderWith(<DentalChart {...chart()} />);
    const upper = column('16');
    const lower = column('46');
    expect(upper.firstElementChild?.hasAttribute('data-number')).toBe(true);
    expect(lower.lastElementChild?.hasAttribute('data-number')).toBe(true);
  });

  it('rings a planned tooth, and a selected tooth with a bold accent number', () => {
    const teeth = teethOf(tooth({ code: '26', state: 'planned', openPlanIds: ['p1'] }));
    renderWith(<DentalChart {...chart({ teeth, selected: '16' })} />);

    expect(ringOf('26')).toBe('planned');
    expect(ringOf('16')).toBe('selected');
    expect(ringOf('36')).toBeUndefined();
    expect(numberOf('16')?.className).toContain('font-semibold');
    expect(numberOf('16')?.className).toContain('text-primary');
    expect(numberOf('26')?.className).not.toContain('font-semibold');
  });

  it('Both view: shows the diagnoses as coloured dots between the number and the glyph', () => {
    const teeth = teethOf(
      tooth({
        code: '16',
        diagnoses: [toothDiagnosis(), toothDiagnosis({ code: 'DX-FRAC', color: 'amber' })],
      }),
      tooth({ code: '36', diagnoses: [toothDiagnosis({ surfaces: ['M'] })] }),
    );
    renderWith(<DentalChart {...chart({ teeth })} />);

    expect(document.querySelector('[data-dental-chart]')?.getAttribute('data-view')).toBe('both');
    expect(dotsOf('16')).toEqual(['rose', 'amber']);
    expect(dotsOf('37')).toEqual([]);
    // Upper: number, dots, glyph. Lower: glyph, dots, number.
    const order = (code: string) =>
      [...column(code).children].map((child) =>
        child.hasAttribute('data-number')
          ? 'number'
          : child.hasAttribute('data-dots')
            ? 'dots'
            : 'glyph',
      );
    expect(order('16')).toEqual(['number', 'dots', 'glyph']);
    expect(order('36')).toEqual(['glyph', 'dots', 'number']);
    // The dots paint no cell.
    expect(column('36').querySelector('[data-surface="M"]')?.getAttribute('data-fill')).toBe(
      'none',
    );
    expect(column('36').getAttribute('aria-label')).toBe(
      '#36 · Lower left first molar · Dental caries · M · 1 Feb 2026 · Dr Rami',
    );
    expect(column('36').getAttribute('title')).toBe(
      '#36 · Lower left first molar\nDental caries · M · 1 Feb 2026 · Dr Rami',
    );
  });

  it('keeps the rows straight: every tooth has the dot row, with dots or without', () => {
    const teeth = teethOf(tooth({ code: '36', diagnoses: [toothDiagnosis()] }));
    renderWith(<DentalChart {...chart({ teeth })} />);
    expect(document.querySelectorAll('[data-dots]')).toHaveLength(32);
    expect(column('36').style.width).toBe(column('37').style.width);
  });

  it('shows three dots and counts the rest', () => {
    const diagnoses = ['A', 'B', 'C', 'D'].map((code) => toothDiagnosis({ code }));
    renderWith(<DentalChart {...chart({ teeth: teethOf(tooth({ code: '16', diagnoses })) })} />);
    expect(dotsOf('16')).toHaveLength(3);
    expect(column('16').querySelector('[data-dot-overflow]')?.textContent).toBe('+1');
  });

  it('Diagnoses view: paints the diagnosed surface and shows no dots or services', () => {
    setChartView('diagnoses');
    const teeth = teethOf(
      tooth({
        code: '36',
        diagnoses: [toothDiagnosis({ surfaces: ['M'] })],
        services: [toothService({ surfaces: ['O'] })],
      }),
    );
    renderWith(<DentalChart {...chart({ teeth })} />);
    const fill = (surface: string) =>
      column('36').querySelector(`[data-surface="${surface}"]`)?.getAttribute('data-fill');
    expect(fill('M')).toBe('rose/today');
    expect(fill('O')).toBe('none');
    expect(document.querySelectorAll('[data-dots]')).toHaveLength(0);
    expect(column('36').getAttribute('aria-label')).not.toContain('Composite');
  });

  it('Services view: shows the services and nothing of the diagnoses', () => {
    setChartView('services');
    const teeth = teethOf(
      tooth({
        code: '36',
        diagnoses: [toothDiagnosis({ surfaces: ['M'] })],
        services: [toothService({ surfaces: ['O'] })],
      }),
    );
    renderWith(<DentalChart {...chart({ teeth })} />);
    expect(column('36').querySelector('[data-surface="O"]')?.getAttribute('data-fill')).toBe(
      'blue/past',
    );
    expect(document.querySelectorAll('[data-diagnosis-dot]')).toHaveLength(0);
    expect(column('36').getAttribute('aria-label')).not.toContain('Dental caries');
  });

  it('the compact chart is a summary: band dots, no diagnosis dots, no chips', () => {
    const teeth = teethOf(
      tooth({
        code: '16',
        diagnoses: [toothDiagnosis()],
        services: ['A', 'B', 'C', 'D'].map((code) => toothService({ code })),
      }),
    );
    renderWith(<DentalChart {...chart({ teeth, size: 8 })} />);
    expect(document.querySelectorAll('[data-dots]')).toHaveLength(0);
    expect(column('16').querySelectorAll('[data-chip]')).toHaveLength(0);
    expect(column('16').querySelectorAll('[data-band-dot]')).toHaveLength(3);
    expect(column('16').querySelector('[data-band-overflow]')).toBeNull();
  });

  it('fades every tooth that does not carry the highlighted item', () => {
    const teeth = teethOf(
      tooth({ code: '36', services: [toothService({ surfaces: ['O'] })] }),
      tooth({ code: '16', services: [toothService({ code: 'ZIR', color: 'amber' })] }),
    );
    renderWith(<DentalChart {...chart({ teeth, highlight: { kind: 'service', id: 'CMP' } })} />);
    const faded = (code: string) =>
      column(code).querySelector<HTMLElement>('[data-glyph]')?.dataset.faded;
    expect(faded('36')).toBeUndefined();
    expect(faded('16')).toBe('true');
    expect(faded('11')).toBe('true');
    expect(column('36').querySelector('[data-surface="O"]')?.getAttribute('data-ringed')).toBe(
      'true',
    );
  });

  it.each([
    ['surface', 12],
    ['surface', 8],
    ['simple', 12],
    ['simple', 8],
  ] as const)('gives every %s column at %ipx cells the glyph box’s fixed size', (mode, size) => {
    const teeth = teethOf(
      tooth({ code: '11', diagnoses: [toothDiagnosis()], services: [toothService()] }),
    );
    renderWith(<DentalChart {...chart({ teeth, size })} />, { mode });

    const box = chartGlyphBox(mode, size);
    const widths = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-column]')].map(
        (element) => element.style.width,
      ),
    );
    expect([...widths]).toEqual([`${String(box.width)}px`]);
    // Each glyph sits in a row of the glyph box's height, aligned to the occlusal plane.
    const rows = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-glyph]')].map(
        (glyph) => glyph.parentElement?.style.height,
      ),
    );
    expect([...rows]).toEqual([`${String(box.height)}px`]);
    expect(column('16').querySelector('[data-glyph]')?.parentElement?.className).toContain(
      'items-end',
    );
    expect(column('46').querySelector('[data-glyph]')?.parentElement?.className).toContain(
      'items-start',
    );
  });

  it('exposes each tooth as a labelled toggle and reports clicks', () => {
    const onToothClick = vi.fn();
    renderWith(<DentalChart {...chart({ selected: '11', onToothClick })} />);

    const selected = screen.getByRole('button', {
      name: '#11 · Upper right central incisor · no recorded treatment',
    });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.getAttribute('title')).toBe(selected.getAttribute('aria-label'));
    expect(column('21').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('button')).toHaveLength(32);

    fireEvent.click(column('21'));
    expect(onToothClick).toHaveBeenCalledWith('21');
  });

  it('omits aria-pressed on a chart without selection', () => {
    renderWith(<DentalChart {...chart({ size: 8, onToothClick: () => undefined })} />);
    expect(column('11').hasAttribute('aria-pressed')).toBe(false);
  });

  it('renders a chart without click handling as labelled images, not buttons', () => {
    renderWith(<DentalChart {...chart({ size: 8 })} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.getByRole('img', {
        name: '#11 · Upper right central incisor · no recorded treatment',
      }),
    ).toBe(column('11'));
  });

  it('shows the R/L markers on the full chart only', () => {
    renderWith(<DentalChart {...chart({ size: 8 })} />);
    expect(screen.queryByTitle("Patient's right")).toBeNull();
    expect(screen.queryByTitle("Patient's left")).toBeNull();
  });

  it('renders one cell per tooth in simple mode', () => {
    renderWith(<DentalChart {...chart()} />, { mode: 'simple' });
    expect(column('16').querySelectorAll('[data-body]')).toHaveLength(1);
    expect(column('16').querySelector('[data-surface]')).toBeNull();
  });

  it('stays left-to-right inside a right-to-left layout', () => {
    const { container } = renderWith(
      <div dir="rtl">
        <DentalChart {...chart()} />
      </div>,
    );
    const root = container.querySelector('[data-dental-chart]');
    expect(root?.getAttribute('dir')).toBe('ltr');
    expect(root?.contains(column('11'))).toBe(true);
  });

  it('reads titles in the locale’s direction but keeps numbers and glyphs left-to-right', async () => {
    await i18n.changeLanguage('ar');
    try {
      renderWith(<DentalChart {...chart({ onToothClick: () => undefined })} />);
      const tooth = column('16');
      expect(tooth.getAttribute('dir')).toBe('rtl');
      expect(numberOf('16')?.getAttribute('dir')).toBe('ltr');
      expect(tooth.querySelector('[data-glyph]')?.parentElement?.getAttribute('dir')).toBe('ltr');
      expect(screen.getByTitle('يمين المريض').getAttribute('dir')).toBe('rtl');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('FittedChart', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** A `ResizeObserver` that reports `width` once, as a browser does on `observe`. */
  const observeWidth = (width: number) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe() {
          this.callback(
            [{ contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        disconnect() {
          return undefined;
        }
      },
    );
  };
  const sizeIn = (expanded: boolean) => {
    renderWith(
      <FittedChart expanded={expanded} dentition="permanent" withAreas={false}>
        {(size) => <span data-testid="size">{size}</span>}
      </FittedChart>,
    );
    return Number(screen.getByTestId('size').textContent);
  };

  it('hands the full chart its 12 px cells', () => {
    observeWidth(2000);
    expect(sizeIn(false)).toBe(12);
  });

  it('expanded, hands the largest cell at which a jaw fits the space', () => {
    observeWidth(chartWidth({ mode: 'surface', columns: 16, withAreas: false, size: 16 }));
    expect(sizeIn(true)).toBe(16);
  });

  it('expanded, stays at 12 px where the space cannot be measured', () => {
    expect(sizeIn(true)).toBe(12);
  });

  it('draws the expanded chart’s numbers larger, with its glyphs', () => {
    renderWith(<DentalChart {...chart({ size: 18 })} />);
    const number = document.querySelector('[data-column="16"] [data-number]');
    expect(number?.className).toContain('text-[14px]');
    // Still the full chart: the R and L markers are there.
    expect(screen.getByTitle("Patient's right")).toBeTruthy();
  });
});

describe('ChartLegend', () => {
  afterEach(resetView);

  const filling = (code: string, surfaces: ('O' | 'D')[] = ['O']) =>
    tooth({ code: code as ToothCode, services: [toothService({ surfaces })] });
  const TEETH = teethOf(
    filling('36'),
    tooth({
      code: '46',
      services: [toothService({ surfaces: ['O'] })],
      diagnoses: [toothDiagnosis()],
    }),
    tooth({
      code: '16',
      services: [
        toothService({ code: 'ZIR', name: 'Zircon crown', color: 'amber', icon: 'crown' }),
      ],
    }),
    // A primary tooth: not on the permanent chart.
    tooth({ code: '55', services: [toothService({ code: 'PRIM', name: 'Pulpotomy' })] }),
  );
  const legend = (props: Partial<Parameters<typeof ChartLegend>[0]> = {}) => (
    <ChartLegend teeth={TEETH} dentition="permanent" {...props} />
  );
  const groups = () =>
    screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'));

  it('lists what is on this chart, the most widespread first, then status and tooth', () => {
    renderWith(legend());
    expect(groups()).toEqual([
      'Diagnoses on this chart',
      'Services on this chart',
      'Status',
      'Tooth',
    ]);
    expect(legendItems()).toEqual([
      'Dental caries · 1 tooth',
      'Composite filling · 2 teeth',
      'Zircon crown · 1 tooth',
      'Done today',
      'Done earlier',
      'Not finished',
      'Planned',
      'Missing',
      'Not erupted',
      'Implant',
    ]);
    // A service line is its icon on its colour; a diagnosis line a round swatch.
    const crown = document.querySelector('[data-legend-item="service:ZIR"]');
    expect(crown?.querySelector('[data-mark-icon="crown"]')).not.toBeNull();
    expect(
      document.querySelector('[data-legend-item="diagnosis:DX-CAR"] .rounded-full'),
    ).not.toBeNull();
  });

  it('follows the view and the chart on screen, and leaves an empty group out', () => {
    setChartView('services');
    renderWith(legend());
    expect(groups()).toEqual(['Services on this chart', 'Status', 'Tooth']);
    cleanup();

    setChartView('diagnoses');
    renderWith(legend());
    expect(groups()).toEqual(['Diagnoses on this chart', 'Status', 'Tooth']);
    // Without services on the teeth, no "today" or "earlier" to explain.
    expect(legendItems()).not.toContain('Done today');
    expect(legendItems()).not.toContain('Done earlier');
    cleanup();

    setChartView('both');
    renderWith(legend({ dentition: 'primary' }));
    expect(legendItems().slice(0, 1)).toEqual(['Pulpotomy · 1 tooth']);
    cleanup();

    renderWith(<ChartLegend teeth={new Map()} dentition="permanent" />);
    expect(groups()).toEqual(['Status', 'Tooth']);
  });

  it('leaves Done today out outside a visit', () => {
    renderWith(legend({ showToday: false }));
    expect(legendItems()).not.toContain('Done today');
    expect(legendItems()).toContain('Done earlier');
  });

  it('shows eight lines of a long group, then "+N more" that opens in place', () => {
    const codes = ['11', '12', '13', '14', '15', '16', '17', '18', '21', '22'] as const;
    const teeth = teethOf(
      ...codes.map((code, index) =>
        tooth({
          code,
          services: [toothService({ code: `S${String(index)}`, name: `Service ${String(index)}` })],
        }),
      ),
    );
    renderWith(<ChartLegend teeth={teeth} dentition="permanent" />);
    const lines = () => document.querySelectorAll('[data-legend-item^="service:"]');
    expect(lines()).toHaveLength(LEGEND_GROUP_LIMIT);
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
    expect(lines()).toHaveLength(10);
    expect(screen.queryByRole('button', { name: /more$/ })).toBeNull();
  });

  it('makes each line a toggle that reports the item, pressed while highlighted', () => {
    const onHighlight = vi.fn();
    renderWith(legend({ onHighlight, highlight: { kind: 'service', id: 'ZIR' } }));
    const fillings = screen.getByRole('button', { name: 'Composite filling · 2 teeth' });
    expect(fillings.getAttribute('aria-pressed')).toBe('false');
    expect(
      screen.getByRole('button', { name: 'Zircon crown · 1 tooth' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(fillings);
    expect(onHighlight).toHaveBeenCalledWith({ kind: 'service', id: 'CMP' });
    // The static lines are not buttons.
    expect(screen.queryByRole('button', { name: 'Planned' })).toBeNull();
  });

  it('without a highlight handler, lists the lines as plain text', () => {
    renderWith(legend());
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('as a key, lists the same lines under their titles, one to a line', () => {
    renderWith(legend({ layout: 'key' }));
    expect(document.querySelector('[data-legend-key]')).toBeTruthy();
    expect(groups()).toEqual([
      'Diagnoses on this chart',
      'Services on this chart',
      'Status',
      'Tooth',
    ]);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });

  it('draws the planned and not-finished swatches as rings, clear of their labels', () => {
    renderWith(legend());
    const swatchOf = (label: string) =>
      [...document.querySelectorAll<HTMLElement>('[data-legend-item]')].find(
        (item) => item.textContent === label,
      )?.firstElementChild?.className ?? '';
    expect(swatchOf('Planned')).toContain('shadow-[0_0_0_1.5px_var(--color-planned-border)]');
    expect(swatchOf('Not finished')).toContain('shadow-[0_0_0_2px_var(--color-warning-dot)]');
    expect(swatchOf('Planned')).toContain('m-[2px]');
  });

  it('gives every legend line the same height, so the groups line up', () => {
    renderWith(legend());
    const heights = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-legend-item]')].map((item) =>
        item.className.split(' ').find((name) => name.startsWith('h-')),
      ),
    );
    expect([...heights]).toEqual(['h-[15px]']);
  });
});
