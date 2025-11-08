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

  // Note: setup-savings route moved to /api/savings-goal/:id/schedule (PUT)
  // Tests should be in savingsGoal.test.js

  // Note: transaction-history route moved to /api/savings-goal/:id/transactions (GET)
  // Tests should be in savingsGoal.test.js

  describe('POST /transfers/batch', () => {
    let testSavingsGoal1, testSavingsGoal2;

    beforeEach(async () => {
      const { ManualSavingsGoal } = require('../../models/SavingsGoal');
      
      testSavingsGoal1 = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal 1',
        targetAmount: 1000,
        currentAmount: 300,
        category: 'other',
        bank: {
          plaidToken: 'plaid-token-1'
        }
      });
      await testSavingsGoal1.save();

      testSavingsGoal2 = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal 2',
        targetAmount: 500,
        currentAmount: 200,
        category: 'other',
        bank: {
          plaidToken: 'plaid-token-2'
        }
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
        .post('/api/bank/transfers/batch')
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
        .post('/api/bank/transfers/batch')
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
        .post('/api/bank/transfers/batch')
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
        .post('/api/bank/transfers/batch')
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
        .post('/api/bank/transfers/batch')
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
        .post('/api/bank/transfers/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(400);

      expect(response.body.error).toBe('Invalid allocation for goal ' + testSavingsGoal1._id);
    });

    it('should return 400 when no destination bank found', async () => {
      // Remove plaid tokens from goals
      testSavingsGoal1.bank = null;
      testSavingsGoal2.bank = null;
      await testSavingsGoal1.save();
      await testSavingsGoal2.save();

      const requestBody = {
        totalAmount: 100,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 100 }
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfers/batch')
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
        .post('/api/bank/transfers/batch')
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
        .post('/api/bank/transfers/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(500);

      expect(response.body.error).toBe('Failed to process transfer back');
    });
  });
});
