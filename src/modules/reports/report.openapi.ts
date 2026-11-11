const dataContent = (name: string) => ({
  'application/json': {
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: `#/components/schemas/${name}` } },
    },
  },
});

const badRequest = { $ref: '#/components/responses/BadRequest' };
const unauthorized = { $ref: '#/components/responses/Unauthorized' };
const forbidden = { $ref: '#/components/responses/Forbidden' };
const serverError = { $ref: '#/components/responses/ServerError' };
const from = { $ref: '#/components/parameters/ReportFrom' };
const to = { $ref: '#/components/parameters/ReportTo' };

const tags = ['Reports'];
const security = [{ bearerAuth: [] }];
const errors = { 400: badRequest, 401: unauthorized, 403: forbidden, 500: serverError };

const cents = (description: string) => ({ type: 'integer', description });
const date = { type: 'string', format: 'date', example: '2026-03-01' };

export const reportPaths = {
  '/api/reports/summary': {
    get: {
      tags,
      summary: 'Get sales totals for a date range (needs reports.sales)',
      description:
        'Days follow Manila time, and both dates are included. Without dates, it covers the last 30 days. Totals use the amounts saved on each order, so changing the tax rate never changes past figures.',
      security,
      parameters: [from, to],
      responses: {
        200: { description: 'The totals', content: dataContent('ReportSummary') },
        ...errors,
      },
    },
  },
  '/api/reports/sales': {
    get: {
      tags,
      summary: 'Get sales per day, week, or month, for a chart (needs reports.sales)',
      description:
        'Returns a point for every period, including empty ones. Weeks start on Monday, and each point is dated by the first day of its period. A daily report can cover up to 366 days.',
      security,
      parameters: [
        from,
        to,
        {
          name: 'interval',
          in: 'query',
          schema: { type: 'string', enum: ['day', 'week', 'month'], default: 'day' },
        },
      ],
      responses: {
        200: { description: 'The points', content: dataContent('ReportSales') },
        ...errors,
      },
    },
  },
  '/api/reports/top-products': {
    get: {
      tags,
      summary: 'Get the best-selling products (needs reports.sales)',
      description:
        'Counts orders placed in the range, apart from cancelled ones. Variants are combined into their product, and inactive products are included.',
      security,
      parameters: [
        from,
        to,
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        },
        {
          name: 'sort',
          in: 'query',
          schema: { type: 'string', enum: ['quantity', 'revenue'], default: 'quantity' },
        },
      ],
      responses: {
        200: { description: 'The products', content: dataContent('ReportTopProducts') },
        ...errors,
      },
    },
  },
  '/api/reports/order-status': {
    get: {
      tags,
      summary: 'Count orders by status, and what needs doing (needs reports.operations)',
      description: 'Shows every order as it is now, with no date range.',
      security,
      responses: {
        200: { description: 'The counts', content: dataContent('ReportOrderStatus') },
        401: unauthorized,
        403: forbidden,
        500: serverError,
      },
    },
  },
  '/api/reports/low-stock': {
    get: {
      tags,
      summary: 'List variants that are running out (needs reports.operations)',
      description: 'Only variants on sale are listed, lowest stock first.',
      security,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        {
          name: 'threshold',
          in: 'query',
          description: 'Variants with this much stock or less are listed',
          schema: { type: 'integer', minimum: 0, default: 5 },
        },
      ],
      responses: {
        200: {
          description: 'The variants',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'meta'],
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/LowStockVariant' } },
                  meta: { $ref: '#/components/schemas/PageMeta' },
                },
              },
            },
          },
        },
        ...errors,
      },
    },
  },
};

export const reportParameters = {
  ReportFrom: {
    name: 'from',
    in: 'query',
    description: 'First day, in Manila time. Defaults to 29 days before `to`.',
    schema: date,
  },
  ReportTo: {
    name: 'to',
    in: 'query',
    description: 'Last day, in Manila time. Defaults to today.',
    schema: date,
  },
};

export const reportSchemas = {
  ReportSummary: {
    type: 'object',
    required: [
      'from',
      'to',
      'ordersPlaced',
      'cancelledOrders',
      'grossSalesCents',
      'averageOrderValueCents',
      'itemsSold',
      'collectedCents',
      'refundedCents',
      'netCollectedCents',
      'taxCents',
      'shippingCents',
      'newCustomers',
      'taxByRate',
    ],
    properties: {
      from: date,
      to: date,
      ordersPlaced: { type: 'integer', description: 'Every order placed, including cancelled' },
      cancelledOrders: { type: 'integer' },
      grossSalesCents: cents('Totals of orders placed, apart from cancelled ones'),
      averageOrderValueCents: cents('Gross sales divided by orders that were not cancelled'),
      itemsSold: { type: 'integer' },
      collectedCents: cents('Payments received in the range, by the day they were received'),
      refundedCents: cents('Payments received in the range that were later refunded'),
      netCollectedCents: cents('Collected minus refunded'),
      taxCents: cents('Tax on gross sales'),
      shippingCents: cents('Shipping on gross sales'),
      newCustomers: { type: 'integer', description: 'Customer accounts created in the range' },
      taxByRate: {
        type: 'array',
        description: 'Gross sales split by the tax setting each order was placed with',
        items: {
          type: 'object',
          required: ['ratePercent', 'pricesIncludeTax', 'taxableCents', 'taxCents'],
          properties: {
            ratePercent: { type: 'number', example: 12 },
            pricesIncludeTax: { type: 'boolean' },
            taxableCents: cents('Order totals without tax, including shipping'),
            taxCents: { type: 'integer' },
          },
        },
      },
    },
  },
  ReportSales: {
    type: 'object',
    required: ['from', 'to', 'interval', 'points'],
    properties: {
      from: date,
      to: date,
      interval: { type: 'string', enum: ['day', 'week', 'month'] },
      points: {
        type: 'array',
        items: {
          type: 'object',
          required: ['date', 'orders', 'grossSalesCents', 'collectedCents'],
          properties: {
            date: { ...date, description: 'First day of the period' },
            orders: { type: 'integer', description: 'Orders placed, apart from cancelled ones' },
            grossSalesCents: { type: 'integer' },
            collectedCents: { type: 'integer' },
          },
        },
      },
    },
  },
  ReportTopProducts: {
    type: 'object',
    required: ['from', 'to', 'sort', 'items'],
    properties: {
      from: date,
      to: date,
      sort: { type: 'string', enum: ['quantity', 'revenue'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['productId', 'name', 'active', 'quantity', 'revenueCents'],
          properties: {
            productId: { type: 'string', format: 'uuid' },
            name: { type: 'string', description: "The product's current name" },
            active: { type: 'boolean' },
            quantity: { type: 'integer' },
            revenueCents: cents('Line totals, without shipping'),
          },
        },
      },
    },
  },
  ReportOrderStatus: {
    type: 'object',
    required: ['counts', 'needsAttention'],
    properties: {
      counts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['status', 'paymentStatus', 'count'],
          properties: {
            status: { type: 'string', example: 'pending' },
            paymentStatus: { type: 'string', example: 'paid' },
            count: { type: 'integer' },
          },
        },
      },
      needsAttention: {
        type: 'object',
        required: ['paymentsToConfirm', 'ordersToConfirm', 'ordersToShip'],
        properties: {
          paymentsToConfirm: { type: 'integer', description: 'References waiting for an admin' },
          ordersToConfirm: { type: 'integer', description: 'Orders that are pending' },
          ordersToShip: { type: 'integer', description: 'Orders that are confirmed' },
        },
      },
    },
  },
  LowStockVariant: {
    type: 'object',
    required: [
      'variantId',
      'productId',
      'productName',
      'option1Name',
      'option1Value',
      'option2Name',
      'option2Value',
      'stock',
    ],
    properties: {
      variantId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      productName: { type: 'string' },
      option1Name: { type: ['string', 'null'] },
      option1Value: { type: ['string', 'null'] },
      option2Name: { type: ['string', 'null'] },
      option2Value: { type: ['string', 'null'] },
      stock: { type: 'integer' },
    },
  },
};
