/**
 * Deterministic refund policy. The 30 calendar-day window is a documented
 * product assumption; the purchase exactly 30 days before evaluation remains
 * eligible. Callers provide normalized request facts; this module makes no
 * network, database, framework, or model calls.
 *
 * Precedence: hard denials (final sale, expired window) > escalations (amount,
 * suspicious or contradictory message) > eligible claim types > ordinary
 * requests. All matching rules are recorded even when a higher-precedence
 * rule determines the outcome.
 */

export const REFUND_WINDOW_DAYS = 30;
export const HUMAN_REVIEW_AMOUNT_CENTS = 50_000;

export type Decision = 'APPROVED' | 'DENIED' | 'ESCALATED';
export type ClaimType = 'DAMAGED_ITEM' | 'INCORRECT_ITEM' | 'OTHER' | 'UNKNOWN';

export type RefundPolicyInput = {
  purchasedAt: Date;
  evaluatedAt: Date;
  amountCents: number;
  hasFinalSaleItem: boolean;
  claimType: ClaimType;
  /** Customer supplied text. It is inspected only for risk signals. */
  customerMessage: string;
};

export type PolicyRule =
  | 'FINAL_SALE'
  | 'OUTSIDE_REFUND_WINDOW'
  | 'HIGH_VALUE_REQUIRES_REVIEW'
  | 'SUSPICIOUS_REQUEST'
  | 'CONFLICTING_REQUEST'
  | 'DAMAGED_ITEM_ELIGIBLE'
  | 'INCORRECT_ITEM_ELIGIBLE'
  | 'STANDARD_ELIGIBILITY_REVIEW';

export type RefundPolicyResult = {
  decision: Decision;
  applicableRules: PolicyRule[];
  reasons: string[];
  humanReviewRequired: boolean;
  metadata: {
    refundWindowDays: number;
    ageInDays: number;
    amountCents: number;
    detectedMessageSignals: Array<'INJECTION_ATTEMPT' | 'CONTRADICTORY_CLAIM'>;
  };
};

const INJECTION_PATTERNS = [
  /ignore\b.{0,80}\b(policy|rules|instructions)\b/i,
  /\b(reveal|show|print|disclose)\b.{0,60}\b(system\s+prompt|instructions|system\s+message)\b/i,
  /\b(override|bypass)\b.{0,50}\b(policy|rules|instructions|administrator)\b/i,
  /\bapprove\s+(my|this|the)\s+refund\b/i,
  /\byou\s+are\s+now\s+(an?\s+)?administrator\b/i,
];

const CONTRADICTION_PATTERNS = [
  /\b(damaged|broken|defective)\b.{0,100}\b(not damaged|not broken|not defective|works fine|undamaged)\b/i,
  /\b(wrong|incorrect)\s+(item|product|size|color)\b.{0,100}\b(correct|right)\s+(item|product|size|color)\b/i,
  /\b(did not|didn't|never)\s+(arrive|receive|get)\b.{0,100}\b(arrived|received|got)\b/i,
];

function detectMessageSignals(message: string): RefundPolicyResult['metadata']['detectedMessageSignals'] {
  const signals: RefundPolicyResult['metadata']['detectedMessageSignals'] = [];
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(message))) signals.push('INJECTION_ATTEMPT');
  if (CONTRADICTION_PATTERNS.some((pattern) => pattern.test(message))) signals.push('CONTRADICTORY_CLAIM');
  return signals;
}

export function evaluateRefundPolicy(input: RefundPolicyInput): RefundPolicyResult {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
    throw new RangeError('amountCents must be a non-negative safe integer');
  }
  if (!Number.isFinite(input.purchasedAt.getTime()) || !Number.isFinite(input.evaluatedAt.getTime())) {
    throw new RangeError('purchasedAt and evaluatedAt must be valid dates');
  }
  if (input.evaluatedAt < input.purchasedAt) {
    throw new RangeError('evaluatedAt must not be before purchasedAt');
  }

  const ageInDays = Math.floor((input.evaluatedAt.getTime() - input.purchasedAt.getTime()) / 86_400_000);
  const signals = detectMessageSignals(input.customerMessage);
  const rules: PolicyRule[] = [];
  const reasons: string[] = [];

  if (input.hasFinalSaleItem) {
    rules.push('FINAL_SALE');
    reasons.push('Final-sale items are not eligible for a refund.');
  }
  if (ageInDays > REFUND_WINDOW_DAYS) {
    rules.push('OUTSIDE_REFUND_WINDOW');
    reasons.push(`The order is outside the ${REFUND_WINDOW_DAYS}-day refund window.`);
  }
  if (input.amountCents > HUMAN_REVIEW_AMOUNT_CENTS) {
    rules.push('HIGH_VALUE_REQUIRES_REVIEW');
    reasons.push('Refund amounts above $500 require human review.');
  }
  if (signals.includes('INJECTION_ATTEMPT')) {
    rules.push('SUSPICIOUS_REQUEST');
    reasons.push('The message contains an attempt to alter policy instructions or request privileged information.');
  }
  if (signals.includes('CONTRADICTORY_CLAIM')) {
    rules.push('CONFLICTING_REQUEST');
    reasons.push('The message contains conflicting statements about the reported issue.');
  }

  if (input.claimType === 'DAMAGED_ITEM') {
    rules.push('DAMAGED_ITEM_ELIGIBLE');
    reasons.push('Damaged items may qualify within the refund window.');
  } else if (input.claimType === 'INCORRECT_ITEM') {
    rules.push('INCORRECT_ITEM_ELIGIBLE');
    reasons.push('Incorrect items may qualify within the refund window.');
  } else {
    rules.push('STANDARD_ELIGIBILITY_REVIEW');
    reasons.push('No damaged or incorrect item claim was identified; eligibility requires review.');
  }

  const hasHardDenial = input.hasFinalSaleItem || ageInDays > REFUND_WINDOW_DAYS;
  const hasEscalation = input.amountCents > HUMAN_REVIEW_AMOUNT_CENTS || signals.length > 0;
  const decision: Decision = hasHardDenial ? 'DENIED' : hasEscalation ? 'ESCALATED' : 'APPROVED';

  return {
    decision,
    applicableRules: rules,
    reasons,
    humanReviewRequired: decision === 'ESCALATED',
    metadata: {
      refundWindowDays: REFUND_WINDOW_DAYS,
      ageInDays,
      amountCents: input.amountCents,
      detectedMessageSignals: signals,
    },
  };
}
