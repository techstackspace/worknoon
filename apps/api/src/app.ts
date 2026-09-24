import { config as loadDotEnv } from 'dotenv';
import { resolve } from 'node:path';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { PrismaClient } from '@prisma/client';
import { RefundService, RefundServiceError } from './refunds/refund-service.js';
import { createRefundRouter } from './refunds/refund-routes.js';
import { createCustomerRouter } from './customers/customer-routes.js';

loadDotEnv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });
const prisma = new PrismaClient();

export function createApp(refundService = new RefundService(prisma), database: PrismaClient = prisma) {
  const app = express();
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', async (_request, response) => {
    try {
      await database.$queryRaw`SELECT 1`;
      response.status(200).json({ status: 'ok', database: 'ok' });
    } catch {
      response.status(503).json({ status: 'unavailable', database: 'unavailable' });
    }
  });
  app.use('/api/customers', createCustomerRouter(database));
  app.use('/api/refunds', createRefundRouter(refundService));

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof RefundServiceError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body contains invalid JSON.' });
      return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json({ error: 'Request body must be 16 KB or smaller.' });
      return;
    }
    console.error('Unhandled API error:', error instanceof Error ? error.name : 'UnknownError');
    response.status(500).json({ error: 'An unexpected server error occurred.' });
  };
  app.use(errorHandler);
  return app;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
