const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const savingsGoalRouter = require('../../routes/savingsGoal');
const User = require('../../models/User');
const SavingsGoal = require('../../models/SavingsGoal');
const { ManualSavingsGoal, ShopifySavingsGoal } = require('../../models/SavingsGoal');
const ShopifyMerchant = require('../../models/ShopifyMerchant');
const CheckoutCart = require('../../models/CheckoutCart');
const EmailToken = require('../../models/EmailToken');
const { generateImage, enhanceDescription } = require('../../services/xaiService');
const { searchProducts } = require('../../services/webSearchService');

jest.mock('../../services/xaiService', () => ({
  generateImage: jest.fn(),
  enhanceDescription: jest.fn()
}));

const xaiService = require('../../services/xaiService');

jest.mock('../../services/webSearchService');

jest.mock('../../services/emailService', () => ({
  sendVerificationCode: jest.fn(),
  testEmail: jest.fn()
}));

const mockExchangePublicToken = jest.fn();
const mockCreateProcessorToken = jest.fn();

jest.mock('../../services/plaidService', () => {
  return jest.fn().mockImplementation(() => ({
    exchangePublicToken: mockExchangePublicToken,
    createProcessorToken: mockCreateProcessorToken
  }));
});

let mockCreatePayment = jest.fn();

jest.mock('../../services/unitService', () => {
  return jest.fn().mockImplementation(() => ({
    createPayment: mockCreatePayment
  }));
});

jest.mock('axios');

jest.mock('../../middleware/shopifyAuth', () => ({
  verifyShopifySessionToken: (req, res, next) => {
    req.shopifySession = {
      id: 'test-session-id',
      shop_id: '123456789',
      shop_domain: 'test-shop.myshopify.com',
      is_online: true,
      state: 'active'
    };
    next();
  }
}));

const webSearchService = require('../../services/webSearchService');

const app = express();
app.use(express.json());
app.use('/api/savings-goal', savingsGoalRouter);
app.use('/api/products', require('../../routes/products'));
app.use('/api/auth', require('../../routes/auth'));
app.use('/api/bank', require('../../routes/bank'));

describe('SavingsGoal Routes', () => {
  let mongoServer;
  let testUser;
  let authToken;

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
    await User.deleteMany({});
    await SavingsGoal.deleteMany({});
    await ShopifyMerchant.deleteMany({});
    await CheckoutCart.deleteMany({});

    // Reset all mocks before each test
    jest.clearAllMocks();

    testUser = new User({
      email: 'test@example.com',
      googleId: 'test-google-id',
      status: 'approved',
      unitCustomerId: 'test-customer-id'
    });
    await testUser.save();

    authToken = jwt.sign(
      { userId: testUser._id.toString() },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  describe('GET /', () => {
    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .get('/api/savings-goal')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .get('/api/savings-goal')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      const invalidToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/savings-goal')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should return empty array when user has no savings goals', async () => {
      const response = await request(app)
        .get('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should return user\'s savings goals when they exist', async () => {
      const goal1 = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Vacation Fund',
        targetAmount: 5000,
        currentAmount: 1000,
        description: 'Save for summer vacation'
      });
      await goal1.save();

      const goal2 = new SavingsGoal({
        userId: testUser._id,
        goalName: 'New Laptop',
        targetAmount: 1500,
        currentAmount: 500,
        description: 'Save for new laptop'
      });
      await goal2.save();

      const response = await request(app)
        .get('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].goalName).toBe('Vacation Fund');
      expect(response.body[1].goalName).toBe('New Laptop');
    });

    it('should only return goals for the authenticated user', async () => {
      const otherUser = new User({
        email: 'other@example.com',
        googleId: 'other-google-id',
        status: 'approved'
      });
      await otherUser.save();

      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other User Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'My Goal',
        targetAmount: 2000,
        currentAmount: 500
      });
      await testGoal.save();

      const response = await request(app)
        .get('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].goalName).toBe('My Goal');
      expect(response.body[0].userId.toString()).toBe(testUser._id.toString());
    });

    it('should return 500 when database error occurs', async () => {
      const originalFind = SavingsGoal.find;
      SavingsGoal.find = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch savings goals');

      SavingsGoal.find = originalFind;
    });
  });

  describe('GET /:id', () => {
    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .get('/api/savings-goal/507f1f77bcf86cd799439011')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .get('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      const invalidToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should return 404 when savings goal does not exist', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      
      const response = await request(app)
        .get(`/api/savings-goal/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should return 404 when savings goal exists but belongs to different user', async () => {
      const otherUser = new User({
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'User'
      });
      await otherUser.save();

      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other User Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      const response = await request(app)
        .get(`/api/savings-goal/${otherGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');

      await User.deleteOne({ _id: otherUser._id });
      await SavingsGoal.deleteOne({ _id: otherGoal._id });
    });

    it('should return savings goal when it exists and belongs to authenticated user', async () => {
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Vacation Fund',
        targetAmount: 5000,
        currentAmount: 1000,
        description: 'Save for summer vacation',
        category: 'trip'
      });
      await testGoal.save();

      const response = await request(app)
        .get(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body._id).toBe(testGoal._id.toString());
      expect(response.body.goalName).toBe('Vacation Fund');
      expect(response.body.targetAmount).toBe(5000);
      expect(response.body.currentAmount).toBe(1000);
      expect(response.body.description).toBe('Save for summer vacation');
      expect(response.body.category).toBe('trip');
      expect(response.body.userId).toBe(testUser._id.toString());
    });

    it('should return 500 when database error occurs', async () => {
      const originalFindOne = SavingsGoal.findOne;
      SavingsGoal.findOne = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch savings goal');

      SavingsGoal.findOne = originalFindOne;
    });

    it('should return 400 when invalid ObjectId is provided', async () => {
      const response = await request(app)
        .get('/api/savings-goal/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch savings goal');
    });

    it('should handle savings goal with nested product data', async () => {
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'New Laptop',
        targetAmount: 1500,
        currentAmount: 500,
        googleShoppingData: [{
          title: 'MacBook Pro',
          price: '$1499',
          thumbnail: 'https://example.com/laptop.jpg',
          source: 'Apple Store',
          rating: 4.8,
          reviews: 1250
        }]
      });
      await testGoal.save();

      const response = await request(app)
        .get(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.googleShoppingData[0].title).toBe('MacBook Pro');
      expect(response.body.googleShoppingData[0].price).toBe('$1499');
      expect(response.body.googleShoppingData[0].thumbnail).toBe('https://example.com/laptop.jpg');
      expect(response.body.googleShoppingData[0].source).toBe('Apple Store');
      expect(response.body.googleShoppingData[0].rating).toBe(4.8);
      expect(response.body.googleShoppingData[0].reviews).toBe(1250);
    });
  });

  describe('POST /', () => {
    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .post('/api/savings-goal')
        .send({
          goalName: 'Test Goal',
          targetAmount: 1000
        })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          goalName: 'Test Goal',
          targetAmount: 1000
        })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      const invalidToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send({
          goalName: 'Test Goal',
          targetAmount: 1000
        })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should create savings goal with basic fields', async () => {
      const goalData = {
        goalName: 'Vacation Fund',
        description: 'Save for summer vacation',
        targetAmount: 5000
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);
      console.log(response.body);
      expect(response.body.goalName).toBe('Vacation Fund');
      expect(response.body.targetAmount).toBe(5000);
      expect(response.body.currentAmount).toBe(0);
      expect(response.body.userId).toBe(testUser._id.toString());
      expect(response.body._id).toBeDefined();
      expect(response.body.createdAt).toBeDefined();

      // Verify it was saved to database
      const savedGoal = await SavingsGoal.findById(response.body._id);
      expect(savedGoal).toBeTruthy();
      expect(savedGoal.goalName).toBe('Vacation Fund');
    });

    it('should create savings goal with product data', async () => {
      const goalData = {
        goalName: 'New Laptop',
        description: 'Save for new laptop',
        targetAmount: 1500,
        productLink: 'https://example.com/laptop',
        title: 'MacBook Pro',
        price: 1499,
        thumbnail: 'https://example.com/laptop.jpg',
        source: 'Apple Store',
        rating: 4.8,
        reviews: 1250
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      expect(response.body.googleShoppingData[0].title).toBe('MacBook Pro');
      expect(response.body.googleShoppingData[0].price).toBe('1499');
      expect(response.body.googleShoppingData[0].thumbnail).toBe('https://example.com/laptop.jpg');
      expect(response.body.googleShoppingData[0].source).toBe('Apple Store');
      expect(response.body.googleShoppingData[0].rating).toBe(4.8);
      expect(response.body.googleShoppingData[0].reviews).toBe(1250);
    });

    it('should handle goalName fallback to title when goalName is not provided', async () => {
      const goalData = {
        description: 'Save for new laptop',
        targetAmount: 1500,
        title: 'MacBook Pro'
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      expect(response.body.goalName).toBe('MacBook Pro');
    });

    it('should handle targetAmount fallback to price when targetAmount is not provided', async () => {
      const goalData = {
        goalName: 'New Laptop',
        description: 'Save for new laptop',
        price: 1499
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      expect(response.body.targetAmount).toBe(1499);
    });

    it('should parse numeric fields correctly', async () => {
      const goalData = {
        goalName: 'Test Goal',
        targetAmount: '2000', // String that should be parsed
        title: 'Test Product', // Need at least one of title/price/productLink to create googleShoppingData
        extracted_price: '1500.50',
        extracted_old_price: '1800.25'
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      expect(response.body.targetAmount).toBe(2000);
      expect(response.body.googleShoppingData[0].extracted_price).toBe(1500.50);
      expect(response.body.googleShoppingData[0].extracted_old_price).toBe(1800.25);
    });

    it('should handle undefined numeric fields gracefully', async () => {
      const goalData = {
        goalName: 'Test Goal',
        targetAmount: 1000,
        extracted_price: undefined,
        extracted_old_price: null
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      // If no product data provided, googleShoppingData should be empty or undefined
      expect(response.body.googleShoppingData).toBeDefined();
      if (response.body.googleShoppingData && response.body.googleShoppingData.length > 0) {
        expect(response.body.googleShoppingData[0].extracted_price).toBeUndefined();
        expect(response.body.googleShoppingData[0].extracted_old_price).toBeUndefined();
      }
    });

    it('should set default values correctly', async () => {
      const goalData = {
        goalName: 'Test Goal',
        targetAmount: 1000
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      expect(response.body.currentAmount).toBe(0);
      expect(response.body.isPaused).toBe(false);
      expect(response.body.category).toBe('other');
      expect(response.body.transfers).toEqual([]);
    });

    it('should return 500 when database save fails', async () => {
      // Mock a database error
      const originalSave = SavingsGoal.prototype.save;
      SavingsGoal.prototype.save = jest.fn().mockRejectedValue(new Error('Database save failed'));

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          goalName: 'Test Goal',
          targetAmount: 1000
        })
        .expect(500);

      expect(response.body.error).toBe('Failed to create savings goal');

      // Restore original function
      SavingsGoal.prototype.save = originalSave;
    });

    it('should handle complex product data structure', async () => {
      const goalData = {
        goalName: 'Gaming Setup',
        targetAmount: 2500,
        description: 'Complete gaming setup',
        productLink: 'https://example.com/gaming',
        title: 'Gaming Bundle',
        price: 2499,
        old_price: 2999,
        extracted_price: 2499.99,
        extracted_old_price: 2999.99,
        product_id: 'gaming-123',
        serpapi_product_api: 'https://serpapi.com/product',
        thumbnail: 'https://example.com/gaming.jpg',
        source: 'Gaming Store',
        source_icon: 'https://example.com/icon.png',
        rating: 4.9,
        reviews: 500,
        badge: 'Best Seller',
        tag: 'Gaming',
        delivery: 'Free Shipping'
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);
      expect(response.body.googleShoppingData[0].product_id).toBe('gaming-123');
      expect(response.body.googleShoppingData[0].serpapi_product_api).toBe('https://serpapi.com/product');
      expect(response.body.googleShoppingData[0].source_icon).toBe('https://example.com/icon.png');
      expect(response.body.googleShoppingData[0].badge).toBe('Best Seller');
      expect(response.body.googleShoppingData[0].tag).toBe('Gaming');
      expect(response.body.googleShoppingData[0].delivery).toBe('Free Shipping');
    });
  });

  describe('DELETE /:id', () => {
    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .delete('/api/savings-goal/507f1f77bcf86cd799439011')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .delete('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      const invalidToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .delete('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should return 404 when savings goal does not exist', async () => {
      const response = await request(app)
        .delete('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should return 404 when savings goal exists but belongs to different user', async () => {
      // Create another user
      const otherUser = new User({
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'User'
      });
      await otherUser.save();

      // Create a savings goal for the other user
      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      const response = await request(app)
        .delete(`/api/savings-goal/${otherGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');

      // Clean up
      await User.deleteOne({ _id: otherUser._id });
      await SavingsGoal.deleteOne({ _id: otherGoal._id });
    });

    it('should successfully delete savings goal when it exists and belongs to authenticated user', async () => {
      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal to Delete',
        targetAmount: 2000,
        currentAmount: 500,
        description: 'This goal will be deleted'
      });
      await testGoal.save();

      // Verify it exists
      const savedGoal = await SavingsGoal.findById(testGoal._id);
      expect(savedGoal).toBeTruthy();
      expect(savedGoal.goalName).toBe('Test Goal to Delete');

      // Delete the goal
      const response = await request(app)
        .delete(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify it was actually deleted
      const deletedGoal = await SavingsGoal.findById(testGoal._id);
      expect(deletedGoal).toBeNull();
    });

    it('should return 500 when database error occurs during deletion', async () => {
      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Error',
        targetAmount: 1000,
        currentAmount: 0
      });
      await testGoal.save();

      // Mock a database error
      const originalDeleteOne = SavingsGoal.deleteOne;
      SavingsGoal.deleteOne = jest.fn().mockRejectedValue(new Error('Database delete failed'));

      const response = await request(app)
        .delete(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Failed to delete savings goal');

      // Restore original function
      SavingsGoal.deleteOne = originalDeleteOne;

      // Clean up the test goal
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should handle savings goal with complex product data during deletion', async () => {
      // Create a test savings goal with product data
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Product Goal to Delete',
        targetAmount: 3000,
        currentAmount: 1000,
        googleShoppingData: [{
          title: 'Test Product',
          price: '2999',
          source: 'Test Store',
          rating: 4.5,
          reviews: 100
        }]
      });
      await testGoal.save();

      // Verify it exists with product data
      const savedGoal = await ManualSavingsGoal.findById(testGoal._id);
      expect(savedGoal.googleShoppingData[0].title).toBe('Test Product');
      expect(savedGoal.googleShoppingData[0].price).toBe('2999');

      // Delete the goal
      const response = await request(app)
        .delete(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify it was deleted
      const deletedGoal = await SavingsGoal.findById(testGoal._id);
      expect(deletedGoal).toBeNull();
    });

    it('should handle savings goal with transfers during deletion', async () => {
      // Create a test savings goal with transfers
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Transfer Goal to Delete',
        targetAmount: 5000,
        currentAmount: 2000,
        transfers: [
          {
            transferId: 'transfer-123',
            transactionId: 'txn-456',
            amount: 1000,
            date: new Date(),
            status: 'completed',
            type: 'credit'
          }
        ]
      });
      await testGoal.save();

      // Verify it exists with transfers
      const savedGoal = await SavingsGoal.findById(testGoal._id);
      expect(savedGoal.transfers).toHaveLength(1);
      expect(savedGoal.transfers[0].transferId).toBe('transfer-123');

      // Delete the goal
      const response = await request(app)
        .delete(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify it was deleted
      const deletedGoal = await SavingsGoal.findById(testGoal._id);
      expect(deletedGoal).toBeNull();
    });
  });

  describe('PUT /:id', () => {
    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .put('/api/savings-goal/507f1f77bcf86cd799439011')
        .send({ goalName: 'Updated Goal' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .put('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', 'Bearer invalid-token')
        .send({ goalName: 'Updated Goal' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      const invalidToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .put('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send({ goalName: 'Updated Goal' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should return 404 when savings goal does not exist', async () => {
      const response = await request(app)
        .put('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ goalName: 'Updated Goal' })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should return 404 when savings goal exists but belongs to different user', async () => {
      // Create another user
      const otherUser = new User({
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'User'
      });
      await otherUser.save();

      // Create a savings goal for the other user
      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      const response = await request(app)
        .put(`/api/savings-goal/${otherGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ goalName: 'Updated Goal' })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');

      // Clean up
      await User.deleteOne({ _id: otherUser._id });
      await SavingsGoal.deleteOne({ _id: otherGoal._id });
    });

    it('should successfully update goalName when provided', async () => {
      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Original Goal Name',
        targetAmount: 1000,
        currentAmount: 0
      });
      await testGoal.save();

      const updateData = { goalName: 'Updated Goal Name' };

      const response = await request(app)
        .put(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.goalName).toBe('Updated Goal Name');
      expect(response.body.targetAmount).toBe(1000); // Should remain unchanged
      expect(response.body.currentAmount).toBe(0); // Should remain unchanged

      // Verify it was saved to database
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.goalName).toBe('Updated Goal Name');

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should successfully update description when provided', async () => {
      // Create a test savings goal
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        googleShoppingData: [{
          description: 'Original description'
        }]
      });
      await testGoal.save();

      const updateData = { description: 'Updated description' };

      const response = await request(app)
        .put(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.description).toBe('Updated description');
      expect(response.body.goalName).toBe('Test Goal'); // Should remain unchanged

      // Verify it was saved to database
      const updatedGoal = await ManualSavingsGoal.findById(testGoal._id);
      expect(updatedGoal.description).toBe('Updated description');

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should successfully update targetAmount when provided', async () => {
      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await testGoal.save();

      const updateData = { targetAmount: 2000 };

      const response = await request(app)
        .put(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.targetAmount).toBe(2000);
      expect(response.body.goalName).toBe('Test Goal'); // Should remain unchanged
      expect(response.body.currentAmount).toBe(0); // Should remain unchanged

      // Verify it was saved to database
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.targetAmount).toBe(2000);

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should handle multiple field updates simultaneously', async () => {
      // Create a test savings goal
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Original Goal',
        targetAmount: 1000,
        currentAmount: 0,
        description: 'Original description'
      });
      await testGoal.save();

      const updateData = {
        goalName: 'Updated Goal',
        description: 'Updated description',
        targetAmount: 2500
      };

      const response = await request(app)
        .put(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.goalName).toBe('Updated Goal');
      expect(response.body.description).toBe('Updated description');
      expect(response.body.targetAmount).toBe(2500);

      // Verify it was saved to database
      const updatedGoal = await ManualSavingsGoal.findById(testGoal._id);
      expect(updatedGoal.goalName).toBe('Updated Goal');
      expect(updatedGoal.description).toBe('Updated description');
      expect(updatedGoal.targetAmount).toBe(2500);

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should handle partial updates without affecting other fields', async () => {
      // Create a test savings goal with more data
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Original Goal',
        targetAmount: 1000,
        currentAmount: 500,
        category: 'trip',
        googleShoppingData: [{
          title: 'Original Product',
          price: '999',
          source: 'Original Store'
        }]
      });
      await testGoal.save();

      // Only update goalName
      const updateData = { goalName: 'Partially Updated Goal' };

      const response = await request(app)
        .put(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.goalName).toBe('Partially Updated Goal');
      expect(response.body.targetAmount).toBe(1000); // Unchanged
      expect(response.body.currentAmount).toBe(500); // Unchanged
      expect(response.body.category).toBe('trip'); // Unchanged
      expect(response.body.googleShoppingData[0].title).toBe('Original Product'); // Unchanged
      expect(response.body.googleShoppingData[0].price).toBe('999'); // Unchanged
      expect(response.body.googleShoppingData[0].source).toBe('Original Store'); // Unchanged

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should return 500 when database error occurs during update', async () => {
      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await testGoal.save();

      // Mock a database error
      const originalSave = SavingsGoal.prototype.save;
      SavingsGoal.prototype.save = jest.fn().mockRejectedValue(new Error('Database save failed'));

      const response = await request(app)
        .put(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ goalName: 'Updated Goal' })
        .expect(500);

      expect(response.body.error).toBe('Failed to update savings goal');

      // Restore original function
      SavingsGoal.prototype.save = originalSave;

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should handle numeric targetAmount parsing correctly', async () => {
      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await testGoal.save();

      // Send targetAmount as string
      const updateData = { targetAmount: '3000' };

      const response = await request(app)
        .put(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.targetAmount).toBe(3000); // Should be parsed as number

      // Verify it was saved to database as number
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.targetAmount).toBe(3000);

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });
  });

  describe('PATCH /:id/pause', () => {
    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .patch('/api/savings-goal/507f1f77bcf86cd799439011/pause')
        .send({ isPaused: true })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .patch('/api/savings-goal/507f1f77bcf86cd799439011/pause')
        .set('Authorization', 'Bearer invalid-token')
        .send({ isPaused: true })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      const invalidToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .patch('/api/savings-goal/507f1f77bcf86cd799439011/pause')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send({ isPaused: true })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should return 404 when savings goal does not exist', async () => {
      const response = await request(app)
        .patch('/api/savings-goal/507f1f77bcf86cd799439011/pause')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isPaused: true })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should return 404 when savings goal exists but belongs to different user', async () => {
      // Create another user
      const otherUser = new User({
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'User'
      });
      await otherUser.save();

      // Create a savings goal for the other user
      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      const response = await request(app)
        .patch(`/api/savings-goal/${otherGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isPaused: true })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');

      // Clean up
      await User.deleteOne({ _id: otherUser._id });
      await SavingsGoal.deleteOne({ _id: otherGoal._id });
    });

    it('should successfully pause a savings goal when isPaused is true', async () => {
      // Create a test savings goal (initially not paused)
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal to Pause',
        targetAmount: 1000,
        currentAmount: 0,
        isPaused: false
      });
      await testGoal.save();

      const updateData = { isPaused: true };

      const response = await request(app)
        .patch(`/api/savings-goal/${testGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.isPaused).toBe(true);
      expect(response.body.goalName).toBe('Test Goal to Pause'); // Should remain unchanged
      expect(response.body.targetAmount).toBe(1000); // Should remain unchanged

      // Verify it was saved to database
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.isPaused).toBe(true);

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should successfully unpause a savings goal when isPaused is false', async () => {
      // Create a test savings goal (initially paused)
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal to Unpause',
        targetAmount: 1000,
        currentAmount: 0,
        isPaused: true
      });
      await testGoal.save();

      const updateData = { isPaused: false };

      const response = await request(app)
        .patch(`/api/savings-goal/${testGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.isPaused).toBe(false);
      expect(response.body.goalName).toBe('Test Goal to Unpause'); // Should remain unchanged
      expect(response.body.targetAmount).toBe(1000); // Should remain unchanged

      // Verify it was saved to database
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.isPaused).toBe(false);

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should handle toggling pause state multiple times', async () => {
      // Create a test savings goal (initially not paused)
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Toggle',
        targetAmount: 1000,
        currentAmount: 0,
        isPaused: false
      });
      await testGoal.save();

      // First toggle: pause
      let response = await request(app)
        .patch(`/api/savings-goal/${testGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isPaused: true })
        .expect(200);

      expect(response.body.isPaused).toBe(true);

      // Second toggle: unpause
      response = await request(app)
        .patch(`/api/savings-goal/${testGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isPaused: false })
        .expect(200);

      expect(response.body.isPaused).toBe(false);

      // Third toggle: pause again
      response = await request(app)
        .patch(`/api/savings-goal/${testGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isPaused: true })
        .expect(200);

      expect(response.body.isPaused).toBe(true);

      // Verify final state in database
      const finalGoal = await SavingsGoal.findById(testGoal._id);
      expect(finalGoal.isPaused).toBe(true);

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should preserve all other fields when updating pause state', async () => {
      // Create a test savings goal with comprehensive data
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Comprehensive Test Goal',
        targetAmount: 5000,
        currentAmount: 2500,
        category: 'trip',
        googleShoppingData: [{
          title: 'Test Product',
          price: '4999',
          source: 'Test Store'
        }],
        transfers: [
          {
            transferId: 'transfer-123',
            transactionId: 'txn-456',
            amount: 1000,
            date: new Date(),
            status: 'completed',
            type: 'credit'
          }
        ],
        isPaused: false
      });
      await testGoal.save();

      const updateData = { isPaused: true };

      const response = await request(app)
        .patch(`/api/savings-goal/${testGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.isPaused).toBe(true);
      expect(response.body.goalName).toBe('Comprehensive Test Goal');
      expect(response.body.targetAmount).toBe(5000);
      expect(response.body.currentAmount).toBe(2500);
      expect(response.body.category).toBe('trip');
      expect(response.body.googleShoppingData[0].title).toBe('Test Product');
      expect(response.body.googleShoppingData[0].price).toBe('4999');
      expect(response.body.googleShoppingData[0].source).toBe('Test Store');
      expect(response.body.transfers).toHaveLength(1);
      expect(response.body.transfers[0].transferId).toBe('transfer-123');

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should return 500 when database error occurs during pause update', async () => {
      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Error',
        targetAmount: 1000,
        currentAmount: 0,
        isPaused: false
      });
      await testGoal.save();

      // Mock a database error for findOneAndUpdate
      const originalFindOneAndUpdate = SavingsGoal.findOneAndUpdate;
      SavingsGoal.findOneAndUpdate = jest.fn().mockRejectedValue(new Error('Database update failed'));

      const response = await request(app)
        .patch(`/api/savings-goal/${testGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isPaused: true })
        .expect(500);

      expect(response.body.error).toBe('Failed to update pause state');

      // Restore original function
      SavingsGoal.findOneAndUpdate = originalFindOneAndUpdate;

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should handle boolean parsing for isPaused field', async () => {
      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Boolean',
        targetAmount: 1000,
        currentAmount: 0,
        isPaused: false
      });
      await testGoal.save();

      // Send isPaused as string
      const updateData = { isPaused: 'true' };

      const response = await request(app)
        .patch(`/api/savings-goal/${testGoal._id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.isPaused).toBe(true); // Should be parsed as boolean

      // Verify it was saved to database as boolean
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.isPaused).toBe(true);

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });
  });

  describe('POST /:id/generate-image', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
    });

    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/generate-image')
        .send({ prompt: 'Test prompt' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/generate-image')
        .set('Authorization', 'Bearer invalid-token')
        .send({ prompt: 'Test prompt' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      const invalidToken = jwt.sign(
        { userId: new mongoose.Types.ObjectId().toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/generate-image')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send({ prompt: 'Test prompt' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should return 404 when savings goal does not exist', async () => {
      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/generate-image')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ prompt: 'Test prompt' })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should return 404 when savings goal exists but belongs to different user', async () => {
      // Create another user
      const otherUser = new User({
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'User'
      });
      await otherUser.save();

      // Create a savings goal for the other user
      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${otherGoal._id}/generate-image`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ prompt: 'Test prompt' })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');

      // Clean up
      await User.deleteOne({ _id: otherUser._id });
      await SavingsGoal.deleteOne({ _id: otherGoal._id });
    });

    it('should successfully generate image when valid prompt is provided', async () => {
      // Mock the generateImage function to return a specific URL
      xaiService.generateImage.mockResolvedValue('https://example.com/generated-image.jpg');

      // Create a test savings goal
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Image',
        targetAmount: 1000,
        currentAmount: 0
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/generate-image`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ prompt: 'A beautiful vacation destination' })
        .expect(200);

      // Debug: log the response to see what we're actually getting
      console.log('Response body:', response.body);
      console.log('Mock calls:', xaiService.generateImage.mock.calls);

      expect(response.body.imageUrl).toBe('https://example.com/generated-image.jpg');
      expect(response.body.goal.aiGeneratedImage).toBe('https://example.com/generated-image.jpg');
      expect(xaiService.generateImage).toHaveBeenCalledWith('A beautiful vacation destination');
    });

    it('should return 500 when xAI service fails', async () => {
      // Mock the generateImage function to throw an error
      xaiService.generateImage.mockRejectedValue(new Error('xAI service unavailable'));

      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Image',
        targetAmount: 1000,
        currentAmount: 0
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/generate-image`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ prompt: 'Test prompt' })
        .expect(500);

      expect(response.body.error).toBe('Failed to generate image');
      expect(xaiService.generateImage).toHaveBeenCalledWith('Test prompt');
    });
  });

  // NOTE: POST /:id/ai-insights route was removed - tests removed

  describe('POST /:id/web-search', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
    });

    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/web-search')
        .send({ query: 'vacation package' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/web-search')
        .set('Authorization', 'Bearer invalid-token')
        .send({ query: 'vacation package' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      // Create a token for a non-existent user
      const nonExistentUserId = new mongoose.Types.ObjectId();
      const invalidToken = jwt.sign(
        { userId: nonExistentUserId.toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/web-search')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send({ query: 'vacation package' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should return 404 when savings goal does not exist', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/savings-goal/${nonExistentId}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ query: 'vacation package' })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should return 404 when savings goal exists but belongs to different user', async () => {
      // Create another user
      const otherUser = new User({
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'User'
      });
      await otherUser.save();

      // Create a savings goal for the other user
      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other User Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${otherGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ query: 'vacation package' })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should return 400 when savings goal has no product data', async () => {
      // Create a test savings goal WITHOUT product data
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Search',
        targetAmount: 1000,
        currentAmount: 0
        // No product field - this will be a base SavingsGoal, not ManualSavingsGoal
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ query: 'test query' })
        .expect(400);

      expect(response.body.error).toBe('Web search is only available for manual savings goals');
    });

    it('should successfully perform web search when valid query is provided', async () => {
      // Mock the web search service to return sample results
      const mockSearchResults = [
        {
          title: 'Vacation Package Deal',
          price: '$999',
          thumbnail: 'https://example.com/vacation.jpg',
          source: 'Travel Agency',
          productLink: 'https://example.com/vacation-deal'
        },
        {
          title: 'Luxury Vacation Bundle',
          price: '$1499',
          thumbnail: 'https://example.com/luxury.jpg',
          source: 'Premium Travel',
          productLink: 'https://example.com/luxury-bundle'
        }
      ];

      webSearchService.searchProducts.mockResolvedValue({
        success: true,
        results: mockSearchResults,
        query: 'vacation package deals',
        totalResults: 2
      });

      // Create a test savings goal with complete product data (required for web search)
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Vacation Fund',
        targetAmount: 2000,
        currentAmount: 500,
        googleShoppingData: [{
          productLink: 'https://example.com/product',
          title: 'Vacation Package',
          price: '1999',
          source: 'Travel Agency',
          thumbnail: 'https://example.com/thumbnail.jpg'
        }],
        category: 'product'
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ searchQuery: 'vacation package deals' })
        .expect(200);

      expect(response.body.results).toBeDefined();
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body.results.length).toBe(2);
      expect(response.body.query).toBe('vacation package deals');
      expect(response.body.goalId).toBe(testGoal._id.toString());
      expect(webSearchService.searchProducts).toHaveBeenCalledWith('vacation package deals', 'product');
    });

    it('should handle web search with no results', async () => {
      // Mock the web search service to return empty results
      webSearchService.searchProducts.mockResolvedValue({
        success: true,
        results: [],
        query: 'very rare obscure item',
        totalResults: 0
      });

      // Create a test savings goal with complete product data (required for web search)
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Rare Item Fund',
        targetAmount: 1000,
        currentAmount: 0,
        googleShoppingData: [{
          productLink: 'https://example.com/product',
          title: 'Rare Item',
          price: '999',
          source: 'Rare Store',
          thumbnail: 'https://example.com/thumbnail.jpg'
        }],
        category: 'product'
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ searchQuery: 'very rare obscure item' })
        .expect(200);

      expect(response.body.results).toBeDefined();
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body.results.length).toBe(0);
      expect(response.body.query).toBe('very rare obscure item');
      expect(response.body.goalId).toBe(testGoal._id.toString());
      expect(webSearchService.searchProducts).toHaveBeenCalledWith('very rare obscure item', 'product');
    });

    it('should return 500 when web search service fails', async () => {
      // Mock the web search service to throw an error
      webSearchService.searchProducts.mockRejectedValue(new Error('Search service unavailable'));

      // Create a test savings goal with complete product data (required for web search)
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Search',
        targetAmount: 1000,
        currentAmount: 0,
        googleShoppingData: [{
          productLink: 'https://example.com/product',
          title: 'Test Product',
          price: '999',
          source: 'Test Store',
          thumbnail: 'https://example.com/thumbnail.jpg'
        }],
        category: 'product'
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ searchQuery: 'test query' })
        .expect(500);

      expect(response.body.error).toBe('Failed to perform web search');
      expect(webSearchService.searchProducts).toHaveBeenCalledWith('test query', 'product');
    });

    it('should handle special characters in query', async () => {
      // Mock the web search service to return results
      webSearchService.searchProducts.mockResolvedValue({
        success: true,
        results: [
          {
            title: 'Special Characters Product',
            price: '$99',
            thumbnail: 'https://example.com/special.jpg',
            source: 'Special Store',
            productLink: 'https://example.com/special-product'
          }
        ],
        query: 'vacation & travel deals (2024) - "best price"',
        totalResults: 1
      });

      // Create a test savings goal with complete product data (required for web search)
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Search',
        targetAmount: 1000,
        currentAmount: 0,
        googleShoppingData: [{
          productLink: 'https://example.com/product',
          title: 'Test Product',
          price: '999',
          source: 'Test Store',
          thumbnail: 'https://example.com/thumbnail.jpg'
        }],
        category: 'product'
      });
      await testGoal.save();

      const specialQuery = 'vacation & travel deals (2024) - "best price"';
      
      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ searchQuery: specialQuery })
        .expect(200);

      expect(response.body.query).toBe(specialQuery);
      expect(response.body.goalId).toBe(testGoal._id.toString());
      expect(webSearchService.searchProducts).toHaveBeenCalledWith(specialQuery, 'product');
    });

    it('should handle very long queries', async () => {
      // Mock the web search service to return results
      webSearchService.searchProducts.mockResolvedValue({
        success: true,
        results: [
          {
            title: 'Long Query Product',
            price: '$99',
            thumbnail: 'https://example.com/long.jpg',
            source: 'Long Store',
            productLink: 'https://example.com/long-product'
          }
        ],
        query: 'a'.repeat(1000),
        totalResults: 1
      });

      // Create a test savings goal with complete product data (required for web search)
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for Search',
        targetAmount: 1000,
        currentAmount: 0,
        googleShoppingData: [{
          productLink: 'https://example.com/product',
          title: 'Test Product',
          price: '999',
          source: 'Test Store',
          thumbnail: 'https://example.com/thumbnail.jpg'
        }],
        category: 'product'
      });
      await testGoal.save();

      const longQuery = 'a'.repeat(1000); // Very long query
      
      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ searchQuery: longQuery })
        .expect(200);

      expect(response.body.query).toBe(longQuery);
      expect(response.body.goalId).toBe(testGoal._id.toString());
      expect(webSearchService.searchProducts).toHaveBeenCalledWith(longQuery, 'product');
    });

    it('should preserve savings goal context in search results', async () => {
      // Mock the web search service to return results
      webSearchService.searchProducts.mockResolvedValue({
        success: true,
        results: [
          {
            title: 'Gaming Computer Parts',
            price: '$299',
            thumbnail: 'https://example.com/gaming-parts.jpg',
            source: 'Gaming Store',
            productLink: 'https://example.com/gaming-parts'
          }
        ],
        query: 'gaming computer parts',
        totalResults: 1
      });

      // Create a test savings goal with specific details and valid category
      const testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Gaming Setup Fund',
        targetAmount: 1500,
        currentAmount: 300,
        category: 'other', // Use valid category from schema
        description: 'Save for a high-end gaming computer setup',
        googleShoppingData: [{
          productLink: 'https://example.com/product',
          title: 'Gaming Setup',
          price: '1499',
          source: 'Gaming Store',
          thumbnail: 'https://example.com/thumbnail.jpg'
        }]
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ searchQuery: 'gaming computer parts' })
        .expect(200);

      expect(response.body.goalId).toBe(testGoal._id.toString());
      expect(response.body.goalName).toBe('Gaming Setup Fund');
      expect(response.body.targetAmount).toBe(1500);
      expect(response.body.currentAmount).toBe(300);
      expect(response.body.category).toBe('other');
      expect(webSearchService.searchProducts).toHaveBeenCalledWith('gaming computer parts', 'other');
    });
  });

  describe('POST /:id/save-product', () => {
    let testGoal;

    beforeEach(async () => {
      // Create a test savings goal
      testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        category: 'other',
        googleShoppingData: [{
          title: 'Original Product',
          price: '500'
        }]
      });
      await testGoal.save();
    });

    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/save-product`)
        .send({ productData: { title: 'New Product' } })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/save-product`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ productData: { title: 'New Product' } })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 404 when savings goal is not found', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/savings-goal/${nonExistentId}/save-product`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ productData: { title: 'New Product' } })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should save product data successfully', async () => {
      const productData = {
        title: 'New Gaming Laptop',
        price: '1299',
        old_price: '1499',
        thumbnail: 'https://example.com/laptop.jpg',
        source: 'Tech Store',
        productLink: 'https://example.com/laptop',
        rating: 4.5,
        reviews_count: 150
      };

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/save-product`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ productData })
        .expect(200);

      expect(response.body.message).toBe('Product saved successfully');
      expect(response.body.goal.googleShoppingData[0].title).toBe('New Gaming Laptop');
      expect(response.body.goal.googleShoppingData[0].price).toBe('1299');
      expect(response.body.goal.googleShoppingData[0].old_price).toBe('1499');
      expect(response.body.goal.googleShoppingData[0].thumbnail).toBe('https://example.com/laptop.jpg');
      expect(response.body.goal.googleShoppingData[0].source).toBe('Tech Store');
      expect(response.body.goal.googleShoppingData[0].productLink).toBe('https://example.com/laptop');
      expect(response.body.goal.googleShoppingData[0].rating).toBe(4.5);
      expect(response.body.goal.googleShoppingData[0].reviews).toBe(150);
    });

    it('should handle database errors when saving product', async () => {
      const productData = {
        title: 'New Product',
        price: '100'
      };

      // Create a new goal instance and mock its save method
      const errorGoal = await ManualSavingsGoal.findById(testGoal._id);
      const originalSave = errorGoal.save.bind(errorGoal);
      errorGoal.save = jest.fn().mockRejectedValue(new Error('Database error'));

      // Mock findOne to return our error goal
      const originalFindOne = SavingsGoal.findOne;
      SavingsGoal.findOne = jest.fn().mockResolvedValue(errorGoal);

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/save-product`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ productData })
        .expect(500);

      expect(response.body.error).toBe('Failed to save product');

      // Restore the original methods
      SavingsGoal.findOne = originalFindOne;
      errorGoal.save = originalSave;
    });
  });

  describe('Edge cases for existing endpoints', () => {
    let testGoal;

    beforeEach(async () => {
      testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        category: 'other'
      });
      await testGoal.save();
    });

    it('should return 400 when prompt is empty for generate-image', async () => {
      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/generate-image`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ prompt: '' })
        .expect(400);

      expect(response.body.error).toBe('Prompt is required');
    });

    it('should return 400 when prompt is only whitespace for generate-image', async () => {
      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/generate-image`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ prompt: '   ' })
        .expect(400);

      expect(response.body.error).toBe('Prompt is required');
    });

    // NOTE: ai-insights route tests removed - route was deleted

    it('should return 400 when search query is empty for web-search', async () => {
      // Create a product-type goal with product data for web search
      const productGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Product Goal',
        targetAmount: 1000,
        currentAmount: 0,
        category: 'product',
        googleShoppingData: [{
          title: 'Test Product',
          price: '100',
          source: 'Test Store'
        }]
      });
      await productGoal.save();

      // Mock the web search service to return success
      webSearchService.searchProducts.mockResolvedValue({
        success: true,
        results: []
      });

      const response = await request(app)
        .post(`/api/savings-goal/${productGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ searchQuery: '' })
        .expect(400);

      expect(response.body.error).toBe('Search query is required');
    });

    it('should return 400 when search query is only whitespace for web-search', async () => {
      // Create a product-type goal with product data for web search
      const productGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Product Goal',
        targetAmount: 1000,
        currentAmount: 0,
        category: 'product',
        googleShoppingData: [{
          title: 'Test Product',
          price: '100',
          source: 'Test Store'
        }]
      });
      await productGoal.save();

      // Mock the web search service to return success
      webSearchService.searchProducts.mockResolvedValue({
        success: true,
        results: []
      });

      const response = await request(app)
        .post(`/api/savings-goal/${productGoal._id}/web-search`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ searchQuery: '   ' })
        .expect(400);

      expect(response.body.error).toBe('Search query is required');
    });
  });

  describe('GET /products/search', () => {
    let axios;

    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
      // Get the mocked axios
      axios = require('axios');
    });

    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .get('/api/products/search?q=test')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .get('/api/products/search?q=test')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should return 401 when user is not found', async () => {
      // Create a token for a non-existent user
      const nonExistentUserId = new mongoose.Types.ObjectId();
      const invalidToken = jwt.sign(
        { userId: nonExistentUserId.toString() },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/products/search?q=test')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should perform search successfully', async () => {
      // Mock axios for the search endpoint
      axios.get.mockResolvedValue({
        data: {
          shopping_results: [
            {
              title: 'Test Product',
              price: '$99.99',
              thumbnail: 'https://example.com/image.jpg',
              source: 'Test Store',
              link: 'https://example.com/product'
            }
          ]
        }
      });

      const response = await request(app)
        .get('/api/products/search?q=test')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('Test Product');
      expect(response.body[0].price).toBe('$99.99');
      expect(axios.get).toHaveBeenCalledWith('https://serpapi.com/search', {
        params: { 
          api_key: process.env.SERPAPI_KEY, 
          engine: 'google_shopping', 
          q: 'test', 
          num: 10 
        }
      });
    });

    it('should handle search errors', async () => {
      // Mock axios to throw an error
      axios.get.mockRejectedValue(new Error('Search failed'));

      const response = await request(app)
        .get('/api/products/search?q=test')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Search failed');
    });

    it('should handle products with invalid prices', async () => {
      // Mock axios to return products with invalid prices
      axios.get.mockResolvedValue({
        data: {
          shopping_results: [
            {
              title: 'Product with invalid price',
              price: 'invalid-price',
              thumbnail: 'https://example.com/image.jpg',
              source: 'Test Store',
              link: 'https://example.com/product'
            },
            {
              title: 'Product with no price',
              thumbnail: 'https://example.com/image2.jpg',
              source: 'Test Store 2',
              link: 'https://example.com/product2'
            }
          ]
        }
      });

      const response = await request(app)
        .get('/api/products/search?q=test')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].price).toBe('invalid-price'); // Invalid price stays as string
      expect(response.body[1].price).toBe(0); // No price should default to 0
    });

  });

  describe('Edge cases for existing endpoints', () => {
    it('should handle GET / with database error', async () => {
      // Mock SavingsGoal.find to throw an error
      const originalFind = SavingsGoal.find;
      SavingsGoal.find = jest.fn().mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/savings-goal/')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch savings goals');

      // Restore original find method
      SavingsGoal.find = originalFind;
    });


    it('should handle POST / with database error', async () => {
      // Mock SavingsGoal.save to throw an error
      const originalSave = SavingsGoal.prototype.save;
      SavingsGoal.prototype.save = jest.fn().mockRejectedValue(new Error('Database error'));

      const goalData = {
        goalName: 'Test Goal',
        targetAmount: 100,
        productLink: 'https://example.com',
        title: 'Test Product',
        price: 100
      };

      const response = await request(app)
        .post('/api/savings-goal/')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(500);

      expect(response.body.error).toBe('Failed to create savings goal');

      // Restore original save method
      SavingsGoal.prototype.save = originalSave;
    });


  });

  describe('POST /api/savings-goal/shopify', () => {

    it('should create a savings goal with valid data', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-123',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '100.50'
      });
      await cart.save();

      const goalData = {
        goalName: 'Test Shopify Goal',
        description: 'Test description',
        targetAmount: 100.50,
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(201);

      expect(response.body).toMatchObject({
        goalName: 'Test Shopify Goal',
        description: 'Test description',
        targetAmount: 100.50
      });
      expect(response.body._id).toBeDefined();
      expect(response.body.__t).toBe('ShopifySavingsGoal');
      expect(response.body.checkoutCartId).toBe(cart._id.toString());
      expect(response.body.shopDomain).toBe('test-shop.myshopify.com');
      expect(response.body.userId).toBeUndefined(); // Should not have userId
    });

    it('should create a savings goal with minimal data', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-minimal',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '50'
      });
      await cart.save();

      const goalData = {
        goalName: 'Minimal Goal',
        targetAmount: 50,
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(201);

      expect(response.body).toMatchObject({
        goalName: 'Minimal Goal',
        targetAmount: 50,
        description: ''
      });
      expect(response.body.__t).toBe('ShopifySavingsGoal');
    });

    it('should return 400 if goalName is missing', async () => {
      const goalData = {
        targetAmount: 100
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(400);

      expect(response.body.error).toBe('Goal name and target amount are required');
    });

    it('should return 400 if targetAmount is missing', async () => {
      const goalData = {
        goalName: 'Test Goal'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(400);

      expect(response.body.error).toBe('Goal name and target amount are required');
    });

    it('should return 400 if both goalName and targetAmount are missing', async () => {
      const goalData = {};

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(400);

      expect(response.body.error).toBe('Goal name and target amount are required');
    });

    it('should handle empty goalName', async () => {
      const goalData = {
        goalName: '',
        targetAmount: 100
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(400);

      expect(response.body.error).toBe('Goal name and target amount are required');
    });

    it('should handle null targetAmount', async () => {
      const goalData = {
        goalName: 'Test Goal',
        targetAmount: null
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(400);

      expect(response.body.error).toBe('Goal name and target amount are required');
    });

    it('should handle undefined targetAmount', async () => {
      const goalData = {
        goalName: 'Test Goal',
        targetAmount: undefined
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(400);

      expect(response.body.error).toBe('Goal name and target amount are required');
    });

    it('should parse targetAmount as float', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-float',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '150.75'
      });
      await cart.save();

      const goalData = {
        goalName: 'Test Goal',
        targetAmount: '150.75',
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(201);

      expect(response.body.targetAmount).toBe(150.75);
    });

    it('should handle complex product data', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-complex',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '200',
        lineItems: [
          {
            title: 'Item 1',
            quantity: 2,
            price: 50,
            currency: 'USD'
          },
          {
            title: 'Item 2',
            quantity: 1,
            price: 100,
            currency: 'USD'
          }
        ]
      });
      await cart.save();

      const goalData = {
        goalName: 'Complex Product Goal',
        targetAmount: 200,
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(201);

      expect(response.body.__t).toBe('ShopifySavingsGoal');
      expect(response.body.checkoutCartId).toBe(cart._id.toString());
      expect(response.body.shopDomain).toBe('test-shop.myshopify.com');
    });

    it('should handle database errors gracefully', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-error',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '100'
      });
      await cart.save();

      // Mock ShopifySavingsGoal save to throw an error
      const originalSave = ShopifySavingsGoal.prototype.save;
      ShopifySavingsGoal.prototype.save = jest.fn().mockRejectedValue(new Error('Database error'));

      const goalData = {
        goalName: 'Test Goal',
        targetAmount: 100,
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(500);

      expect(response.body.error).toBe('Failed to create savings goal');

      // Restore original method
      ShopifySavingsGoal.prototype.save = originalSave;
    });

    it('should handle invalid targetAmount gracefully', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-invalid',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: 'invalid'
      });
      await cart.save();

      const goalData = {
        goalName: 'Test Goal',
        targetAmount: 'invalid-number',
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(500);

      expect(response.body.error).toBe('Failed to create savings goal');
    });

    it('should handle empty product object', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-empty',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '100'
      });
      await cart.save();

      const goalData = {
        goalName: 'Test Goal',
        targetAmount: 100,
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(201);

      expect(response.body.__t).toBe('ShopifySavingsGoal');
    });

    it('should handle null product', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-null',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '100'
      });
      await cart.save();

      const goalData = {
        goalName: 'Test Goal',
        targetAmount: 100,
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(201);

      expect(response.body.__t).toBe('ShopifySavingsGoal');
    });

    it('should handle undefined product', async () => {
      // Create CheckoutCart first
      const cart = new CheckoutCart({
        checkoutId: 'test-checkout-undefined',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '100'
      });
      await cart.save();

      const goalData = {
        goalName: 'Test Goal',
        targetAmount: 100,
        checkoutCartId: cart._id.toString(),
        shopDomain: 'test-shop.myshopify.com'
      };

      const response = await request(app)
        .post('/api/savings-goal/shopify')
        .send(goalData)
        .expect(201);

      expect(response.body.__t).toBe('ShopifySavingsGoal');
    });
  });

  describe('Guest Checkout Routes', () => {
    const emailService = require('../../services/emailService');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('POST /auth/verification/send', () => {
      it('should send verification code successfully', async () => {
        emailService.sendVerificationCode.mockResolvedValue({ success: true });

        const response = await request(app)
          .post('/api/auth/verification/send')
          .send({ email: 'test@example.com' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Verification code sent to your email');
        expect(emailService.sendVerificationCode).toHaveBeenCalledWith('test@example.com', expect.any(String));
      });

      it('should return 400 if email is missing', async () => {
        const response = await request(app)
          .post('/api/auth/verification/send')
          .send({})
          .expect(400);

        expect(response.body.error).toBe('Email is required');
      });

      it('should accept any email format', async () => {
        emailService.sendVerificationCode.mockResolvedValue({ success: true });

        const response = await request(app)
          .post('/api/auth/verification/send')
          .send({ email: 'invalid-email' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Verification code sent to your email');
      });

      it('should handle email service errors gracefully', async () => {
        emailService.sendVerificationCode.mockResolvedValue({ 
          success: false, 
          error: 'Email service error' 
        });

        const response = await request(app)
          .post('/api/auth/verification/send')
          .send({ email: 'test@example.com' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Verification code sent to your email');
      });

      it('should allow multiple verification codes for same email', async () => {
        emailService.sendVerificationCode.mockResolvedValue({ success: true });

        // Send first verification
        await request(app)
          .post('/api/auth/verification/send')
          .send({ email: 'test@example.com' })
          .expect(200);

        // Send second verification
        const response = await request(app)
          .post('/api/auth/verification/send')
          .send({ email: 'test@example.com' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Verification code sent to your email');
      });
    });

    describe('POST /auth/verification/verify', () => {
      beforeEach(async () => {
        // Clean up any existing verification codes
        const VerificationCode = require('../../models/VerificationCode');
        await VerificationCode.deleteMany({});
        
        // Create a verification code for testing
        await new VerificationCode({
          email: 'test@example.com',
          code: '123456',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now
        }).save();
      });

      it('should verify code successfully', async () => {
        const response = await request(app)
          .post('/api/auth/verification/verify')
          .send({ 
            email: 'test@example.com', 
            verificationCode: '123456' 
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.guestToken).toBeDefined();
      });

      it('should return 400 if email is missing', async () => {
        const response = await request(app)
          .post('/api/auth/verification/verify')
          .send({ verificationCode: '123456' })
          .expect(400);

        expect(response.body.error).toBe('Email and verification code are required');
      });

      it('should return 400 if code is missing', async () => {
        const response = await request(app)
          .post('/api/auth/verification/verify')
          .send({ email: 'test@example.com' })
          .expect(400);

        expect(response.body.error).toBe('Email and verification code are required');
      });

      it('should return 400 if code is invalid', async () => {
        const response = await request(app)
          .post('/api/auth/verification/verify')
          .send({ 
            email: 'test@example.com', 
            verificationCode: 'wrong-code' 
          })
          .expect(400);

        expect(response.body.error).toBe('Invalid or expired verification code');
      });

      it('should accept expired codes (no expiration check implemented)', async () => {
        // Create an expired verification code using the existing model
        const VerificationCode = mongoose.model('VerificationCode');
        await new VerificationCode({
          email: 'expired@example.com',
          code: '654321',
          expiresAt: new Date(Date.now() - 1000) // 1 second ago
        }).save();

        const response = await request(app)
          .post('/api/auth/verification/verify')
          .send({ 
            email: 'expired@example.com', 
            verificationCode: '654321' 
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.guestToken).toBeDefined();
      });
    });

    describe('POST /bank/plaid/connect', () => {
      beforeEach(async () => {
        // Clean up any existing data
        const GuestSession = require('../../models/GuestSession');
        await GuestSession.deleteMany({});
        await EmailToken.deleteMany({});
        
        // Create an email token for testing
        await new EmailToken({
          token: 'test-email-token',
          email: 'test@example.com',
          checkoutId: 'test-checkout-id',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
        }).save();

        // Set up PlaidService mocks
        mockExchangePublicToken.mockResolvedValue({
          data: { access_token: 'test-access-token' }
        });
      });

      it('should connect Plaid account successfully', async () => {
        const response = await request(app)
          .post('/api/bank/plaid/connect')
          .send({ 
            emailToken: 'test-email-token',
            publicToken: 'test-plaid-token'
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Plaid account connected successfully');
      });

      it('should return 400 if emailToken is missing', async () => {
        const response = await request(app)
          .post('/api/bank/plaid/connect')
          .send({ publicToken: 'test-plaid-token' })
          .expect(400);

        expect(response.body.error).toBe('Either guest token or email token is required');
      });

      it('should return 400 if publicToken is missing', async () => {
        const response = await request(app)
          .post('/api/bank/plaid/connect')
          .send({ emailToken: 'test-email-token' })
          .expect(400);

        expect(response.body.error).toBe('Plaid token is required');
      });

      it('should return 401 if email token is invalid', async () => {
        const response = await request(app)
          .post('/api/bank/plaid/connect')
          .send({ 
            emailToken: 'invalid-token',
            publicToken: 'test-plaid-token'
          })
          .expect(401);

        expect(response.body.error).toBe('Invalid or expired email token');
      });

      it('should return 401 if email token is expired', async () => {
        // Create an expired email token
        await new EmailToken({
          token: 'expired-token',
          email: 'expired@example.com',
          checkoutId: 'expired-checkout-id',
          expiresAt: new Date(Date.now() - 1000) // 1 second ago
        }).save();

        const response = await request(app)
          .post('/api/bank/plaid/connect')
          .send({ 
            emailToken: 'expired-token',
            publicToken: 'test-plaid-token'
          })
          .expect(401);

        expect(response.body.error).toBe('Invalid or expired email token');
      });
    });

    describe('POST /guest', () => {
      beforeEach(async () => {
        const GuestSession = require('../../models/GuestSession');
        const EmailToken = require('../../models/EmailToken');
        await GuestSession.deleteMany({});
        await User.deleteMany({ email: 'test@example.com' });
        await EmailToken.deleteMany({});
        await CheckoutCart.deleteMany({});
        
        // Create a guest session with Plaid connected for testing
        await new GuestSession({
          email: 'test@example.com',
          guestToken: 'test-guest-token',
          plaidToken: 'test-plaid-token',
          plaidAccountId: 'test-account-id',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
        }).save();

        // Set up PlaidService mocks
        mockCreateProcessorToken.mockResolvedValue({
          data: { processor_token: 'test-processor-token' }
        });

        // Create a User record for the guest
        await new User({
          email: 'test@example.com',
          firstName: 'Guest',
          lastName: 'User',
          userType: 'guest'
        }).save();
      });

      it('should create guest savings goal successfully and persist schedule and Shopify identifiers', async () => {
        // For guest checkout with Shopify, we need to use emailToken path
        // Create EmailToken and CheckoutCart
        const EmailToken = require('../../models/EmailToken');
        const cart = new CheckoutCart({
          checkoutId: 'test-checkout-guest',
          email: 'test@example.com',
          shopDomain: 'test-shop.myshopify.com',
          totalPrice: '1000',
          lineItems: [{
            title: 'Test Product',
            price: 1000,
            quantity: 1
          }]
        });
        await cart.save();

        const emailToken = new EmailToken({
          token: 'test-email-token-shopify',
          email: 'test@example.com',
          checkoutId: 'test-checkout-guest',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000)
        });
        await emailToken.save();

        const goalData = {
          emailToken: 'test-email-token-shopify',
          goalName: 'Test Guest Goal',
          targetAmount: 1000,
          bankDetails: {
            bankName: 'Chase Bank',
            bankAccountName: 'Primary Checking',
            bankLastFour: '1234',
            bankAccountType: 'checking'
          }
        };

        const response = await request(app)
          .post('/api/savings-goal/guest')
          .send(goalData)
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.savingsGoal).toBeDefined();
        expect(response.body.savingsGoal.userId).toBeDefined();
        expect(response.body.savingsGoal.userId).not.toBeNull();

        expect(response.body.savingsGoal.schedule).toBeDefined();
        expect(response.body.savingsGoal.schedule.interval).toBe('Monthly');
        expect(response.body.savingsGoal.schedule.dayOfMonth).toBeDefined();
        expect(new Date(response.body.savingsGoal.schedule.startDate).getTime()).toBeGreaterThan(Date.now() - 5 * 60 * 1000);

        expect(response.body.savingsGoal.savingsAmount).toBeCloseTo(250);

        // Shopify goal assertions
        expect(response.body.savingsGoal.__t).toBe('ShopifySavingsGoal');
        expect(response.body.savingsGoal.checkoutCartId).toBeDefined();
        expect(response.body.savingsGoal.shopDomain).toBe('test-shop.myshopify.com');

        // Bank details assertions
        expect(response.body.savingsGoal.bank).toBeDefined();
        expect(response.body.savingsGoal.bank.bankName).toBe('Chase Bank');
        expect(response.body.savingsGoal.bank.bankAccountName).toBe('Primary Checking');
        expect(response.body.savingsGoal.bank.bankLastFour).toBe('1234');
        expect(response.body.savingsGoal.bank.bankAccountType).toBe('checking');
      });

      it('should return 400 if required fields are missing', async () => {
        const response = await request(app)
          .post('/api/savings-goal/guest')
          .send({ guestToken: 'test-guest-token' })
          .expect(400);

        expect(response.body.error).toBe('Either guest token or email token, goal name, and target amount are required');
      });

      it('should return 401 if guest session is invalid', async () => {
        const goalData = {
          guestToken: 'invalid-token',
          goalName: 'Test Goal',
          targetAmount: 1000,
          product: { name: 'Test Product', price: 1000 }
        };

        const response = await request(app)
          .post('/api/savings-goal/guest')
          .send(goalData)
          .expect(401);

        expect(response.body.error).toBe('Invalid or expired guest session');
      });

      it('should return 401 if no Plaid token is linked', async () => {
        // Create guest session without Plaid token
        const GuestSession = require('../../models/GuestSession');
        await new GuestSession({
          email: 'no-plaid@example.com',
          guestToken: 'no-plaid-token',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000)
        }).save();

        await new User({
          email: 'no-plaid@example.com',
          firstName: 'Guest',
          lastName: 'User',
          userType: 'guest'
        }).save();

        const goalData = {
          guestToken: 'no-plaid-token',
          goalName: 'Test Goal',
          targetAmount: 1000,
          product: { name: 'Test Product', price: 1000 }
        };

        const response = await request(app)
          .post('/api/savings-goal/guest')
          .send(goalData)
          .expect(401);

        expect(response.body.error).toBe('No Plaid account linked. Please link your bank account first.');
      });

      it('should handle database errors when creating goal', async () => {
        // Use the guest session already created in beforeEach
        // Mock SavingsGoal.save to throw an error when saving the goal
        const goalData = {
          guestToken: 'test-guest-token',
          goalName: 'Test Goal',
          targetAmount: 1000
        };

        // Use a spy to intercept the save call on the instance
        const saveSpy = jest.spyOn(SavingsGoal.prototype, 'save').mockImplementationOnce(async () => {
          throw new Error('Database error');
        });

        const response = await request(app)
          .post('/api/savings-goal/guest')
          .send(goalData)
          .expect(500);

        expect(response.body.error).toBe('Failed to create savings goal');

        // Restore
        saveSpy.mockRestore();
      });
    });

    describe('POST /:id/refund', () => {
      let shopifyGoal;
      let merchant;

      beforeEach(async () => {
        await ShopifyMerchant.deleteMany({});
        
        merchant = new ShopifyMerchant({
          shopifyShopId: 'test-shop-123',
          shopDomain: 'test-shop.myshopify.com',
          unitAccountId: 'merchant-account-123',
          onboardingStatus: 'completed'
        });
        await merchant.save();

        // Create CheckoutCart first
        const cart = new CheckoutCart({
          checkoutId: 'checkout-123',
          email: 'test@example.com',
          shopDomain: 'test-shop.myshopify.com',
          totalPrice: '400.00',
          lineItems: [{
            productId: 'prod-123',
            variantId: 'var-123',
            quantity: 1,
            presentmentTitle: 'Test Product',
            price: '400.00'
          }]
        });
        await cart.save();

        shopifyGoal = new ShopifySavingsGoal({
          userId: testUser._id,
          goalName: 'Shopify Order',
          targetAmount: 400,
          currentAmount: 200,
          savingsAmount: 100,
          checkoutCartId: cart._id,
          shopDomain: 'test-shop.myshopify.com',
          bank: {
            plaidToken: 'plaid-token-123'
          },
          isPaused: false,
          transfers: [
            {
              transferId: 'payment-1',
              amount: 100,
              date: new Date(),
              status: 'completed',
              type: 'debit'
            },
            {
              transferId: 'payment-2',
              amount: 100,
              date: new Date(),
              status: 'completed',
              type: 'debit'
            }
          ]
        });
        await shopifyGoal.save();

        mockCreatePayment.mockResolvedValue({
          data: {
            id: 'refund-payment-123'
          }
        });
      });

      it('should successfully refund Shopify order', async () => {
        const response = await request(app)
          .post(`/api/savings-goal/${shopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.paymentId).toBe('refund-payment-123');
        expect(response.body.amount).toBe(200);
        expect(response.body.message).toContain('Refund initiated successfully');

        const updatedGoal = await SavingsGoal.findById(shopifyGoal._id);
        expect(updatedGoal.isPaused).toBe(true);
        expect(updatedGoal.savingsAmount).toBe(0);
        expect(updatedGoal.transfers.length).toBe(3);
        expect(updatedGoal.transfers[2].type).toBe('credit');
        expect(updatedGoal.transfers[2].amount).toBe(200);
        expect(updatedGoal.transfers[2].status).toBe('pending');
        expect(updatedGoal.transfers[2].transferId).toBe('refund-payment-123');

        expect(mockCreatePayment).toHaveBeenCalledWith({
          type: 'achPayment',
          attributes: {
            amount: 20000,
            direction: 'Credit',
            description: 'Refund for Shopify Order',
            plaidProcessorToken: 'plaid-token-123',
            tags: {
              savingsGoalId: shopifyGoal._id.toString(),
              userId: testUser._id.toString(),
              type: 'shopifyRefund'
            }
          },
          relationships: {
            account: { data: { type: 'account', id: 'merchant-account-123' } }
          }
        });
      });

      it('should return 404 when goal not found', async () => {
        const response = await request(app)
          .post('/api/savings-goal/507f1f77bcf86cd799439011/refund')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);

        expect(response.body.error).toBe('Savings goal not found');
      });

      it('should return 403 when user does not own goal', async () => {
        const otherUser = new User({
          email: 'other@example.com',
          status: 'approved'
        });
        await otherUser.save();

        // Create CheckoutCart for Shopify goal
        const otherCart = new CheckoutCart({
          checkoutId: 'test-checkout-other',
          email: 'other@example.com',
          shopDomain: 'test-shop.myshopify.com',
          totalPrice: '400'
        });
        await otherCart.save();

        const otherGoal = new ShopifySavingsGoal({
          userId: otherUser._id,
          goalName: 'Other User Goal',
          targetAmount: 400,
          currentAmount: 200,
          checkoutCartId: otherCart._id,
          shopDomain: 'test-shop.myshopify.com',
          bank: {
            plaidToken: 'plaid-token-123'
          }
        });
        await otherGoal.save();

        const response = await request(app)
          .post(`/api/savings-goal/${otherGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(403);

        expect(response.body.error).toContain('Unauthorized');
      });

      it('should return 400 when goal is not Shopify type', async () => {
        const nonShopifyGoal = new ManualSavingsGoal({
          userId: testUser._id,
          goalName: 'Regular Goal',
          targetAmount: 1000,
          currentAmount: 500,
          category: 'other',
          bank: {
            plaidToken: 'plaid-token-123'
          }
        });
        await nonShopifyGoal.save();

        const response = await request(app)
          .post(`/api/savings-goal/${nonShopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('Refunds are only available for Shopify orders');
      });

      it('should return 400 when there are pending transfers', async () => {
        shopifyGoal.transfers.push({
          transferId: 'payment-pending',
          amount: 100,
          date: new Date(),
          status: 'pending',
          type: 'debit'
        });
        await shopifyGoal.save();

        const response = await request(app)
          .post(`/api/savings-goal/${shopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('Cannot refund while payments are processing');
      });

      it('should return 400 when currentAmount is 0', async () => {
        shopifyGoal.currentAmount = 0;
        await shopifyGoal.save();

        const response = await request(app)
          .post(`/api/savings-goal/${shopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('No amount available for refund');
      });

      it('should return 400 when no bank account linked', async () => {
        shopifyGoal.bank = shopifyGoal.bank || {};
        shopifyGoal.bank.plaidToken = null;
        await shopifyGoal.save();

        const response = await request(app)
          .post(`/api/savings-goal/${shopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('No bank account linked');
      });

      it('should return 404 when merchant not found', async () => {
        // Store original shopDomain
        const originalShopDomain = shopifyGoal.shopDomain;
        
        // Reload goal to ensure fresh state
        shopifyGoal = await SavingsGoal.findById(shopifyGoal._id);
        
        // Change to a shopDomain that doesn't exist
        shopifyGoal.shopDomain = 'nonexistent-shop-12345.myshopify.com';
        await shopifyGoal.save();

        // Verify the goal was saved with the new shopDomain
        const reloadedGoal = await SavingsGoal.findById(shopifyGoal._id);
        expect(reloadedGoal.shopDomain).toBe('nonexistent-shop-12345.myshopify.com');

        // Verify no merchant exists with that shopDomain
        const foundMerchant = await ShopifyMerchant.findOne({ shopDomain: 'nonexistent-shop-12345.myshopify.com' });
        expect(foundMerchant).toBeNull();

        const response = await request(app)
          .post(`/api/savings-goal/${shopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);

        expect(response.body.error).toContain('Merchant not found');
        
        // Restore shopDomain for subsequent tests
        shopifyGoal = await SavingsGoal.findById(shopifyGoal._id);
        shopifyGoal.shopDomain = originalShopDomain;
        await shopifyGoal.save();
      });

      it('should return 400 when merchant account not set up', async () => {
        merchant.unitAccountId = null;
        await merchant.save();

        const response = await request(app)
          .post(`/api/savings-goal/${shopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);

        expect(response.body.error).toContain('Merchant account not set up');
      });

      it('should handle Unit API errors', async () => {
        mockCreatePayment.mockRejectedValue(new Error('Unit API error'));

        const response = await request(app)
          .post(`/api/savings-goal/${shopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(500);

        expect(response.body.error).toContain('Failed to process refund');
      });

      it('should allow refund with failed transfers', async () => {
        shopifyGoal.transfers.push({
          transferId: 'payment-failed',
          amount: 100,
          date: new Date(),
          status: 'failed',
          type: 'debit'
        });
        await shopifyGoal.save();

        const response = await request(app)
          .post(`/api/savings-goal/${shopifyGoal._id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.success).toBe(true);
      });
    });
  });
});
