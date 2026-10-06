import type {
  ChartMode,
  ChartOrientation,
  Session,
  ToothCode,
  ToothNotation,
  ToothState,
} from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { sessionQueryOptions } from '@/features/auth/session';
import { ChartLegend } from './chart-legend';
import { DentalChart } from './dental-chart';

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

const teethOf = (...states: ToothState[]) =>
  new Map<ToothCode, ToothState>(states.map((state) => [state.code, state]));

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

describe('DentalChart', () => {
  afterEach(cleanup);

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

  it('marks an active diagnosis with a dot beside the number', () => {
    const teeth = teethOf(
      tooth({
        code: '36',
        hasActiveDiagnosis: true,
        titleParts: { diagnoses: ['Dental caries'], plans: [], historyCount: 0 },
      }),
    );
    renderWith(<DentalChart {...chart({ teeth })} />);

    expect(numberOf('36')?.querySelector('[data-diagnosis-dot]')).not.toBeNull();
    expect(numberOf('37')?.querySelector('[data-diagnosis-dot]')).toBeNull();
    expect(column('36').getAttribute('aria-label')).toBe(
      '#36 · Lower left first molar · Dental caries',
    );
  });

  it('keeps a diagnosed number centred over its tooth: the dot sits outside the flow', () => {
    const teeth = teethOf(tooth({ code: '36', hasActiveDiagnosis: true }));
    renderWith(<DentalChart {...chart({ teeth })} />);

    const dot = numberOf('36')?.querySelector<HTMLElement>('[data-diagnosis-dot]');
    expect(numberOf('36')?.className).toContain('relative');
    expect(dot?.className).toContain('absolute');
    expect(dot?.className).toContain('start-full');
    expect(column('36').style.width).toBe(column('37').style.width);
  });

  it.each([
    ['surface', 12, '40px'],
    ['surface', 8, '28px'],
    ['simple', 12, '28px'],
    ['simple', 8, '20px'],
  ] as const)(
    'gives every %s column at %ipx cells the glyph box’s fixed width (%s)',
    (mode, size, width) => {
      const teeth = teethOf(tooth({ code: '11', hasActiveDiagnosis: true }));
      renderWith(<DentalChart {...chart({ teeth, size })} />, { mode });

      const widths = new Set(
        [...document.querySelectorAll<HTMLElement>('[data-column]')].map(
          (element) => element.style.width,
        ),
      );
      expect([...widths]).toEqual([width]);
      const glyph = column('16').querySelector<HTMLElement>('[data-glyph]');
      const padding = Number.parseFloat(glyph?.style.padding ?? '');
      const inner =
        mode === 'simple'
          ? Number.parseFloat(glyph?.style.gridTemplateColumns ?? '')
          : size * 3 + Number.parseFloat(glyph?.style.gap ?? '') * 2;
      expect(`${String(inner + padding * 2)}px`).toBe(width);
    },
  );

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
    expect(column('16').querySelectorAll('[data-mark]')).toHaveLength(1);
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

describe('ChartLegend', () => {
  afterEach(cleanup);

  it('lists the surface legend in precedence order', () => {
    renderWith(<ChartLegend />);
    expect(legendItems()).toEqual([
      'Treated surface',
      'Whole tooth',
      'Treated today',
      'Diagnosis',
      'Planned',
      'Not finished',
    ]);
  });

  it('collapses the fill items in simple mode, and leaves Treated today out outside a visit', () => {
    renderWith(<ChartLegend />, { mode: 'simple' });
    expect(legendItems()).toEqual([
      'Treated',
      'Treated today',
      'Diagnosis',
      'Planned',
      'Not finished',
    ]);
    cleanup();
    renderWith(<ChartLegend showToday={false} />, { mode: 'simple' });
    expect(legendItems()).toEqual(['Treated', 'Diagnosis', 'Planned', 'Not finished']);
  });

  it('draws a compact ring on the planned swatch, clear of its label', () => {
    renderWith(<ChartLegend />);
    const swatchOf = (label: string) =>
      [...document.querySelectorAll<HTMLElement>('[data-legend-item]')].find(
        (item) => item.textContent === label,
      )?.firstElementChild?.className ?? '';
    expect(swatchOf('Planned')).toContain('shadow-[0_0_0_1.5px_var(--color-planned-border)]');
    expect(swatchOf('Planned')).toContain('m-[1.5px]');
  });

  it('gives every legend item the same height, so both groups line up', () => {
    renderWith(<ChartLegend />);
    const heights = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-legend-item]')].map((item) =>
        item.className.split(' ').find((name) => name.startsWith('h-')),
      ),
    );
    expect([...heights]).toEqual(['h-[15px]']);
  });
});
