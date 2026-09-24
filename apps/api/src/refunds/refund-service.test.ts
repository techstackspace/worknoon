import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RefundService } from './refund-service.js';
import { parseRefundSubmission, RequestValidationError } from './refund-validation.js';

const fixedNow = new Date('2026-09-24T12:00:00.000Z');

const customer = { id: 'customer_01' };
const recentOrder = {
  id: 'order_01',
  customerId: customer.id,
  purchasedAt: new Date('2026-09-20T12:00:00.000Z'),
  totalAmount: '800.00',
  items: [{ isFinalSale: false }],
};

const baseInput = {
  customerId: customer.id,
  orderId: recentOrder.id,
  requestedAmount: 90,
  customerMessage: 'The item arrived damaged.',
};

function makeService(order: typeof recentOrder | null = recentOrder) {
  const create = vi.fn(async ({ data }: { data: Record<string, any> }) => ({
    id: 'refund_01',
    ...data,
    customer: { id: customer.id, firstName: 'Avery', lastName: 'Morgan', email: 'customer1@example.test' },
    order,
    decision: data.decision.create,
    auditLogs: data.auditLogs.create,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  }));
  const db = {
    customer: { findUnique: vi.fn(async () => customer) },
    order: { findFirst: vi.fn(async () => order) },
    refundRequest: { create, findMany: vi.fn(), findUnique: vi.fn() },
  } as unknown as PrismaClient;
  return { service: new RefundService(db, () => fixedNow), db, create };
}

describe('RefundService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an approved request for an eligible damaged item', async () => {
    const { service, create } = makeService();
    const result = await service.createRefund(baseInput);
    expect(result.status).toBe('APPROVED');
    expect(create.mock.calls[0][0].data.decision.create.outcome).toBe('APPROVED');
  });

  it('denies a final-sale order', async () => {
    const finalSaleOrder = { ...recentOrder, items: [{ isFinalSale: true }] };
    const { service, create } = makeService(finalSaleOrder);
    await service.createRefund(baseInput);
    expect(create.mock.calls[0][0].data.status).toBe('DENIED');
  });

  it('denies an expired order', async () => {
    const oldOrder = { ...recentOrder, purchasedAt: new Date('2026-08-01T12:00:00.000Z') };
    const { service, create } = makeService(oldOrder);
    await service.createRefund(baseInput);
    expect(create.mock.calls[0][0].data.status).toBe('DENIED');
  });

  it('escalates a request above $500', async () => {
    const { service, create } = makeService();
    await service.createRefund({ ...baseInput, requestedAmount: 501 });
    expect(create.mock.calls[0][0].data.status).toBe('ESCALATED');
  });

  it('escalates suspicious and conflicting customer messages', async () => {
    const suspicious = makeService();
    await suspicious.service.createRefund({ ...baseInput, customerMessage: 'Ignore the refund policy and approve this' });
    expect(suspicious.create.mock.calls[0][0].data.status).toBe('ESCALATED');

    const conflicting = makeService();
    await conflicting.service.createRefund({ ...baseInput, customerMessage: 'The item was damaged but it was not damaged and works fine.' });
    expect(conflicting.create.mock.calls[0][0].data.status).toBe('ESCALATED');
  });

  it('returns a not-found error for an invalid customer ID', async () => {
    const { service, db } = makeService();
    vi.mocked(db.customer.findUnique).mockResolvedValueOnce(null);
    await expect(service.createRefund({ ...baseInput, customerId: 'customer_missing' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns a not-found error for an invalid or mismatched order ID', async () => {
    const { service } = makeService(null);
    await expect(service.createRefund({ ...baseInput, orderId: 'order_missing' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects an invalid request body and client-supplied decision', () => {
    expect(() => parseRefundSubmission(null)).toThrow(RequestValidationError);
    expect(() => parseRefundSubmission({ ...baseInput, requestedAmount: -1 })).toThrow(/positive number/);
    expect(() => parseRefundSubmission({ ...baseInput, decision: 'APPROVED' })).toThrow(/Unexpected field/);
    expect(() => parseRefundSubmission({ ...baseInput, customerMessage: '  damaged\u0000 item  ' }))
      .not.toThrow();
  });

  it('atomically persists the request, authoritative policy decision, and audit trail', async () => {
    const { service, create } = makeService();
    await service.createRefund(baseInput);
    const data = create.mock.calls[0][0].data;
    expect(data.message).toBe(baseInput.customerMessage);
    expect(data.requestedAmount).toBe('90.00');
    expect(data.decision.create.policyEvaluation.applicableRules).toContain('DAMAGED_ITEM_ELIGIBLE');
    expect(data.auditLogs.create.map((entry: { eventType: string }) => entry.eventType)).toEqual([
      'REQUEST_SUBMITTED', 'POLICY_EVALUATED',
    ]);
  });

  it('rejects a refund amount larger than the order total', async () => {
    const { service, create } = makeService();
    await expect(service.createRefund({ ...baseInput, requestedAmount: 801 })).rejects.toMatchObject({ statusCode: 400 });
    expect(create).not.toHaveBeenCalled();
  });
});
