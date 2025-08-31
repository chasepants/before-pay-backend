const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

// Import the router and models
const savingsGoalRouter = require('../routes/savingsGoal');
const User = require('../models/User');
const SavingsGoal = require('../models/SavingsGoal');
const { generateImage, enhanceDescription } = require('../services/xaiService');

// Create Express app for testing
const app = express();
app.use(express.json());
app.use('/api/savings-goal', savingsGoalRouter);

// At the very top of the test file, before any other code
jest.mock('../services/xaiService', () => ({
  generateImage: jest.fn(),
  enhanceDescription: jest.fn()
}));

// Now import the mocked functions
const xaiService = require('../services/xaiService');

describe('SavingsGoal Routes', () => {
  let mongoServer;
  let testUser;
  let authToken;

  beforeAll(async () => {
    // Start in-memory MongoDB server
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    // Clean up
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear all collections before each test
    await User.deleteMany({});
    await SavingsGoal.deleteMany({});

    // Create a test user
    testUser = new User({
      email: 'test@example.com',
      googleId: 'test-google-id',
      status: 'approved',
      unitCustomerId: 'test-customer-id'
    });
    await testUser.save();

    // Create auth token for the test user
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
      // Create token with non-existent user ID
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
      // Create test savings goals
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
      // Create another user
      const otherUser = new User({
        email: 'other@example.com',
        googleId: 'other-google-id',
        status: 'approved'
      });
      await otherUser.save();

      // Create goal for other user
      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other User Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      // Create goal for test user
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
      // Mock a database error by temporarily breaking the connection
      const originalFind = SavingsGoal.find;
      SavingsGoal.find = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch savings goals');

      // Restore original function
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
      // Create another user
      const otherUser = new User({
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'User'
      });
      await otherUser.save();

      // Create goal for other user
      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other User Goal',
        targetAmount: 1000,
        currentAmount: 0
      });
      await otherGoal.save();

      // Try to access other user's goal
      const response = await request(app)
        .get(`/api/savings-goal/${otherGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');

      // Clean up
      await User.deleteOne({ _id: otherUser._id });
      await SavingsGoal.deleteOne({ _id: otherGoal._id });
    });

    it('should return savings goal when it exists and belongs to authenticated user', async () => {
      // Create test savings goal
      const testGoal = new SavingsGoal({
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
      // Mock a database error
      const originalFindOne = SavingsGoal.findOne;
      SavingsGoal.findOne = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/savings-goal/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Failed to fetch savings goal');

      // Restore original function
      SavingsGoal.findOne = originalFindOne;
    });

    it('should return 400 when invalid ObjectId is provided', async () => {
      const response = await request(app)
        .get('/api/savings-goal/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500); // Mongoose will throw an error for invalid ObjectId

      expect(response.body.error).toBe('Failed to fetch savings goal');
    });

    it('should handle savings goal with nested product data', async () => {
      // Create test savings goal with product data
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'New Laptop',
        targetAmount: 1500,
        currentAmount: 500,
        product: {
          title: 'MacBook Pro',
          price: '$1499',
          thumbnail: 'https://example.com/laptop.jpg',
          source: 'Apple Store',
          rating: 4.8,
          reviews: 1250
        }
      });
      await testGoal.save();

      const response = await request(app)
        .get(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.product.title).toBe('MacBook Pro');
      expect(response.body.product.price).toBe('$1499');
      expect(response.body.product.thumbnail).toBe('https://example.com/laptop.jpg');
      expect(response.body.product.source).toBe('Apple Store');
      expect(response.body.product.rating).toBe(4.8);
      expect(response.body.product.reviews).toBe(1250);
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

      expect(response.body.product.title).toBe('MacBook Pro');
      expect(response.body.product.price).toBe('1499');
      expect(response.body.product.thumbnail).toBe('https://example.com/laptop.jpg');
      expect(response.body.product.source).toBe('Apple Store');
      expect(response.body.product.rating).toBe(4.8);
      expect(response.body.product.reviews).toBe(1250);
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
        extracted_price: '1500.50',
        extracted_old_price: '1800.25'
      };

      const response = await request(app)
        .post('/api/savings-goal')
        .set('Authorization', `Bearer ${authToken}`)
        .send(goalData)
        .expect(201);

      expect(response.body.targetAmount).toBe(2000);
      expect(response.body.product.extracted_price).toBe(1500.50);
      expect(response.body.product.extracted_old_price).toBe(1800.25);
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

      expect(response.body.product.extracted_price).toBeUndefined();
      expect(response.body.product.extracted_old_price).toBeUndefined();
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
      console.log(response.body);
      expect(response.body.product.product_id).toBe('gaming-123');
      expect(response.body.product.serpapi_product_api).toBe('https://serpapi.com/product');
      expect(response.body.product.source_icon).toBe('https://example.com/icon.png');
      expect(response.body.product.badge).toBe('Best Seller');
      expect(response.body.product.tag).toBe('Gaming');
      expect(response.body.product.delivery).toBe('Free Shipping');
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
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Product Goal to Delete',
        targetAmount: 3000,
        currentAmount: 1000,
        product: {
          title: 'Test Product',
          price: 2999,
          source: 'Test Store',
          rating: 4.5,
          reviews: 100
        }
      });
      await testGoal.save();

      // Verify it exists with product data
      const savedGoal = await SavingsGoal.findById(testGoal._id);
      expect(savedGoal.product.title).toBe('Test Product');
      expect(savedGoal.product.price).toBe('2999');

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
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        product: {
          description: 'Original description'
        }
      });
      await testGoal.save();

      const updateData = { description: 'Updated description' };

      const response = await request(app)
        .put(`/api/savings-goal/${testGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.product.description).toBe('Updated description');
      expect(response.body.goalName).toBe('Test Goal'); // Should remain unchanged

      // Verify it was saved to database
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.product.description).toBe('Updated description');

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
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Original Goal',
        targetAmount: 1000,
        currentAmount: 0,
        product: {
          description: 'Original description'
        }
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
      expect(response.body.product.description).toBe('Updated description');
      expect(response.body.targetAmount).toBe(2500);

      // Verify it was saved to database
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.goalName).toBe('Updated Goal');
      expect(updatedGoal.product.description).toBe('Updated description');
      expect(updatedGoal.targetAmount).toBe(2500);

      // Clean up
      await SavingsGoal.deleteOne({ _id: testGoal._id });
    });

    it('should handle partial updates without affecting other fields', async () => {
      // Create a test savings goal with more data
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Original Goal',
        targetAmount: 1000,
        currentAmount: 500,
        category: 'trip',
        product: {
          title: 'Original Product',
          price: 999,
          source: 'Original Store'
        }
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
      expect(response.body.product.title).toBe('Original Product'); // Unchanged
      expect(response.body.product.price).toBe('999'); // Unchanged
      expect(response.body.product.source).toBe('Original Store'); // Unchanged

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
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Comprehensive Test Goal',
        targetAmount: 5000,
        currentAmount: 2500,
        category: 'trip',
        product: {
          title: 'Test Product',
          price: 4999,
          source: 'Test Store'
        },
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
      expect(response.body.product.title).toBe('Test Product');
      expect(response.body.product.price).toBe('4999');
      expect(response.body.product.source).toBe('Test Store');
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

  describe('POST /:id/ai-insights', () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();
    });

    it('should return 401 when no token is provided', async () => {
      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/ai-insights')
        .send({ type: 'description-enhancement', prompt: 'Test prompt' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 401 when invalid token is provided', async () => {
      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/ai-insights')
        .set('Authorization', 'Bearer invalid-token')
        .send({ type: 'description-enhancement', prompt: 'Test prompt' })
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
        .post('/api/savings-goal/507f1f77bcf86cd799439011/ai-insights')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send({ type: 'description-enhancement', prompt: 'Test prompt' })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: User not found');
    });

    it('should return 404 when savings goal does not exist', async () => {
      const response = await request(app)
        .post('/api/savings-goal/507f1f77bcf86cd799439011/ai-insights')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'description-enhancement', prompt: 'Test prompt' })
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
        .post(`/api/savings-goal/${otherGoal._id}/ai-insights`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'description-enhancement', prompt: 'Test prompt' })
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');

      // Clean up
      await User.deleteOne({ _id: otherUser._id });
      await SavingsGoal.deleteOne({ _id: otherGoal._id });
    });

    it('should successfully enhance description when valid prompt is provided', async () => {
      // Mock the enhanceDescription function
      xaiService.enhanceDescription.mockResolvedValue('Enhanced description text');

      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for AI',
        targetAmount: 1000,
        currentAmount: 0,
        description: 'Original description'
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/ai-insights`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          type: 'description-enhancement', 
          prompt: 'Enhance this description' 
        })
        .expect(200);

      expect(response.body.enhancedDescription).toBe('Enhanced description text');
      expect(response.body.goal.description).toBe('Enhanced description text');
      expect(xaiService.enhanceDescription).toHaveBeenCalledWith('Enhance this description');
    });

    it('should return 500 when xAI service fails', async () => {
      // Mock the enhanceDescription function to throw an error
      xaiService.enhanceDescription.mockRejectedValue(new Error('xAI service unavailable'));

      // Create a test savings goal
      const testGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal for AI',
        targetAmount: 1000,
        currentAmount: 0,
        description: 'Original description'
      });
      await testGoal.save();

      const response = await request(app)
        .post(`/api/savings-goal/${testGoal._id}/ai-insights`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          type: 'description-enhancement', 
          prompt: 'Enhance this description' 
        })
        .expect(500);

      expect(response.body.error).toBe('Failed to generate AI insights');
      expect(xaiService.enhanceDescription).toHaveBeenCalledWith('Enhance this description');
    });
  });
});
