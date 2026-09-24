import { PrismaClient, type Prisma } from '@prisma/client';
import { evaluateRefundPolicy, type ClaimType } from '../policy/refund-policy.js';

const refundDetailInclude = {
  customer: { select: { id: true, firstName: true, lastName: true, email: true } },
  order: { include: { items: true } },
  decision: true,
  auditLogs: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.RefundRequestInclude;

export type RefundDetail = Prisma.RefundRequestGetPayload<{ include: typeof refundDetailInclude }>;

export type CreateRefundInput = {
  customerId: string;
  orderId: string;
  requestedAmount: number;
  customerMessage: string;
};

export class RefundServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'RefundServiceError';
  }
}

/** A small deterministic bridge until the future AI classifier is introduced. */
function inferClaimType(message: string): ClaimType {
  if (/\b(damaged|broken|defective|cracked|torn)\b/i.test(message)) return 'DAMAGED_ITEM';
  if (/\b(wrong|incorrect|mismatch|not what i ordered)\b/i.test(message)) return 'INCORRECT_ITEM';
  return 'OTHER';
}

export class RefundService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createRefund(input: CreateRefundInput): Promise<RefundDetail> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true },
    });
    if (!customer) throw new RefundServiceError('Customer not found.', 404);

    const order = await this.prisma.order.findFirst({
      where: { id: input.orderId, customerId: customer.id },
      include: { items: true },
    });
    if (!order) throw new RefundServiceError('Order not found for this customer.', 404);

    const amountCents = Math.round(input.requestedAmount * 100);
    if (amountCents > Math.round(Number(order.totalAmount) * 100)) {
      throw new RefundServiceError('Requested refund amount cannot exceed the order total.', 400);
    }

    const evaluatedAt = this.now();
    const policy = evaluateRefundPolicy({
      purchasedAt: order.purchasedAt,
      evaluatedAt,
      amountCents,
      hasFinalSaleItem: order.items.some((item) => item.isFinalSale),
      claimType: inferClaimType(input.customerMessage),
      customerMessage: input.customerMessage,
    });

    // Nested writes make request, decision, and audit creation atomic.
    return this.prisma.refundRequest.create({
      data: {
        customerId: customer.id,
        orderId: order.id,
        message: input.customerMessage,
        requestedAmount: input.requestedAmount.toFixed(2),
        status: policy.decision,
        decision: {
          create: {
            outcome: policy.decision,
            classification: inferClaimType(input.customerMessage),
            reasonSummary: policy.reasons.join(' '),
            customerResponse: policy.reasons.join(' '),
            policyEvaluation: {
              applicableRules: policy.applicableRules,
              reasons: policy.reasons,
              humanReviewRequired: policy.humanReviewRequired,
              metadata: policy.metadata,
            },
          },
        },
        auditLogs: {
          create: [
            {
              eventType: 'REQUEST_SUBMITTED',
              summary: 'Refund request submitted and evaluated by deterministic policy.',
              metadata: { customerId: customer.id, orderId: order.id },
            },
            {
              eventType: 'POLICY_EVALUATED',
              summary: `Policy decision: ${policy.decision}.`,
              metadata: { rules: policy.applicableRules, reasons: policy.reasons },
            },
          ],
        },
      },
      include: refundDetailInclude,
    });
  }

  async listRefunds(limit = 50): Promise<RefundDetail[]> {
    return this.prisma.refundRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: refundDetailInclude,
    });
  }

  async getRefund(id: string): Promise<RefundDetail> {
    const refund = await this.prisma.refundRequest.findUnique({
      where: { id },
      include: refundDetailInclude,
    });
    if (!refund) throw new RefundServiceError('Refund request not found.', 404);
    return refund;
  }
}
