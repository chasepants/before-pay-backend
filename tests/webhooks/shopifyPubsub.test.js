const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const CheckoutCart = require('../../models/CheckoutCart');

// Mock the OAuth2Client
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn()
  }))
}));

const { OAuth2Client } = require('google-auth-library');

describe('Shopify Pub/Sub Webhook Handler', () => {
  let mongoServer;
  let app;
  let mockOAuthClient;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
    
    // Mock the OAuth client
    mockOAuthClient = new OAuth2Client();
    mockOAuthClient.verifyIdToken = jest.fn();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear the database
    await CheckoutCart.deleteMany({});
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up environment variables
    process.env.PUBSUB_JWT_AUDIENCE = 'https://api-sandbox.gostashpay.com/api/webhooks/shopify-pubsub';
    process.env.PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
    process.env.PUBSUB_VERIFICATION_TOKEN = 'test-token';
    
    // Reset the OAuth client mock
    mockOAuthClient.verifyIdToken.mockClear();
  });

  afterEach(() => {
    delete process.env.PUBSUB_JWT_AUDIENCE;
    delete process.env.PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL;
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

  describe('JWT Authentication', () => {
    it('should accept valid shared token', async () => {
      const app = createMockApp();
      
      // Mock successful JWT verification
      mockOAuthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@example.com',
          iss: 'https://accounts.google.com',
          aud: 'https://api-sandbox.gostashpay.com/api/webhooks/shopify-pubsub'
        })
      });

      const shopifyPayload = {
        id: 12345,
        email: 'test@example.com',
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload);

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);
    });

    it('should reject invalid JWT token', async () => {
      const app = createMockApp();
      
      // Mock JWT verification failure
      mockOAuthClient.verifyIdToken.mockRejectedValue(new Error('Invalid token'));

      const shopifyPayload = {
        id: 12345,
        email: 'test@example.com',
        total_price: '99.99',
        currency: 'USD',
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload);

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('Authorization', 'Bearer invalid-jwt-token')
        .send(pubSubPayload);

      expect(response.status).toBe(400);
      expect(response.text).toBe('Invalid token');
    });

    it('should fallback to shared token when no JWT', async () => {
      const app = createMockApp();
      
      const shopifyPayload = {
        id: 12345,
        email: 'test@example.com',
        total_price: '99.99',
        currency: 'USD',
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload);

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);
    });
  });

  describe('Checkout Create Handler', () => {
    it('should save new checkout to database', async () => {
      const app = createMockApp();
      
      mockOAuthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@example.com',
          iss: 'https://accounts.google.com'
        })
      });

      const shopifyPayload = {
        id: 12345,
        email: 'test@example.com',

        line_items: [
          {
            product_id: 67890,
            variant_id: 11111,
            title: 'Test Product',
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
      expect(savedCheckout.shopId).toBe('12345');
      expect(savedCheckout.lineItems).toHaveLength(1);
      expect(savedCheckout.lineItems[0].title).toBe('Test Product');
      expect(savedCheckout.status).toBe('active');
    });

    it('should update existing checkout', async () => {
      const app = createMockApp();
      
      // Create existing checkout
      const existingCheckout = new CheckoutCart({
        checkoutId: '12345',
        email: 'old@example.com',
        shopDomain: 'old-shop.myshopify.com',
        shopId: '99999',
        lineItems: [],
        status: 'active'
      });
      await existingCheckout.save();

      mockOAuthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@example.com',
          iss: 'https://accounts.google.com'
        })
      });

      const shopifyPayload = {
        id: 12345,
        email: 'new@example.com',
        total_price: '99.99',
        currency: 'USD',
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'checkouts/create'
      });

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);

      // Check that checkout was updated
      const updatedCheckout = await CheckoutCart.findOne({ checkoutId: '12345' });
      expect(updatedCheckout.email).toBe('new@example.com');
      expect(updatedCheckout.shopDomain).toBe('test-shop.myshopify.com');
    });
  });

  describe('Order Create Handler', () => {
    it('should mark checkout as completed when order is created', async () => {
      const app = createMockApp();
      
      // Create existing checkout
      const existingCheckout = new CheckoutCart({
        checkoutId: '12345',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        shopId: '12345',
        lineItems: [],
        status: 'active'
      });
      await existingCheckout.save();

      mockOAuthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@example.com',
          iss: 'https://accounts.google.com'
        })
      });

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

    it('should handle order without checkout_id gracefully', async () => {
      const app = createMockApp();
      
      mockOAuthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@example.com',
          iss: 'https://accounts.google.com'
        })
      });

      const shopifyPayload = {
        id: 67890
        // No checkout_id
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'orders/create'
      });

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(204);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid Pub/Sub payload', async () => {
      const app = createMockApp();
      
      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send({ invalid: 'payload' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid Pub/Sub payload');
    });

    it('should handle database errors gracefully', async () => {
      const app = createMockApp();
      
      // Mock database error
      jest.spyOn(CheckoutCart, 'findOne').mockRejectedValue(new Error('Database error'));

      mockOAuthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@example.com',
          iss: 'https://accounts.google.com'
        })
      });

      const shopifyPayload = {
        id: 12345,
        email: 'test@example.com',
        total_price: '99.99',
        currency: 'USD',
        line_items: []
      };

      const pubSubPayload = createPubSubPayload(shopifyPayload, {
        'X-Shopify-Topic': 'checkouts/create'
      });

      const response = await request(app)
        .post('/webhooks/shopify-pubsub')
        .set('x-pubsub-token', 'test-token')
        .send(pubSubPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('Unhandled Topics', () => {
    it('should log unhandled topics', async () => {
      const app = createMockApp();
      
      mockOAuthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@example.com',
          iss: 'https://accounts.google.com'
        })
      });

      const shopifyPayload = {
        id: 12345,
        email: 'test@example.com',
        total_price: '99.99',
        currency: 'USD',
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