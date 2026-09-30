import type {
  ChartMode,
  ChartOrientation,
  Session,
  ToothCode,
  ToothNotation,
  ToothPresence,
  ToothState,
} from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
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
    roleNames: ['Dentist'],
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
    toothStatus: [],
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
  within(screen.getByRole('group', { name: arch }))
    .getAllByRole('button')
    .map((button) => button.dataset.column);

describe('DentalChart', () => {
  afterEach(cleanup);

  it('labels teeth in FDI or Universal notation', () => {
    renderWith(<DentalChart {...chart({ dentition: 'mixed' })} />, { notation: 'fdi' });
    expect(numberOf('16')?.textContent).toBe('16');
    expect(numberOf('15')?.textContent).toBe('55');
    expect(column('16').getAttribute('aria-label')).toMatch(/^#16 · Upper right first molar · /);
    cleanup();

    renderWith(<DentalChart {...chart({ dentition: 'mixed' })} />, { notation: 'universal' });
    expect(numberOf('16')?.textContent).toBe('3');
    expect(numberOf('15')?.textContent).toBe('A');
    expect(column('16').getAttribute('aria-label')).toMatch(/^#3 · Upper right first molar · /);
    expect(column('15').getAttribute('aria-label')).toMatch(
      /^A · Upper right primary second molar · primary tooth · /,
    );
  });

  it('resolves each column to the tooth present for an 8-year-old', () => {
    renderWith(<DentalChart {...chart({ dentition: 'mixed' })} />);

    expect(numberOf('15')?.textContent).toBe('55');
    expect(numberOf('16')?.textContent).toBe('16');
    expect(numberOf('17')?.className).toContain('italic');
    expect(numberOf('16')?.className).not.toContain('italic');
    expect(column('17').getAttribute('aria-label')).toContain('not yet erupted');
  });

  it('applies the per-position presence record over the dentition stage', () => {
    const toothStatus: ToothPresence[] = [{ position: '15', present: 'permanent' }];
    renderWith(<DentalChart {...chart({ dentition: 'mixed', toothStatus })} />);

    expect(numberOf('15')?.textContent).toBe('15');
    expect(numberOf('25')?.textContent).toBe('65');
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
});

describe('ChartLegend', () => {
  afterEach(cleanup);

  it('lists the surface legend in precedence order', () => {
    renderWith(<ChartLegend dentition="permanent" />);
    expect(screen.getByText('No treatment')).toBeTruthy();
    expect(screen.getByText('Treated surface')).toBeTruthy();
    expect(screen.getByText('Whole tooth')).toBeTruthy();
    expect(screen.getByText('Treated today')).toBeTruthy();
    expect(screen.getByText('Diagnosis')).toBeTruthy();
    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.getByText('Selected')).toBeTruthy();
    expect(screen.queryByText('Primary')).toBeNull();
  });

  it('collapses the fill items in simple mode', () => {
    renderWith(<ChartLegend dentition="permanent" />, { mode: 'simple' });
    expect(screen.getByText('No treatment')).toBeTruthy();
    expect(screen.getByText('Treated')).toBeTruthy();
    expect(screen.queryByText('Treated surface')).toBeNull();
    expect(screen.queryByText('Whole tooth')).toBeNull();
  });

  it('adds the primary and not-erupted markers for a child’s dentition', () => {
    renderWith(<ChartLegend dentition="mixed" />, { notation: 'universal' });
    expect(screen.getByText('Primary')).toBeTruthy();
    expect(screen.getByText('Not erupted')).toBeTruthy();
  });
});
