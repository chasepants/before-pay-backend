const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

jest.mock('../../services/plaidService');
jest.mock('../../services/unitService');

const User = require('../../models/User');
const SavingsGoal = require('../../models/SavingsGoal');

let mockExchangePublicToken = jest.fn();
let mockCreateProcessorToken = jest.fn();

jest.mock('../../services/plaidService', () => {
  return jest.fn().mockImplementation(() => {
    return {
      exchangePublicToken: mockExchangePublicToken,
      createProcessorToken: mockCreateProcessorToken,
    };
  });
});

let mockCreatePayment = jest.fn();
jest.mock('../../services/unitService', () => {
  return jest.fn().mockImplementation(() => {
    return {
      createPayment: mockCreatePayment,
    };
  });
});

const bankRouter = require('../../routes/bank');

const app = express();
app.use(express.json());
app.use('/api/bank', bankRouter);


describe('Bank Routes', () => {
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
    
    testUser = new User({
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User'
    });
    await testUser.save();
    
    authToken = jwt.sign({ userId: testUser._id }, process.env.JWT_SECRET || 'test-secret');
    
    jest.clearAllMocks();
  });

  describe('POST /plaid-link-token', () => {
    it('should successfully create Plaid link token', async () => {
      // Mock axios response
      const mockAxiosResponse = { data: { link_token: 'link-token-123' } };
      jest.spyOn(require('axios'), 'post').mockResolvedValue(mockAxiosResponse);

      const response = await request(app)
        .post('/api/bank/plaid-link-token')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.link_token).toBe('link-token-123');
    });

    it('should return 500 when Plaid API call fails', async () => {
      jest.spyOn(require('axios'), 'post').mockRejectedValue(new Error('Plaid API error'));

      const response = await request(app)
        .post('/api/bank/plaid-link-token')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Failed to create Plaid link token');
    });

    it('should return 401 when no token provided', async () => {
      const response = await request(app)
        .post('/api/bank/plaid-link-token')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });
  });

  describe('POST /setup-savings', () => {
    let testSavingsGoal;

    beforeEach(async () => {
      testSavingsGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        category: 'other'
      });
      await testSavingsGoal.save();
    });

    it('should successfully setup savings with weekly schedule', async () => {
      mockExchangePublicToken.mockResolvedValue({
        data: {
          access_token: 'access-token-123',
          item_id: 'item-123'
        }
      });

      mockCreateProcessorToken.mockResolvedValue({
        data: {
          processor_token: 'processor-token-123'
        }
      });

      const requestBody = {
        savingsGoalId: testSavingsGoal._id,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: { startTime: '2025-01-06T00:00:00.000Z', interval: 'Weekly' }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(200);

      expect(response.body.success).toBe(true);
      
      expect(mockExchangePublicToken).toHaveBeenCalledWith('public-token-123');
      expect(mockCreateProcessorToken).toHaveBeenCalledWith('access-token-123', 'account-123');
    });

    it('should successfully setup savings with monthly schedule', async () => {
      mockExchangePublicToken.mockResolvedValue({
        data: {
          access_token: 'access-token-123',
          item_id: 'item-123'
        }
      });

      mockCreateProcessorToken.mockResolvedValue({
        data: {
          processor_token: 'processor-token-123'
        }
      });

      const requestBody = {
        savingsGoalId: testSavingsGoal._id,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: { startTime: '2025-01-15T00:00:00.000Z', interval: 'Monthly' }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 400 when required fields are missing', async () => {
      const requestBody = {
        savingsGoalId: testSavingsGoal._id,
        plaidAccountId: 'account-123',
        amount: 100
        // Missing schedule
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('savingsGoalId, plaidAccountId, amount, and schedule are required');
    });

    it('should return 400 when startTime and interval are missing', async () => {
      const requestBody = {
        savingsGoalId: testSavingsGoal._id,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: {
          startTime: '2025-01-06T00:00:00.000Z'
          // Missing interval
        }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('startTime and interval are required');
    });

    it('should return 400 when interval is invalid', async () => {
      const requestBody = {
        savingsGoalId: testSavingsGoal._id,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: {
          startTime: '2025-01-06T00:00:00.000Z',
          interval: 'Daily' // Invalid interval
        }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('interval must be Weekly or Monthly');
    });

    it('should return 400 when dayOfMonth is invalid', async () => {
      const requestBody = {
        savingsGoalId: testSavingsGoal._id,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: {
          startTime: '2025-01-30T00:00:00.000Z', // 30th (invalid for monthly)
          interval: 'Monthly'
        }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('dayOfMonth must be between 1-28 or -5 to -1');
    });

    it('should return 404 when savings goal not found', async () => {
      const fakeGoalId = new mongoose.Types.ObjectId();
      const requestBody = {
        savingsGoalId: fakeGoalId,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: {
          startTime: '2025-01-06T00:00:00.000Z',
          interval: 'Weekly'
        }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found or unauthorized');
    });

    it('should return 404 when savings goal belongs to different user', async () => {
      const otherUser = new User({
        email: 'other@example.com',
        firstName: 'Other',
        lastName: 'User'
      });
      await otherUser.save();

      const otherGoal = new SavingsGoal({
        userId: otherUser._id,
        goalName: 'Other Goal',
        targetAmount: 1000,
        currentAmount: 0,
        category: 'other'
      });
      await otherGoal.save();

      const requestBody = {
        savingsGoalId: otherGoal._id,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: {
          startTime: '2025-01-06T00:00:00.000Z',
          interval: 'Weekly'
        }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found or unauthorized');
    });

    it('should return 500 when Plaid token exchange fails', async () => {
      mockExchangePublicToken.mockRejectedValue(new Error('Plaid API error'));

      const requestBody = {
        savingsGoalId: testSavingsGoal._id,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: {
          startTime: '2025-01-06T00:00:00.000Z',
          interval: 'Weekly'
        }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(500);

      expect(response.body.error).toContain('Failed to set up savings plan');
    });

    it('should return 500 when Plaid processor token creation fails', async () => {
      mockExchangePublicToken.mockResolvedValue({
        data: {
          access_token: 'access-token-123',
          item_id: 'item-123'
        }
      });

      mockCreateProcessorToken.mockRejectedValue(new Error('Processor token creation failed'));

      const requestBody = {
        savingsGoalId: testSavingsGoal._id,
        plaidAccessToken: 'public-token-123',
        plaidAccountId: 'account-123',
        amount: 100,
        schedule: {
          startTime: '2025-01-06T00:00:00.000Z',
          interval: 'Weekly'
        }
      };

      const response = await request(app)
        .post('/api/bank/setup-savings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(500);

      expect(response.body.error).toContain('Failed to set up savings plan');
    });
  });

  describe('GET /transaction-history/:savingsGoalId', () => {
    let testSavingsGoal;

    beforeEach(async () => {
      testSavingsGoal = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        category: 'other',
        transfers: [
          {
            date: new Date('2025-01-01'),
            amount: 100,
            status: 'completed',
            type: 'debit'
          },
          {
            date: new Date('2025-01-02'),
            amount: 50,
            status: 'pending',
            type: 'credit'
          }
        ]
      });
      await testSavingsGoal.save();
    });

    it('should return transaction history for savings goal', async () => {
      const response = await request(app)
        .get(`/api/bank/transaction-history/${testSavingsGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.transactions).toHaveLength(2);
      expect(response.body.transactions[0]).toEqual({
        date: Math.floor(new Date('2025-01-01').getTime() / 1000),
        amount: 100,
        status: 'completed',
        type: 'debit'
      });
      expect(response.body.transactions[1]).toEqual({
        date: Math.floor(new Date('2025-01-02').getTime() / 1000),
        amount: 50,
        status: 'pending',
        type: 'credit'
      });
    });

    it('should return 404 when savings goal not found', async () => {
      const fakeGoalId = new mongoose.Types.ObjectId();
      
      const response = await request(app)
        .get(`/api/bank/transaction-history/${fakeGoalId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.error).toBe('Savings goal not found');
    });

    it('should return 401 when no token provided', async () => {
      const response = await request(app)
        .get(`/api/bank/transaction-history/${testSavingsGoal._id}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized: No token provided');
    });

    it('should return 500 when database error occurs', async () => {
      // Mock the findById method to throw an error
      jest.spyOn(SavingsGoal, 'findById').mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app)
        .get(`/api/bank/transaction-history/${testSavingsGoal._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });

  describe('POST /transfer-back-batch', () => {
    let testSavingsGoal1, testSavingsGoal2;
    let mockUnitService;

    beforeEach(async () => {
      testSavingsGoal1 = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal 1',
        targetAmount: 1000,
        currentAmount: 300,
        category: 'other',
        plaidToken: 'plaid-token-1'
      });
      await testSavingsGoal1.save();

      testSavingsGoal2 = new SavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal 2',
        targetAmount: 500,
        currentAmount: 200,
        category: 'other',
        plaidToken: 'plaid-token-2'
      });
      await testSavingsGoal2.save();

      testUser.unitAccountId = 'unit-account-123';
      await testUser.save();
    });

    it('should successfully process batch transfer back', async () => {
      mockCreatePayment.mockResolvedValue({
        data: {
          id: 'ach-payment-123',
          type: 'achPayment'
        }
      });

      const requestBody = {
        totalAmount: 500,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 300 },
          { savingsGoalId: testSavingsGoal2._id, amount: 200 }
        ]
      };

      await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(200);

      expect(mockCreatePayment).toHaveBeenCalledWith({
        type: 'achPayment',
        attributes: {
          amount: 50000,
          direction: 'Credit',
          description: 'Transfer Back',
          plaidProcessorToken: 'plaid-token-1',
          tags: { 
            kind: 'transferBackBatch', 
            batchId: expect.any(String) 
          }
        },
        relationships: {
          account: { 
            data: { 
              type: 'account', 
              id: 'unit-account-123' 
            } 
          }
        }
      });
    });

    it('should return 400 when totalAmount is invalid', async () => {
      const requestBody = {
        totalAmount: -100,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 100 }
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('Invalid totalAmount');
    });

    it('should return 400 when no allocations provided', async () => {
      const requestBody = {
        totalAmount: 100,
        allocations: []
      };

      const response = await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('No allocations provided');
    });

    it('should return 400 when allocations do not sum to totalAmount', async () => {
      const requestBody = {
        totalAmount: 500,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 300 },
          { savingsGoalId: testSavingsGoal2._id, amount: 150 } // Sum is 450, not 500
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('Allocations must sum to totalAmount');
    });

    it('should return 400 when goal not found', async () => {
      const requestBody = {
        totalAmount: 100,
        allocations: [
          { savingsGoalId: '507f1f77bcf86cd799439011', amount: 100 } // Non-existent goal ID
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('Goal not found: 507f1f77bcf86cd799439011');
    });

    it('should return 400 when allocation amount exceeds current amount', async () => {
      const requestBody = {
        totalAmount: 500,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 500 } // Goal only has 300 current amount
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('Invalid allocation for goal ' + testSavingsGoal1._id);
    });

    it('should return 400 when no destination bank found', async () => {
      // Remove plaid tokens from goals
      testSavingsGoal1.plaidToken = null;
      testSavingsGoal2.plaidToken = null;
      await testSavingsGoal1.save();
      await testSavingsGoal2.save();

      const requestBody = {
        totalAmount: 100,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 100 }
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('No destination bank found for transfer back');
    });

    it('should return 400 when user has no Unit account', async () => {
      testUser.unitAccountId = null;
      await testUser.save();

      const requestBody = {
        totalAmount: 100,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 100 }
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('No Unit account on user');
    });

    it('should return 500 when Unit API call fails', async () => {
      mockCreatePayment.mockRejectedValue(new Error('Unit API error'));

      const requestBody = {
        totalAmount: 100,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 100 }
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfer-back-batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(500);

      expect(response.body.error).toBe('Failed to process transfer back');
    });
  });
});
