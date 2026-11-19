import type { Permission, Session, StockRow } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  id,
  json,
  listItem,
  mockApi,
  patient,
  sent,
  sessionWith,
} from '@/features/patients/patients.test-utils';
import { renderShell } from '@/shell/shell.test-utils';

const BRANCH = id(70);

function stockSession(permissions: Permission[]): Session {
  const session = sessionWith(permissions);
  return {
    ...session,
    branch: { id: BRANCH, name: 'Main' },
    branches: [{ id: BRANCH, name: 'Main' }],
  };
}

const row = (n: number, name: string, extra: Partial<StockRow> = {}): StockRow => ({
  itemId: id(20 + n),
  name,
  code: null,
  categoryId: id(30),
  unit: 'piece',
  packName: 'box',
  packSize: 100,
  tracksExpiry: false,
  active: true,
  usualSupplierId: null,
  onHand: 300,
  reorderLevel: null,
  labels: [],
  value: null,
  ...extra,
});

const GLOVES = row(1, 'Nitrile gloves M', { code: 'GLV-M' });
const STOCK = [
  GLOVES,
  row(2, 'Gauze pads', { onHand: 0, labels: [{ kind: 'out', date: null }] }),
  row(3, 'Old gloves', { active: false }),
];

const movement = (itemId: string, quantity: number) => ({
  id: id(40),
  actionId: id(41),
  kind: 'take_out',
  itemId,
  itemName: GLOVES.name,
  unit: 'piece',
  packName: 'box',
  packSize: 100,
  branchId: BRANCH,
  quantity: -quantity,
  reason: null,
  note: null,
  occurredOn: '2026-11-19',
  createdAt: '2026-11-19T09:00:00.000Z',
  createdByName: 'Jamie Ortiz',
  receiptId: null,
  receiptNumber: null,
  countId: null,
  reversesId: null,
  reversedAt: null,
  reversalReason: null,
  cost: null,
  canUndo: true,
});

const RECENT = '/patients?sort=recent&size=10';
const page = (items: unknown[]) => json({ items, total: items.length, page: 1, size: 10 });

/** The stock of the branch, an empty patient search, and a take-out that answers one movement. */
function mockStock() {
  return mockApi({
    get: (path) => {
      if (path === `/inventory/stock?branchId=${BRANCH}`) {
        return json({
          branchId: BRANCH,
          currency: 'USD',
          today: '2026-11-19',
          rows: STOCK,
          value: null,
          unpriced: null,
        });
      }
      if (path === RECENT) return page([listItem(patient(1, 'Rana Haddad'))]);
      if (path.startsWith('/patients?q=')) return page([]);
      if (path.startsWith('/contacts/lookup')) return json([]);
      return undefined;
    },
    mutation: (method, path, body) => {
      if (method === 'POST' && path === '/inventory/take-outs') {
        const { items } = body as { items: { itemId: string; quantity: number }[] };
        return json({ movements: items.map((item) => movement(item.itemId, item.quantity)) }, 201);
      }
      if (method === 'POST' && path === `/inventory/movements/${id(40)}/undo`) {
        return json({ ...movement(GLOVES.itemId, 100), reversedAt: '2026-11-19T09:01:00.000Z' });
      }
      return undefined;
    },
  });
}

const EVERYTHING: Permission[] = [
  'patient:read',
  'patient:write',
  'inventory:read',
  'inventory:write',
];

async function openSearch(permissions = EVERYTHING, button = 'Search') {
  const shell = renderShell({ url: '/visits', session: stockSession(permissions) });
  fireEvent.click(await screen.findByRole('button', { name: button }));
  const dialog = await screen.findByRole('dialog', { name: button });
  return { ...shell, dialog, input: within(dialog).getByRole('combobox') };
}

const type = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
};

describe('SearchPalette — stock items (search S5–S8)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('finds active items by name or code, under Stock, with what is on hand', async () => {
    mockStock();
    const { dialog, input } = await openSearch();
    type(input, 'gloves');
    const stock = await within(dialog).findByRole('rowgroup', { name: 'Stock' });
    const rows = within(stock).getAllByRole('row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Nitrile gloves M');
    expect(rows[0]?.textContent).toContain('GLV-M');
    expect(rows[0]?.textContent).toContain('3 boxes');
    type(input, 'glv-m');
    expect(await within(dialog).findByText('Nitrile gloves M')).toBeTruthy();
  });

  it('offers Take out only for an item with stock', async () => {
    mockStock();
    const { dialog, input } = await openSearch();
    type(input, 'e');
    const stock = await within(dialog).findByRole('rowgroup', { name: 'Stock' });
    const gloves = within(stock).getByRole('row', { name: /Nitrile gloves/ });
    const gauze = within(stock).getByRole('row', { name: /Gauze pads/ });
    expect(within(gloves).getByRole('button', { name: 'Take out' })).toBeTruthy();
    expect(within(gauze).queryByRole('button', { name: 'Take out' })).toBeNull();
    expect(gauze.textContent).toContain('Out');
  });

  it('takes out one box from the search, over the page, and offers Undo', async () => {
    const fetchMock = mockStock();
    const { dialog, input, location } = await openSearch();
    type(input, 'nitrile');
    const takeOut = await within(dialog).findByRole('button', { name: 'Take out' });
    fireEvent.click(takeOut);
    const panel = await screen.findByRole('dialog', { name: 'Take out' });
    expect(location().pathname).toBe('/visits');
    const quantity = within(panel).getByRole<HTMLInputElement>('textbox', { name: 'Quantity' });
    await waitFor(() => {
      expect(document.activeElement).toBe(quantity);
    });
    expect(quantity.value).toBe('1');
    expect(within(panel).getByRole<HTMLSelectElement>('combobox').value).toBe(GLOVES.itemId);
    fireEvent.click(within(panel).getByRole('button', { name: 'Take out' }));
    expect(
      await screen.findByText('100 pieces · 1 box of Nitrile gloves M taken out'),
    ).toBeTruthy();
    expect(sent(fetchMock, 'POST', '/inventory/take-outs')).toMatchObject({
      branchId: BRANCH,
      items: [{ itemId: GLOVES.itemId, quantity: 100 }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Put back')).toBeTruthy();
  });

  it('reaches Take out with the arrow keys and runs it with Enter', async () => {
    mockStock();
    const { dialog, input } = await openSearch();
    type(input, 'nitrile');
    const gloves = await within(dialog).findByRole('row', { name: /Nitrile gloves/ });
    const [open, action] = within(gloves).getAllByRole('gridcell');
    expect(input.getAttribute('aria-activedescendant')).toBe(open?.id);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(input.getAttribute('aria-activedescendant')).toBe(action?.id);
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(input.getAttribute('aria-activedescendant')).toBe(open?.id);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Take out' })).toBeTruthy();
  });

  it('opens the item on the Stock tab when the row is tapped', async () => {
    mockStock();
    const { dialog, input, router } = await openSearch();
    type(input, 'nitrile');
    fireEvent.click(await within(dialog).findByText('Nitrile gloves M'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/inventory');
    });
    expect(router.state.location.search).toEqual({ branch: BRANCH, item: GLOVES.itemId });
  });

  it('has no Take out without inventory:write', async () => {
    mockStock();
    const { dialog, input } = await openSearch(['patient:read', 'inventory:read']);
    type(input, 'nitrile');
    expect(await within(dialog).findByText('Nitrile gloves M')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Take out' })).toBeNull();
  });

  it('searches only stock without patient:read, and offers no Create', async () => {
    const fetchMock = mockStock();
    const { dialog, input } = await openSearch(['inventory:read'], 'Search stock');
    expect(within(dialog).getByText('Type an item’s name or code.')).toBeTruthy();
    type(input, 'zzz');
    expect(await within(dialog).findByText('Nothing matches "zzz"')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Create/ })).toBeNull();
    const patientCalls = fetchMock.mock.calls.filter(([url]) => url.includes('/patients'));
    expect(patientCalls).toEqual([]);
  });

  it('keeps Find patient for whoever searches patients only', async () => {
    mockStock();
    const { dialog } = await openSearch(['patient:read'], 'Find patient');
    expect(await within(dialog).findByText('Rana Haddad')).toBeTruthy();
  });
});
