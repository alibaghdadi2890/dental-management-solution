import type { CompensationStatement, StatementLine } from '@dcm/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/lib/i18n';
import { StatementView } from './statement-view';

const line = (over: Partial<StatementLine>): StatementLine => ({
  id: 'line',
  kind: 'collection',
  date: '2026-10-05',
  agreementId: null,
  visitId: null,
  visitNumber: null,
  patientId: null,
  patientName: null,
  visitType: null,
  source: 'allocation',
  reversal: false,
  base: null,
  rate: null,
  count: null,
  unitAmount: null,
  amount: '0.00',
  currency: 'USD',
  ...over,
});

const statement = (over: Partial<CompensationStatement> = {}): CompensationStatement => ({
  profileId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
  dentistName: 'Dr Alpha',
  month: '2026-10',
  status: 'provisional',
  currency: 'USD',
  agreements: [],
  earned: [
    {
      component: 'share',
      total: '152.38',
      lines: [
        line({
          id: 'a3',
          visitNumber: 3,
          patientName: 'Pat Payer',
          base: '500.00',
          rate: {
            percent: '30.48',
            blended: true,
            lines: [{ code: 'IMP', amount: '900.00', percent: '30.00' }],
          },
          amount: '152.38',
        }),
      ],
    },
  ],
  late: [],
  adjustments: [],
  payouts: [
    {
      id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70',
      profileId: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
      amount: '100.00',
      currency: 'USD',
      date: '2026-10-20',
      method: 'cash',
      reference: null,
      note: null,
      createdAt: '2026-10-20T09:00:00Z',
      voidedAt: null,
      voidReason: null,
    },
  ],
  noAgreement: [],
  notComputed: [],
  totals: {
    opening: '0.00',
    earned: '152.38',
    late: '0.00',
    adjustments: '0.00',
    payouts: '100.00',
    closing: '52.38',
  },
  closedAt: null,
  firstMonth: '2026-10',
  ...over,
});

const renderView = (props: Parameters<typeof StatementView>[0]) =>
  render(
    <TooltipProvider>
      <StatementView {...props} />
    </TooltipProvider>,
  );

describe('StatementView', () => {
  afterEach(cleanup);

  it('shows the lines with a blended rate, the provisional note and a void per payout', () => {
    const onVoidPayout = vi.fn();
    renderView({ statement: statement(), provisionalNote: true, onVoidPayout });
    expect(screen.getByText('30.48 % (blended)')).toBeTruthy();
    expect(screen.getByText('Pat Payer')).toBeTruthy();
    expect(screen.getByText(/Provisional — figures may change/)).toBeTruthy();
    screen.getByRole('button', { name: 'Void' }).click();
    expect(onVoidPayout).toHaveBeenCalledOnce();
  });

  it('offers no void on a closed month and says when the dentist owes the clinic', () => {
    renderView({
      statement: statement({
        status: 'closed',
        totals: {
          opening: '0.00',
          earned: '-200.00',
          late: '0.00',
          adjustments: '0.00',
          payouts: '0.00',
          closing: '-200.00',
        },
      }),
      provisionalNote: true,
      onVoidPayout: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
    expect(screen.queryByText(/Provisional — figures may change/)).toBeNull();
    const card = screen.getByText('Dentist owes the clinic').closest('section');
    expect(card?.textContent).toMatch(/200/);
    expect(card?.textContent).not.toContain('-');
  });

  it('explains that imported history earns nothing on an empty first month', () => {
    renderView({
      statement: statement({ earned: [], payouts: [], totals: { ...statement().totals } }),
    });
    expect(screen.getByText(/imported from the previous system were never charged/)).toBeTruthy();
  });
});
