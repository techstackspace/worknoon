const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export type Customer = { id: string; firstName: string; lastName: string };
export type OrderItem = { id: string; name: string; sku: string; quantity: number; unitPrice: string | number; isFinalSale: boolean };
export type Order = {
  id: string; orderNumber: string; purchasedAt: string; currency: string;
  totalAmount: string | number; items: OrderItem[];
};
export type AuditEntry = { id: string; eventType: string; summary: string; metadata: unknown; createdAt: string };
export type AiAudit = {
  available: boolean; confidence: number; recommendation: 'APPROVED' | 'DENIED' | 'ESCALATED';
  uncertainty: boolean; suspiciousOrConflicting: boolean; signalSummary: string;
  reasoningSummary: string; model: string; promptVersion: string;
};
export type RefundDecision = {
  outcome: 'APPROVED' | 'DENIED' | 'ESCALATED'; classification: string; reasonSummary: string;
  customerResponse: string;
  policyEvaluation: { applicableRules: string[]; reasons: string[]; humanReviewRequired: boolean; ai?: AiAudit };
  createdAt: string;
};
export type Refund = {
  id: string; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'ESCALATED'; message: string;
  requestedAmount: string | number; createdAt: string; updatedAt: string;
  customer: Customer; order: Order; decision: RefundDecision | null; auditLogs: AuditEntry[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error('Could not reach the Worknoon API. Check that the backend is running.');
  }

  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error('The API returned an unreadable response.'); }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String(payload.error)
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  customers: () => request<Customer[]>('/api/customers'),
  orders: (customerId: string) => request<Order[]>(`/api/customers/${encodeURIComponent(customerId)}/orders`),
  submitRefund: (input: { customerId: string; orderId: string; requestedAmount: number; customerMessage: string }) =>
    request<Refund>('/api/refunds', { method: 'POST', body: JSON.stringify(input) }),
  recentRefunds: () => request<Refund[]>('/api/refunds?limit=50'),
  refund: (id: string) => request<Refund>(`/api/refunds/${encodeURIComponent(id)}`),
};

export function asAmount(value: string | number): number { return Number(value); }
export function formatMoney(value: string | number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(asAmount(value));
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
