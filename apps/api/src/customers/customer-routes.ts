import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

export function createCustomerRouter(prisma: PrismaClient): Router {
  const router = Router();
  const validId = /^[A-Za-z0-9_-]{1,64}$/;

  router.get('/', async (_request, response, next) => {
    try {
      const customers = await prisma.customer.findMany({
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true },
      });
      response.json(customers);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:customerId/orders', async (request, response, next) => {
    try {
      const customerId = request.params.customerId.trim();
      if (!validId.test(customerId)) {
        response.status(400).json({ error: 'customerId must be a valid identifier.' });
        return;
      }
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) {
        response.status(404).json({ error: 'Customer not found.' });
        return;
      }

      const orders = await prisma.order.findMany({
        where: { customerId: customer.id },
        orderBy: { purchasedAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          purchasedAt: true,
          currency: true,
          totalAmount: true,
          items: {
            select: { id: true, name: true, sku: true, quantity: true, unitPrice: true, isFinalSale: true },
          },
        },
      });
      response.json(orders);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
