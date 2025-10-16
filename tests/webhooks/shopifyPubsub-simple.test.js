const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const CheckoutCart = require('../../models/CheckoutCart');

describe('Shopify Pub/Sub Webhook Handler - Simple Tests', () => {
  let mongoServer;
  let app;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear the database
    await CheckoutCart.deleteMany({});
    
    // Set up environment variables for fallback token
    process.env.PUBSUB_VERIFICATION_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.PUBSUB_VERIFICATION_TOKEN;
  });

  // Helper function to create a mock Express app
  const createMockApp = () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use(express.raw({ type: 'application/json' }));
    
    // Import the handler after setting up mocks
    const shopifyPubsub = require('../../webhooks/shopifyPubsub');
    app.post('/webhooks/shopify-pubsub', shopifyPubsub);
    
    return app;
  };

  // Helper function to create Pub/Sub payload
  const createPubSubPayload = (shopifyPayload, attributes = {}) => {
    const base64Data = Buffer.from(JSON.stringify(shopifyPayload)).toString('base64');
    return {
      message: {
        data: base64Data,
        messageId: 'test-message-123',
        attributes: {
          'X-Shopify-Topic': 'checkouts/create',
          'X-Shopify-Shop-Domain': 'test-shop.myshopify.com',
          'X-Shopify-Shop-Id': '12345',
          'X-Shopify-Event-Id': 'event-123',
          ...attributes
        }
      },
      subscription: 'projects/test/subscriptions/test-sub'
    };
  };

  describe('Basic Functionality', () => {
    it('should process checkout create with shared token', async () => {
      const app = createMockApp();
      
      const shopifyPayload = {
        id: 12345,
        email: 'test@example.com',
        line_items: [
          {
            product_id: 67890,
            variant_id: 11111,
            presentment_title: 'Test Product',
            quantity: 2,
            price: '29.99',
            sku: 'TEST-SKU',
            vendor: 'Test Vendor'
          }
        ]
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'checkouts/create'
      });

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);

      // Check that checkout was saved
      const savedCheckout = await CheckoutCart.findOne({ checkoutId: '12345' });
      expect(savedCheckout).toBeTruthy();
      expect(savedCheckout.email).toBe('test@example.com');
      expect(savedCheckout.shopDomain).toBe('test-shop.myshopify.com');
      expect(savedCheckout.lineItems).toHaveLength(1);
      expect(savedCheckout.lineItems[0].presentmentTitle).toBe('Test Product');
      expect(savedCheckout.status).toBe('active');
    });

    it('should process order create and mark checkout as completed', async () => {
      const app = createMockApp();
      
      // Create existing checkout
      const existingCheckout = new CheckoutCart({
        checkoutId: '12345',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        lineItems: [],
        status: 'active'
      });
      await existingCheckout.save();

      const shopifyPayload = {
        id: 67890,
        checkout_id: 12345
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'orders/create'
      });

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);

      // Check that checkout was marked as completed
      const completedCheckout = await CheckoutCart.findOne({ checkoutId: '12345' });
      expect(completedCheckout.status).toBe('completed');
      expect(completedCheckout.orderId).toBe('67890');
    });

    it('should handle invalid Pub/Sub payload', async () => {
      const app = createMockApp();
      
      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send({ invalid: 'payload' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid Pub/Sub payload');
    });

    it('should skip checkout create when no email is provided', async () => {
      const app = createMockApp();
      
      const shopifyPayload = {
        id: 12345,
        // No email field
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'checkouts/create'
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);
      expect(consoleSpy).toHaveBeenCalledWith('Skipping checkout create - no email provided');

      // Verify no checkout was saved to database
      const savedCheckouts = await CheckoutCart.find({});
      expect(savedCheckouts).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should skip checkout create when email is empty', async () => {
      const app = createMockApp();
      
      const shopifyPayload = {
        id: 12346,
        email: '', // Empty email
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'checkouts/create'
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);
      expect(consoleSpy).toHaveBeenCalledWith('Skipping checkout create - no email provided');

      // Verify no checkout was saved to database
      const savedCheckouts = await CheckoutCart.find({});
      expect(savedCheckouts).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should skip checkout create when email is null', async () => {
      const app = createMockApp();
      
      const shopifyPayload = {
        id: 12347,
        email: null, // Null email
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'checkouts/create'
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);
      expect(consoleSpy).toHaveBeenCalledWith('Skipping checkout create - no email provided');

      // Verify no checkout was saved to database
      const savedCheckouts = await CheckoutCart.find({});
      expect(savedCheckouts).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should handle unhandled topics', async () => {
      const app = createMockApp();
      
      const shopifyPayload = {
        id: 12345,
        email: 'test@example.com',
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'products/update'
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);
      expect(consoleSpy).toHaveBeenCalledWith('Unhandled Shopify topic:', 'products/update');

      consoleSpy.mockRestore();
    });
  });
});
