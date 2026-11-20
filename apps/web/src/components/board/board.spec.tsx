import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { Band, Board } from './board';
import { useRowArrival } from './board-kit';
import { TodayCard } from './today-card';

function Row({ name }: { name: string }) {
  return <li className={useRowArrival()}>{name}</li>;
}

function Harness({ initial }: { initial: { cards: string[]; rows: string[] } }) {
  const [cards, setCards] = useState(initial.cards);
  const [rows, setRows] = useState(initial.rows);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCards((current) => [...current, 'Late']);
          setRows((current) => [...current, 'Omar']);
        }}
      >
        {'more'}
      </button>
      <Board userId="u1" loading={<p>{'loading'}</p>} empty={<p>{'all clear'}</p>}>
        <Band label="Now">
          {cards.map((title) => (
            <TodayCard
              key={title}
              id={title.toLowerCase()}
              hue="amber"
              icon={null}
              title={title}
              count={title === 'Waiting' ? rows.length : undefined}
              span={5}
            >
              <ul>
                {(title === 'Waiting' ? rows : []).map((name) => (
                  <Row key={name} name={name} />
                ))}
              </ul>
            </TodayCard>
          ))}
        </Band>
        <Band label="Back office">{null}</Band>
      </Board>
    </>
  );
}

const renderBoard = (initial: { cards: string[]; rows: string[] }, wrap?: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      {wrap}
      <Harness initial={initial} />
    </QueryClientProvider>,
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

describe('Board', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('hides a band without cards, and says all clear once settled with none at all', async () => {
    renderBoard({ cards: [], rows: [] });
    expect(screen.getByText('loading')).toBeTruthy();
    expect(await screen.findByText('all clear', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Now' })).toBeNull();
  });

  it('blooms what arrives after settling, and slides in a row added to a card on screen', async () => {
    renderBoard({ cards: ['Waiting'], rows: ['Lina'] });
    const waiting = await screen.findByRole('region', { name: 'Waiting · 1' });
    expect(waiting.className).not.toContain('board-card-arrive');
    expect(screen.getByText('Lina').className).toBe('');
    expect(screen.queryByRole('group', { name: 'Back office' })).toBeNull();

    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(screen.getByRole('region', { name: 'Late' }).className).toContain('board-card-arrive');
    expect(screen.getByText('Omar').className).toBe('board-row-arrive');
    expect(screen.getByRole('region', { name: 'Waiting · 2' })).toBeTruthy();
  });

  it('remembers a collapsed card for the user', async () => {
    renderBoard({ cards: ['Waiting'], rows: ['Lina'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse Waiting' }));
    expect(screen.queryByText('Lina')).toBeNull();
    expect(JSON.parse(localStorage.getItem('dcm.today.collapsed.u1') ?? '[]')).toEqual(['waiting']);

    cleanup();
    renderBoard({ cards: ['Waiting'], rows: ['Lina'] });
    const expand = await screen.findByRole('button', { name: 'Expand Waiting' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expand);
    await waitFor(() => {
      expect(screen.getByText('Lina')).toBeTruthy();
    });
  });
});
