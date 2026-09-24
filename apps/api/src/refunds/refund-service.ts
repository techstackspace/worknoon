import { PrismaClient, type Prisma } from '@prisma/client';
import { evaluateRefundPolicy, type ClaimType } from '../policy/refund-policy.js';
import {
  AI_PROMPT_VERSION,
  OpenAiRefundAiService,
  type RefundAiAnalysis,
  type RefundAiContext,
  type RefundAiProvider,
} from '../ai/refund-ai-service.js';

const refundDetailInclude = {
  customer: { select: { id: true, firstName: true, lastName: true } },
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

/** Basic deterministic claim-type hint used by the policy rules and AI-unavailable fallback. */
function inferClaimType(message: string): ClaimType {
  if (/\b(damaged|broken|defective|cracked|torn)\b/i.test(message)) return 'DAMAGED_ITEM';
  if (/\b(wrong|incorrect|mismatch|not what i ordered)\b/i.test(message)) return 'INCORRECT_ITEM';
  return 'OTHER';
}

export class RefundService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
    private readonly aiService: RefundAiProvider = new OpenAiRefundAiService(),
  ) {}

  async createRefund(input: CreateRefundInput): Promise<RefundDetail> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, firstName: true, lastName: true },
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

    const aiContext: RefundAiContext = {
      customer: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName },
      order: {
        orderNumber: order.orderNumber,
        purchasedAt: order.purchasedAt.toISOString(),
        currency: order.currency,
        totalAmount: Number(order.totalAmount),
        items: order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          isFinalSale: item.isFinalSale,
        })),
      },
      refund: { requestedAmount: input.requestedAmount, customerMessage: input.customerMessage },
      policy: {
        decision: policy.decision,
        applicableRules: policy.applicableRules,
        reasons: policy.reasons,
        humanReviewRequired: policy.humanReviewRequired,
      },
    };

    let aiAvailable = true;
    let ai: RefundAiAnalysis;
    try {
      ai = await this.aiService.analyze(aiContext);
    } catch {
      // The policy outcome remains usable if OpenAI is unconfigured or unavailable.
      aiAvailable = false;
      ai = {
        classification: inferClaimType(input.customerMessage),
        confidence: 0,
        reasoningSummary: 'AI analysis unavailable; deterministic refund policy applied.',
        customerResponse: 'Thank you for sharing the details of your request.',
        recommendation: policy.decision,
        uncertainty: true,
        suspiciousOrConflicting: policy.applicableRules.some((rule) =>
          rule === 'SUSPICIOUS_REQUEST' || rule === 'CONFLICTING_REQUEST'),
        signalSummary: 'AI analysis was unavailable.',
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        promptVersion: AI_PROMPT_VERSION,
      };
    }

    // Do not give free-form model text control over the decision language shown to the customer.
    const customerResponse = `${ai.customerResponse} ${policyOutcomeMessage(policy.decision)}`;
    const reasonSummary = policy.reasons.join(' ').slice(0, 1000);
    const aiAudit = {
      available: aiAvailable,
      confidence: ai.confidence,
      recommendation: ai.recommendation,
      uncertainty: ai.uncertainty,
      suspiciousOrConflicting: ai.suspiciousOrConflicting,
      signalSummary: ai.signalSummary,
      reasoningSummary: ai.reasoningSummary,
      model: ai.model,
      promptVersion: ai.promptVersion,
    };

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
            classification: ai.classification,
            reasonSummary,
            customerResponse,
            policyEvaluation: {
              applicableRules: policy.applicableRules,
              reasons: policy.reasons,
              humanReviewRequired: policy.humanReviewRequired,
              metadata: policy.metadata,
              ai: aiAudit,
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
            {
              eventType: 'DECISION_RECORDED',
              summary: `Final decision recorded from deterministic policy: ${policy.decision}.`,
              metadata: { decision: policy.decision, ai: aiAudit },
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

function policyOutcomeMessage(decision: 'APPROVED' | 'DENIED' | 'ESCALATED'): string {
  if (decision === 'APPROVED') return 'Your refund request is approved based on the order details.';
  if (decision === 'DENIED') return 'This order is not eligible for a refund under the applicable policy.';
  return 'Your request needs review by our support team before a decision is made.';
}
