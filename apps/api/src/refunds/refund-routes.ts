import { Router } from 'express';
import { RefundService } from './refund-service.js';
import { parseRefundSubmission, RequestValidationError } from './refund-validation.js';

export function createRefundRouter(service: RefundService): Router {
  const router = Router();

  router.post('/', async (request, response, next) => {
    try {
      const input = parseRefundSubmission(request.body);
      const refund = await service.createRefund(input);
      response.status(201).json(refund);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        response.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      const queryLimit = request.query.limit;
      const limit = queryLimit === undefined ? 50 : Number(queryLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        response.status(400).json({ error: 'limit must be an integer between 1 and 100.' });
        return;
      }
      response.json(await service.listRefunds(limit));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    try {
      const refund = await service.getRefund(request.params.id);
      response.json(refund);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
