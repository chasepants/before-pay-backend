const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

jest.mock('../../services/plaidService');
jest.mock('../../services/unitService');

const User = require('../../models/User');
const SavingsGoal = require('../../models/SavingsGoal');
const GuestSession = require('../../models/GuestSession');
const EmailToken = require('../../models/EmailToken');

let mockExchangePublicToken = jest.fn();
let mockCreateProcessorToken = jest.fn();
let mockCreateLinkToken = jest.fn();

jest.mock('../../services/plaidService', () => {
  return jest.fn().mockImplementation(() => {
    return {
      exchangePublicToken: mockExchangePublicToken,
      createProcessorToken: mockCreateProcessorToken,
      createLinkToken: mockCreateLinkToken,
    };
  });
});

let mockSavingsGoalService = {
  createBatchTransfer: jest.fn()
};

jest.mock('../../services/savingsGoalService', () => {
  return jest.fn().mockImplementation(() => mockSavingsGoalService);
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
    await GuestSession.deleteMany({});
    await EmailToken.deleteMany({});
    
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
      mockSavingsGoalService.createBatchTransfer.mockResolvedValue({
        paymentId: 'ach-payment-123',
        batchId: 'batch-123',
        processed: 2
      });

      const requestBody = {
        totalAmount: 500,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id, amount: 300 },
          { savingsGoalId: testSavingsGoal2._id, amount: 200 }
        ]
      };

      const response = await request(app)
        .post('/api/bank/transfers/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send(requestBody)
        .expect(200);

      expect(response.body.paymentId).toBe('ach-payment-123');
      expect(response.body.batchId).toBe('batch-123');
      expect(response.body.processed).toBe(2);

      expect(mockSavingsGoalService.createBatchTransfer).toHaveBeenCalledWith({
        totalAmount: 500,
        allocations: [
          { savingsGoalId: testSavingsGoal1._id.toString(), amount: 300 },
          { savingsGoalId: testSavingsGoal2._id.toString(), amount: 200 }
        ],
        goals: expect.arrayContaining([
          expect.objectContaining({ _id: testSavingsGoal1._id }),
          expect.objectContaining({ _id: testSavingsGoal2._id })
        ]),
        goalsById: expect.any(Map),
        batchId: expect.any(String)
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

    it('should return 500 when no destination bank found', async () => {
      // Remove plaid tokens from goals
      testSavingsGoal1.bank = null;
      testSavingsGoal2.bank = null;
      await testSavingsGoal1.save();
      await testSavingsGoal2.save();

      mockSavingsGoalService.createBatchTransfer.mockRejectedValue(
        new Error('No destination bank found for transfer back')
      );

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

    it('should return 500 when user has no Unit account', async () => {
      testUser.unitAccountId = null;
      await testUser.save();

      // Mock createBatchTransfer to throw error when unitAccountId is missing
      mockSavingsGoalService.createBatchTransfer.mockRejectedValue(
        new Error('does not have a unitAccountId')
      );

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

    it('should return 500 when payment creation fails', async () => {
      mockSavingsGoalService.createBatchTransfer.mockRejectedValue(new Error('Payment creation failed'));

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

  describe('POST /plaid/link-token', () => {
    it('should return 400 when neither guestToken nor emailToken is provided', async () => {
      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Either guest token or email token is required');
    });

    it('should return 401 when guestToken is invalid', async () => {
      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ guestToken: 'invalid-token' })
        .expect(401);

      expect(response.body.error).toBe('Invalid or expired guest session');
    });

    it('should return 401 when guestSession is expired', async () => {
      const expiredSession = new GuestSession({
        email: 'guest@example.com',
        guestToken: 'expired-token',
        expiresAt: new Date(Date.now() - 1000) // Expired 1 second ago
      });
      await expiredSession.save();

      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ guestToken: 'expired-token' })
        .expect(401);

      expect(response.body.error).toBe('Guest session expired');

      // Verify session was deleted
      const deletedSession = await GuestSession.findOne({ guestToken: 'expired-token' });
      expect(deletedSession).toBeNull();
    });

    it('should successfully create link token with valid guestToken', async () => {
      const guestSession = new GuestSession({
        email: 'guest@example.com',
        guestToken: 'valid-guest-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
      });
      await guestSession.save();

      mockCreateLinkToken.mockResolvedValue({
        data: {
          link_token: 'plaid-link-token-123',
          expiration: '2024-12-31T23:59:59Z'
        }
      });

      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ guestToken: 'valid-guest-token' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.linkToken).toBe('plaid-link-token-123');
      expect(response.body.expiration).toBe('2024-12-31T23:59:59Z');
      expect(mockCreateLinkToken).toHaveBeenCalledWith(guestSession._id, 'StashPay Guest Checkout');
    });

    it('should return 401 when emailToken is invalid', async () => {
      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ emailToken: 'invalid-token' })
        .expect(401);

      expect(response.body.error).toBe('Invalid or expired email token');
    });

    it('should return 401 when emailToken is expired', async () => {
      const expiredToken = new EmailToken({
        email: 'test@example.com',
        token: 'expired-email-token',
        checkoutId: 'checkout-123',
        expiresAt: new Date(Date.now() - 1000) // Expired 1 second ago
      });
      await expiredToken.save();

      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ emailToken: 'expired-email-token' })
        .expect(401);

      expect(response.body.error).toBe('Invalid or expired email token');
    });

    it('should successfully create link token with valid emailToken', async () => {
      const emailToken = new EmailToken({
        email: 'test@example.com',
        token: 'valid-email-token',
        checkoutId: 'checkout-456',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
      });
      await emailToken.save();

      mockCreateLinkToken.mockResolvedValue({
        data: {
          link_token: 'plaid-link-token-456',
          expiration: '2024-12-31T23:59:59Z'
        }
      });

      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ emailToken: 'valid-email-token' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.linkToken).toBe('plaid-link-token-456');
      expect(response.body.expiration).toBe('2024-12-31T23:59:59Z');
      expect(mockCreateLinkToken).toHaveBeenCalledWith('valid-email-token', 'StashPay Savings Plan');
    });

    it('should return 500 when Plaid service throws error with response data', async () => {
      const guestSession = new GuestSession({
        email: 'guest@example.com',
        guestToken: 'valid-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      await guestSession.save();

      const plaidError = new Error('Plaid API error');
      plaidError.response = {
        data: { error_code: 'INVALID_REQUEST', error_message: 'Invalid request' }
      };
      mockCreateLinkToken.mockRejectedValue(plaidError);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ guestToken: 'valid-token' })
        .expect(500);

      expect(response.body.error).toBe('Failed to create Plaid link token: Plaid API error');
      expect(response.body.details).toEqual({ error_code: 'INVALID_REQUEST', error_message: 'Invalid request' });

      expect(consoleErrorSpy).toHaveBeenCalledWith('Plaid link token creation error:', 'Plaid API error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Plaid error details:', { error_code: 'INVALID_REQUEST', error_message: 'Invalid request' });

      consoleErrorSpy.mockRestore();
    });

    it('should return 500 when Plaid service throws error without response data', async () => {
      const guestSession = new GuestSession({
        email: 'guest@example.com',
        guestToken: 'valid-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      await guestSession.save();

      const plaidError = new Error('Network error');
      mockCreateLinkToken.mockRejectedValue(plaidError);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ guestToken: 'valid-token' })
        .expect(500);

      expect(response.body.error).toBe('Failed to create Plaid link token: Network error');
      expect(response.body.details).toBe('No additional details available');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Plaid link token creation error:', 'Network error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Plaid error details:', plaidError);

      consoleErrorSpy.mockRestore();
    });

    it('should return 500 when outer catch block catches an error', async () => {
      // Mock GuestSession.findOne to throw an error
      jest.spyOn(GuestSession, 'findOne').mockImplementation(() => {
        throw new Error('Database error');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await request(app)
        .post('/api/bank/plaid/link-token')
        .send({ guestToken: 'valid-token' })
        .expect(500);

      expect(response.body.error).toBe('Failed to create Plaid link token');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Plaid link token error:', 'Database error');

      consoleErrorSpy.mockRestore();
      GuestSession.findOne.mockRestore();
    });
  });
});
