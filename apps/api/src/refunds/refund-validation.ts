import type { CreateRefundInput } from './refund-service.js';

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const allowedFields = new Set(['customerId', 'orderId', 'requestedAmount', 'customerMessage']);

export function parseRefundSubmission(value: unknown): CreateRefundInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestValidationError('Request body must be a JSON object.');
  }

  const body = value as Record<string, unknown>;
  const unexpectedField = Object.keys(body).find((key) => !allowedFields.has(key));
  if (unexpectedField) throw new RequestValidationError(`Unexpected field: ${unexpectedField}.`);

  if (typeof body.customerId !== 'string' || !idPattern.test(body.customerId.trim())) {
    throw new RequestValidationError('customerId must be a valid identifier.');
  }
  if (typeof body.orderId !== 'string' || !idPattern.test(body.orderId.trim())) {
    throw new RequestValidationError('orderId must be a valid identifier.');
  }
  if (typeof body.requestedAmount !== 'number' || !Number.isFinite(body.requestedAmount) || body.requestedAmount <= 0) {
    throw new RequestValidationError('requestedAmount must be a positive number in dollars.');
  }
  if (!Number.isSafeInteger(Math.round(body.requestedAmount * 100))) {
    throw new RequestValidationError('requestedAmount is outside the supported range.');
  }
  if (Math.round(body.requestedAmount * 100) !== body.requestedAmount * 100) {
    throw new RequestValidationError('requestedAmount may have at most two decimal places.');
  }
  if (typeof body.customerMessage !== 'string') {
    throw new RequestValidationError('customerMessage must be a string.');
  }

  // Remove NUL and disallowed control characters; retain normal line breaks/tabs.
  const customerMessage = body.customerMessage.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (customerMessage.length < 3) throw new RequestValidationError('customerMessage must contain at least 3 characters.');
  if (customerMessage.length > 5000) throw new RequestValidationError('customerMessage must be 5000 characters or fewer.');

  return {
    customerId: body.customerId.trim(),
    orderId: body.orderId.trim(),
    requestedAmount: body.requestedAmount,
    customerMessage,
  };
}
