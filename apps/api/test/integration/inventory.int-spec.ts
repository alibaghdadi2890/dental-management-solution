import type {
  AuditPage,
  Count,
  ExpenseCategory,
  ExpensePage,
  FinancialOwes,
  FinancialStock,
  ImportResult,
  InventoryCategory,
  InventoryItem,
  InventoryReport,
  ItemDetail,
  MovementPage,
  OperationalAttention,
  ReorderList,
  Role,
  StockList,
  StockReceipt,
  StockToday,
  Supplier,
  SupplierAccounts,
  SupplierPayment,
  TakeOutResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { FakeObjectStorage, sampleStart } from '../support/fake-storage';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Feature 20a through the HTTP API: the prompt's acceptance in a USD clinic in Asia/Beirut with
 * one branch; the owner, Dr. A, Sara the assistant and Jamie at the front desk; today is Thu 19
 * Nov 2026. Everyone signs in as trusted because the app clock moves a day.
 */
describe('inventory (feature 20a)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let storage: FakeObjectStorage;
  let clinic: TestClinic;
  let owner: TestAgent;
  let sara: StaffMember;
  let drA: StaffMember;
  let jamie: StaffMember;
  let viewer: StaffMember;
  let branchId: string;
  let categories: InventoryCategory[];
  let dentaLeb: Supplier;
  let gloves: InventoryItem;
  let lidocaine: InventoryItem;
  let receipt: StockReceipt;
  let payment: SupplierPayment;

  const on = (day: string, time = '10:00') => {
    testApp.clock.set(new Date(`${day}T${time}:00+02:00`));
  };
  const category = (key: string) => categories.find((row) => row.key === key)?.id ?? '';

  const problem = async (request: PromiseLike<{ status: number; body: unknown }>) => {
    const response = await request;
    const body = response.body as { code?: string; onHand?: number };
    return { status: response.status, code: body.code, onHand: body.onHand };
  };

  const stock = (agent: TestAgent = owner) =>
    ok<StockList>(agent.get(`/api/v1/inventory/stock?branchId=${branchId}`));
  const row = async (itemId: string, agent: TestAgent = owner) =>
    (await stock(agent)).rows.find((candidate) => candidate.itemId === itemId);
  const labels = async (itemId: string) =>
    ((await row(itemId))?.labels ?? []).map((label) => label.kind);
  const today = (agent: TestAgent) =>
    ok<StockToday>(agent.get(`/api/v1/inventory/today?branchId=${branchId}`));
  const takeOut = (agent: TestAgent, itemId: string, quantity: number, extra = {}, key = newId()) =>
    agent
      .post('/api/v1/inventory/take-outs')
      .set('Idempotency-Key', key)
      .send({ branchId, items: [{ itemId, quantity }], ...extra });
  const receive = (agent: TestAgent, body: Record<string, unknown>, key = newId()) =>
    agent
      .post('/api/v1/inventory/receipts')
      .set('Idempotency-Key', key)
      .send({ branchId, receivedOn: '2026-11-19', ...body });
  const saveItem = async (item: Record<string, unknown>) => {
    const [saved] = await ok<InventoryItem[]>(
      owner.put('/api/v1/inventory/items').send({ items: [item] }),
    );
    return saved as InventoryItem;
  };
  const report = (agent: TestAgent = owner, from = '2026-11-01', to = '2026-11-30') =>
    ok<InventoryReport>(agent.get(`/api/v1/inventory/reports?from=${from}&to=${to}`));
  const accounts = () => ok<SupplierAccounts>(owner.get('/api/v1/inventory/suppliers/accounts'));
  const outstanding = async () =>
    (await accounts()).suppliers.find((account) => account.supplierId === dentaLeb.id)?.outstanding;
  const supplierExpenses = async () =>
    (
      await ok<ExpensePage>(
        owner.get('/api/v1/expenses?from=2026-11-01&to=2026-11-30&includeVoided=true'),
      )
    ).items.filter((expense) => expense.source === 'supplier');

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    storage = testApp.app.get(FakeObjectStorage);
    on('2026-11-19');
    clinic = await provisionClinic(testApp, 'Inventory');
    branchId = clinic.branch.id;
    await ok(
      clinic.owner.patch('/api/v1/tenant').send({ timeZone: 'Asia/Beirut', currency: 'USD' }),
    );
    const session = await ok<{ user: { email: string } }>(clinic.owner.get('/api/v1/session'));
    owner = await signIn(testApp.app, session.user.email, undefined, { rememberMe: true });
    const remembered = async (member: StaffMember): Promise<StaffMember> => ({
      ...member,
      agent: await signIn(testApp.app, member.user.email, undefined, { rememberMe: true }),
    });
    drA = await remembered(await clinic.staff(['dentist'], 'Dr. A'));
    sara = await remembered(await clinic.staff(['assistant'], 'Sara', 'assistant'));
    jamie = await remembered(await clinic.staff(['frontdesk'], 'Jamie', 'assistant'));
    const role = await ok<Role>(owner.post('/api/v1/roles').send({ name: 'Stock viewer' }), 201);
    await ok(owner.patch(`/api/v1/roles/${role.id}`).send({ permissions: ['inventory:read'] }));
    viewer = await remembered(await clinic.staff([role.key], 'Viewer', 'other'));
    categories = await ok<InventoryCategory[]>(owner.get('/api/v1/inventory/categories'));
    dentaLeb = await ok<Supplier>(
      owner.post('/api/v1/inventory/suppliers').send({ name: 'DentaLeb', email: 'o@dentaleb.lb' }),
      201,
    );
  }, 120_000);

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('starts every clinic with the twelve categories', () => {
    expect(categories.filter((row) => row.key !== null)).toHaveLength(12);
  });

  it('adds items and refuses a second item of the same name', async () => {
    gloves = await saveItem({
      name: 'Nitrile gloves M',
      categoryId: category('disposables'),
      unit: 'piece',
      packName: 'box',
      packSize: 100,
      reorderLevel: 200,
      usualSupplierId: dentaLeb.id,
      usualOrderPacks: 5,
    });
    lidocaine = await saveItem({
      name: 'Lidocaine 2%',
      categoryId: category('anaesthetics'),
      unit: 'carpule',
      packName: 'box',
      packSize: 50,
      tracksExpiry: true,
      reorderLevel: 100,
      usualSupplierId: dentaLeb.id,
      usualOrderPacks: 4,
    });
    // A pack may hold a single unit (a box of one bottle).
    const single = await saveItem({
      name: 'Hand sanitiser',
      categoryId: category('sterilisation'),
      unit: 'bottle',
      packName: 'box',
      packSize: 1,
    });
    expect(single.packSize).toBe(1);
    const refused = await owner.put('/api/v1/inventory/items').send({
      items: [{ name: 'nitrile gloves m', categoryId: category('disposables'), unit: 'piece' }],
    });
    expect(refused.status).toBe(422);
    expect((refused.body as { errors: { path: string }[] }).errors[0]?.path).toBe('items.0.name');
  });

  it('enters opening stock through the first count: on hand, value, nothing owed', async () => {
    const count = await ok<Count>(owner.post('/api/v1/inventory/counts').send({ branchId }), 201);
    const line = count.lines.find((candidate) => candidate.itemId === gloves.id);
    expect(line?.opening).toBe(true);
    await ok(
      owner
        .put(`/api/v1/inventory/counts/${count.id}/lines/${gloves.id}`)
        .send({ counted: 300, opening: { price: '0.08', pricePer: 'unit' } }),
    );
    await ok(
      owner.post(`/api/v1/inventory/counts/${count.id}/apply`).set('Idempotency-Key', newId()),
    );
    const list = await stock();
    expect(list.rows.find((r) => r.itemId === gloves.id)?.onHand).toBe(300);
    expect(list.value).toBe('24.00');
    expect((await accounts()).total.outstanding).toBe('0.00');
    expect(await supplierExpenses()).toHaveLength(0);
  });

  it('receives without prices: stock at once, to price, no price for Sara', async () => {
    const refused = await problem(
      receive(sara.agent, {
        supplierId: dentaLeb.id,
        lines: [{ itemId: gloves.id, quantity: 500, price: '9.00', pricePer: 'pack' }],
      }),
    );
    expect(refused.status).toBe(403);
    expect(
      await problem(
        receive(sara.agent, {
          supplierId: dentaLeb.id,
          lines: [{ itemId: lidocaine.id, quantity: 200 }],
        }),
      ),
    ).toMatchObject({ status: 422, code: 'inventory.expiry_required' });
    receipt = await ok<StockReceipt>(
      receive(sara.agent, {
        supplierId: dentaLeb.id,
        invoiceNumber: 'INV-2207',
        lines: [
          { itemId: gloves.id, quantity: 500 },
          { itemId: lidocaine.id, quantity: 200, lot: 'L123', expiresOn: '2027-08-31' },
        ],
      }),
      201,
    );
    expect(receipt.toPrice).toBe(true);
    expect(receipt.total).toBeNull();
    // The invoice photo: Sara attaches it and may not open it.
    const targets = await ok<{ uploads: { id: string }[] }>(
      sara.agent
        .post(`/api/v1/inventory/receipts/${receipt.id}/files/uploads`)
        .send({ files: [{ filename: 'invoice.jpg', mimeType: 'image/jpeg', sizeBytes: 2000 }] }),
      201,
    );
    const uploadId = targets.uploads[0]?.id ?? '';
    storage.put(
      `tenants/${clinic.tenant.id}/inventory/uploads/${uploadId}`,
      2000,
      sampleStart('a.jpg'),
    );
    const attached = await ok<StockReceipt>(
      sara.agent.post(`/api/v1/inventory/receipts/${receipt.id}/files`).send({ ids: [uploadId] }),
    );
    expect(attached.files.map((file) => file.filename)).toEqual(['invoice.jpg']);
    expect(
      (await problem(sara.agent.get(`/api/v1/inventory/receipts/${receipt.id}/files/${uploadId}`)))
        .status,
    ).toBe(403);
    expect((await row(gloves.id))?.onHand).toBe(800);
    expect((await row(lidocaine.id))?.onHand).toBe(200);
    expect((await today(owner)).toPrice).toBe(1);
    expect((await today(sara.agent)).toPrice).toBeNull();
    const list = await stock();
    expect(list.value).toBe('24.00');
    expect(list.unpriced?.receipts).toBe(1);
    const locked = await owner.put('/api/v1/inventory/items').send({
      items: [{ ...gloves, packSize: 50, moved: undefined }],
    });
    expect(locked.status).toBe(422);
  });

  it('prices the receipt: owed 130, stock worth 157, no expense', async () => {
    const seen = await ok<StockReceipt>(owner.get(`/api/v1/inventory/receipts/${receipt.id}`));
    const photo = await ok<{ url: string }>(
      owner.get(`/api/v1/inventory/receipts/${receipt.id}/files/${seen.files[0]?.id ?? ''}`),
    );
    expect(photo.url).toContain('inventory/receipts');
    const { lines } = seen;
    receipt = await ok<StockReceipt>(
      owner.put(`/api/v1/inventory/receipts/${receipt.id}/prices`).send({
        lines: [
          { batchId: lines[0]?.batchId, price: '9.00', pricePer: 'pack' },
          { batchId: lines[1]?.batchId, price: '22.00', pricePer: 'pack' },
        ],
        discount: '3.00',
        charges: null,
      }),
    );
    expect(receipt.total).toBe('130.00');
    expect(await outstanding()).toBe('130.00');
    expect((await stock()).value).toBe('157.00');
    expect(await supplierExpenses()).toHaveLength(0);
  });

  it('pays the supplier: outstanding 30 and a read-only Suppliers row in Expenses', async () => {
    const key = newId();
    const pay = () =>
      owner
        .post(`/api/v1/inventory/suppliers/${dentaLeb.id}/payments`)
        .set('Idempotency-Key', key)
        .send({ paidOn: '2026-11-19', amount: '100', method: 'cash' });
    payment = await ok<SupplierPayment>(pay(), 201);
    expect((await ok<SupplierPayment>(pay(), 201)).id).toBe(payment.id);
    expect(await outstanding()).toBe('30.00');
    const rows = await supplierExpenses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: '100.00', payee: 'DentaLeb', voidedAt: null });
    const supplies = (await ok<ExpenseCategory[]>(owner.get('/api/v1/expenses/categories'))).find(
      (row) => row.key === 'supplies',
    );
    expect(rows[0]?.categoryId).toBe(supplies?.id);
    expect(
      (await problem(owner.patch(`/api/v1/expenses/${rows[0]?.id ?? ''}`).send({ amount: '1' })))
        .status,
    ).toBe(409);
  });

  it('warns of a manual expense that resembles the supplier payment, and lets it be saved', async () => {
    on('2026-11-20');
    const supplies = (await ok<ExpenseCategory[]>(owner.get('/api/v1/expenses/categories'))).find(
      (row) => row.key === 'supplies',
    );
    const expense = (body: Record<string, unknown>) =>
      owner
        .post('/api/v1/expenses')
        .set('Idempotency-Key', newId())
        .send({ spentOn: '2026-11-20', categoryId: supplies?.id, method: 'cash', ...body });
    expect(await problem(expense({ amount: '100', payee: 'dentaleb' }))).toMatchObject({
      status: 409,
      code: 'expense.resembles_supplier_payment',
    });
    // The same payee whatever the amount, spaces and case aside.
    expect(await problem(expense({ amount: '45.00', payee: 'Denta Leb' }))).toMatchObject({
      status: 409,
      code: 'expense.resembles_supplier_payment',
    });
    await ok(expense({ amount: '100', payee: 'dentaleb', allowResemblance: true }), 201);
    await ok(expense({ amount: '15.00', payee: 'Pharmacy Rima' }), 201);
  });

  it('voids the payment: the expense row is voided and 130 is owed again', async () => {
    await ok(
      owner
        .post(`/api/v1/inventory/payments/${payment.id}/void`)
        .send({ reason: 'Wrong supplier' }),
    );
    expect(await outstanding()).toBe('130.00');
    expect((await supplierExpenses())[0]?.voidedAt).not.toBeNull();
  });

  it('takes a box out, undoes it, takes it again; consumption costs it from the opening batch', async () => {
    const first = await ok<TakeOutResult>(takeOut(sara.agent, gloves.id, 100), 201);
    expect((await row(gloves.id))?.onHand).toBe(700);
    await ok(sara.agent.post(`/api/v1/inventory/movements/${first.movements[0]?.id ?? ''}/undo`));
    expect((await row(gloves.id))?.onHand).toBe(800);
    const key = newId();
    await ok(takeOut(sara.agent, gloves.id, 100, {}, key), 201);
    await ok(takeOut(sara.agent, gloves.id, 100, {}, key), 201);
    expect((await row(gloves.id))?.onHand).toBe(700);
    const consumed = (await report()).consumption.items.find((item) => item.itemId === gloves.id);
    expect(consumed).toMatchObject({ quantity: 100, cost: '8.00' });
    const saraSees = (await report(sara.agent)).consumption.items.find(
      (item) => item.itemId === gloves.id,
    );
    expect(saraSees?.cost).toBeNull();
  });

  it('turns lidocaine low, lists it to reorder, and takes it off Today once ordered', async () => {
    await ok(takeOut(sara.agent, lidocaine.id, 150), 201);
    expect((await row(lidocaine.id))?.onHand).toBe(50);
    expect(await labels(lidocaine.id)).toEqual(['low']);
    expect((await today(sara.agent)).low).toBe(1);
    const reorder = await ok<ReorderList>(
      sara.agent.get(`/api/v1/inventory/reorder?branchId=${branchId}`),
    );
    const group = reorder.groups.find((candidate) => candidate.supplierId === dentaLeb.id);
    expect(group?.items.map((item) => [item.name, item.proposed])).toEqual([['Lidocaine 2%', 4]]);
    expect(JSON.stringify(reorder)).not.toContain('price');
    await ok(
      sara.agent
        .put(`/api/v1/inventory/items/${lidocaine.id}/branches/${branchId}/ordered`)
        .send({ orderedOn: '2026-11-20' }),
      204,
    );
    expect((await row(lidocaine.id))?.labels).toEqual([{ kind: 'ordered', date: '2026-11-20' }]);
    expect((await today(sara.agent)).low).toBe(0);
  });

  it('never takes more than there is, and reports a wrong count', async () => {
    expect(await problem(takeOut(sara.agent, lidocaine.id, 60))).toEqual({
      status: 409,
      code: 'inventory.not_enough_stock',
      onHand: 50,
    });
    await ok(
      sara.agent.post(`/api/v1/inventory/items/${lidocaine.id}/report-count`).send({ branchId }),
      204,
    );
    expect(await labels(lidocaine.id)).toContain('to_count');
  });

  it('labels expiry, warns when taking expired stock and writes it off without an expense', async () => {
    const composite = await saveItem({
      name: 'Composite A2',
      categoryId: category('restorative'),
      unit: 'syringe',
      tracksExpiry: true,
    });
    await ok(
      receive(owner, {
        supplierId: dentaLeb.id,
        lines: [
          { itemId: composite.id, quantity: 3, price: '12', expiresOn: '2027-02-28' },
          { itemId: composite.id, quantity: 2, price: '12', expiresOn: '2027-01-10' },
        ],
      }),
      201,
    );
    expect((await row(composite.id))?.labels).toEqual([{ kind: 'expiring', date: '2027-01-10' }]);
    await ok(takeOut(owner, composite.id, 1), 201);
    const detail = await ok<ItemDetail>(owner.get(`/api/v1/inventory/items/${composite.id}`));
    const left = (expiry: string) =>
      detail.batches.find((batch) => batch.expiresOn === expiry)?.quantityLeft;
    expect([left('2027-01-10'), left('2027-02-28')]).toEqual([1, 3]);

    const bond = await saveItem({
      name: 'Bonding agent',
      categoryId: category('restorative'),
      unit: 'bottle',
      tracksExpiry: true,
    });
    await ok(
      receive(owner, {
        supplierId: dentaLeb.id,
        lines: [{ itemId: bond.id, quantity: 2, price: '20', expiresOn: '2026-11-15' }],
      }),
      201,
    );
    expect(await labels(bond.id)).toEqual(['expired']);
    expect(await problem(takeOut(owner, bond.id, 1))).toMatchObject({
      status: 409,
      code: 'inventory.expired_batch',
    });
    const expenses = (await supplierExpenses()).length;
    const batch = (await ok<ItemDetail>(owner.get(`/api/v1/inventory/items/${bond.id}`)))
      .batches[0];
    await ok(
      sara.agent.post('/api/v1/inventory/adjustments').set('Idempotency-Key', newId()).send({
        branchId,
        itemId: bond.id,
        batchId: batch?.id,
        reason: 'expired',
        quantity: -2,
      }),
      201,
    );
    const expired = (await report()).adjustments.find((line) => line.reason === 'expired');
    expect(expired).toMatchObject({ quantity: -2, cost: '-40.00' });
    expect(await supplierExpenses()).toHaveLength(expenses);
  });

  it('counts while work goes on: the difference is against what the system had', async () => {
    const count = await ok<Count>(
      owner
        .post('/api/v1/inventory/counts')
        .send({ branchId, categoryIds: [category('disposables')] }),
      201,
    );
    expect((await problem(owner.post('/api/v1/inventory/counts').send({ branchId }))).code).toBe(
      'inventory.count_open',
    );
    await ok(
      owner.put(`/api/v1/inventory/counts/${count.id}/lines/${gloves.id}`).send({ counted: 690 }),
    );
    await ok(takeOut(sara.agent, gloves.id, 100), 201);
    const applied = await ok<Count>(
      owner.post(`/api/v1/inventory/counts/${count.id}/apply`).set('Idempotency-Key', newId()),
    );
    expect(applied.lines.find((line) => line.itemId === gloves.id)?.difference).toBe(-10);
    expect((await row(gloves.id))?.onHand).toBe(590);
    const movements = await ok<MovementPage>(
      owner.get(`/api/v1/inventory/movements?itemId=${gloves.id}&kinds=count`),
    );
    expect(movements.items[0]).toMatchObject({ quantity: -10, reason: 'count' });
  });

  it('records a one-off purchase priced and paid, which Sara may not', async () => {
    const alcohol = await saveItem({
      name: 'Alcohol 70%',
      categoryId: category('sterilisation'),
      unit: 'bottle',
    });
    const oneOff = {
      payee: 'Pharmacy Rima',
      lines: [{ itemId: alcohol.id, quantity: 2, price: '4.00' }],
      paidNow: { paidOn: '2026-11-20', method: 'cash' },
    };
    expect((await problem(receive(sara.agent, oneOff))).status).toBe(403);
    const made = await ok<StockReceipt>(receive(owner, oneOff), 201);
    expect(made.total).toBe('8.00');
    expect((await row(alcohol.id))?.onHand).toBe(2);
    const rows = (await supplierExpenses()).filter((expense) => expense.payee === 'Pharmacy Rima');
    expect(rows.map((expense) => expense.amount)).toEqual(['8.00']);
    expect((await accounts()).suppliers.map((account) => account.name)).toEqual(['DentaLeb']);
    // Its payment goes with the receipt, never alone.
    expect(
      await problem(
        owner
          .post(`/api/v1/inventory/payments/${made.paymentId ?? ''}/void`)
          .send({ reason: 'Paid twice' }),
      ),
    ).toMatchObject({ status: 409, code: 'inventory.one_off_payment' });
    // A discount never makes a receipt owe less than nothing.
    expect(
      await problem(
        receive(owner, {
          payee: 'Pharmacy Rima',
          lines: [{ itemId: alcohol.id, quantity: 1, price: '4.00' }],
          discount: '5.00',
          paidNow: { paidOn: '2026-11-20', method: 'cash' },
        }),
      ),
    ).toMatchObject({ status: 422, code: 'inventory.negative_total' });
  });

  it('voids only an untouched receipt', async () => {
    expect(
      await problem(
        owner.post(`/api/v1/inventory/receipts/${receipt.id}/void`).send({ reason: 'Duplicate' }),
      ),
    ).toMatchObject({ status: 409, code: 'inventory.receipt_touched' });
    const before = await outstanding();
    const fresh = await ok<StockReceipt>(
      receive(owner, {
        supplierId: dentaLeb.id,
        lines: [{ itemId: gloves.id, quantity: 100, price: '9', pricePer: 'pack' }],
      }),
      201,
    );
    expect((await row(gloves.id))?.onHand).toBe(690);
    await ok(
      owner.post(`/api/v1/inventory/receipts/${fresh.id}/void`).send({ reason: 'Returned' }),
    );
    expect((await row(gloves.id))?.onHand).toBe(590);
    expect(await outstanding()).toBe(before);
  });

  it('costs stock taken before its receipt is priced once it is', async () => {
    const tips = await saveItem({
      name: 'Suction tips',
      categoryId: category('disposables'),
      unit: 'piece',
    });
    const unpriced = await ok<StockReceipt>(
      receive(sara.agent, { supplierId: dentaLeb.id, lines: [{ itemId: tips.id, quantity: 10 }] }),
      201,
    );
    await ok(takeOut(sara.agent, tips.id, 4), 201);
    const before = (await report()).consumption.items.find((item) => item.itemId === tips.id);
    expect(before).toMatchObject({ quantity: 4, cost: '0.00', unpriced: true });
    await ok(
      owner.put(`/api/v1/inventory/receipts/${unpriced.id}/prices`).send({
        lines: [{ batchId: unpriced.lines[0]?.batchId, price: '0.50', pricePer: 'unit' }],
      }),
    );
    const after = (await report()).consumption.items.find((item) => item.itemId === tips.id);
    expect(after).toMatchObject({ quantity: 4, cost: '2.00', unpriced: false });
  });

  it('gives each role its share and no money to those without it', async () => {
    for (const member of [drA, jamie]) {
      const list = await stock(member.agent);
      expect(list.value).toBeNull();
      expect(list.rows.every((r) => r.value === null)).toBe(true);
      await ok(takeOut(member.agent, gloves.id, 1), 201);
      expect(
        (await problem(member.agent.post('/api/v1/inventory/counts').send({ branchId }))).status,
      ).toBe(403);
      expect(
        (await problem(member.agent.put('/api/v1/inventory/items').send({ items: [] }))).status,
      ).toBe(403);
      expect((await problem(member.agent.get('/api/v1/inventory/suppliers/accounts'))).status).toBe(
        403,
      );
    }
    const saraReceipt = await ok<StockReceipt>(
      sara.agent.get(`/api/v1/inventory/receipts/${receipt.id}`),
    );
    expect(saraReceipt.total).toBeNull();
    expect(saraReceipt.lines.every((line) => line.price === null)).toBe(true);
    expect((await stock(viewer.agent)).rows.length).toBeGreaterThan(0);
    expect((await today(viewer.agent)).toPrice).toBeNull();
    expect((await problem(takeOut(viewer.agent, gloves.id, 1))).status).toBe(403);
  });

  it('keeps the dashboards equal to the inventory screens', async () => {
    const owes = await ok<FinancialOwes>(owner.get('/api/v1/dashboards/financial/owes'));
    expect(owes.suppliers).toBe((await accounts()).total.outstanding);
    const card = await ok<FinancialStock>(owner.get('/api/v1/dashboards/financial/stock'));
    expect(card.value).toBe((await report()).value?.total);
    const attention = await ok<OperationalAttention>(
      owner.get('/api/v1/dashboards/operational/attention'),
    );
    const low = (await stock()).rows.filter((r) => r.labels.some((label) => label.kind === 'low'));
    expect(attention.stockLow).toBe(low.length);
  });

  it('lets one of two people take the last box', async () => {
    const mask = await saveItem({
      name: 'Mask FFP2',
      categoryId: category('disposables'),
      unit: 'piece',
    });
    await ok(
      receive(owner, {
        supplierId: dentaLeb.id,
        lines: [{ itemId: mask.id, quantity: 1, price: '1' }],
      }),
      201,
    );
    const results = await Promise.all([
      takeOut(sara.agent, mask.id, 1),
      takeOut(jamie.agent, mask.id, 1),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await row(mask.id))?.onHand).toBe(0);
  });

  it('imports items and their opening stock once', async () => {
    const rows = [
      {
        code: 'IMP-1',
        name: 'Prophy paste',
        category: 'Hygiene & prevention',
        unit: 'tube',
        opening: [{ quantity: 12, unitCost: '1.50' }],
      },
      {
        code: 'IMP-2',
        name: 'Cotton rolls',
        category: 'Disposables',
        unit: 'roll',
        packName: 'bag',
        packSize: 50,
        opening: [{ quantity: 100 }],
      },
      { name: 'Endo files', category: 'Endo kit', unit: 'piece', opening: [{ quantity: 6 }] },
    ];
    const dry = await ok<ImportResult>(
      owner.post('/api/v1/imports/inventory-items').send({ dryRun: true, rows }),
    );
    expect(dry.results.map((result) => result.status)).toEqual(['created', 'created', 'created']);
    expect((await stock()).rows.some((r) => r.name === 'Prophy paste')).toBe(false);
    const run = await ok<ImportResult>(
      owner.post('/api/v1/imports/inventory-items').send({ rows }),
    );
    expect(run.results.map((result) => result.status)).toEqual(['created', 'created', 'created']);
    const again = await ok<ImportResult>(
      owner.post('/api/v1/imports/inventory-items').send({ rows }),
    );
    expect(again.results.map((result) => result.status)).toEqual(['exists', 'exists', 'exists']);
    expect((await stock()).rows.find((r) => r.name === 'Prophy paste')?.onHand).toBe(12);
  });

  it('refuses a currency change once there is inventory money', async () => {
    expect((await problem(owner.patch('/api/v1/tenant').send({ currency: 'EUR' }))).code).toBe(
      'tenant.currency_locked',
    );
  });

  it('audits every action and hides the money rows from those without inventory money', async () => {
    const feed = async (agent: TestAgent) => {
      const rows: AuditPage['items'] = [];
      let cursor: string | null = null;
      do {
        const page: AuditPage = await ok<AuditPage>(
          agent.get(
            `/api/v1/audit?feed=true&area=inventory&limit=100${cursor ? `&cursor=${cursor}` : ''}`,
          ),
        );
        rows.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== null);
      return rows;
    };
    const ownerRows = await feed(owner);
    expect(ownerRows.some((entry) => entry.action === 'inventory_payment.record')).toBe(true);
    expect(ownerRows.some((entry) => entry.action === 'inventory_receipt.price')).toBe(true);
    const drARows = await feed(drA.agent);
    expect(drARows.some((entry) => entry.action === 'inventory_movement.take_out')).toBe(true);
    expect(drARows.some((entry) => entry.action.startsWith('inventory_payment'))).toBe(false);
    expect(drARows.some((entry) => entry.action === 'inventory_receipt.price')).toBe(false);
  });
});
