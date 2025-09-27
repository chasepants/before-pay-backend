const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const SavingsGoal = require('../../models/SavingsGoal');
const User = require('../../models/User');

jest.mock('@unit-finance/unit-node-sdk', () => {
  return {
    Unit: jest.fn().mockImplementation(() => ({
      payments: {
        create: jest.fn().mockResolvedValue({
          data: {
            id: 'payment-123',
            attributes: {
              amount: 10000,
              direction: 'Debit',
              status: 'Pending'
            }
          }
        })
      }
    }))
  };
});

const { Unit } = require('@unit-finance/unit-node-sdk');

describe('Payment Webhooks', () => {
  let mongoServer;
  let mockUnit;

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
    await SavingsGoal.deleteMany({});
    await User.deleteMany({});
    jest.clearAllMocks();

    mockUnit = new Unit('test-api-key', 'https://api.s.unit.sh');
  });

  describe('handlePaymentCreated', () => {
    it('should update transfer status to pending', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const goal = new SavingsGoal({
        userId: user._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: new Date(),
          status: 'created',
          type: 'debit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      await handlePaymentCreated(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].status).toBe('pending');
    });

    it('should handle payment not found', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'non-existent-payment'
            }
          }
        }
      };

      await expect(handlePaymentCreated(eventData)).resolves.toBeUndefined();
    });

    it('should handle missing payment ID', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentCreated } = webhookHandlers;

      const eventData = {};

      await expect(handlePaymentCreated(eventData)).resolves.toBeUndefined();
    });
  });

  describe('handlePaymentClearing', () => {
    it('should update transfer status to pending', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const goal = new SavingsGoal({
        userId: user._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: new Date(),
          status: 'created',
          type: 'debit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentClearing } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      await handlePaymentClearing(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].status).toBe('pending');
    });
  });

  describe('handlePaymentSent', () => {
    it('should update transfer status to pending', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const goal = new SavingsGoal({
        userId: user._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: new Date(),
          status: 'created',
          type: 'debit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentSent } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      await handlePaymentSent(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].status).toBe('pending');
    });
  });

  describe('handlePaymentRejected', () => {
    it('should update transfer status to failed', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const goal = new SavingsGoal({
        userId: user._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: new Date(),
          status: 'pending',
          type: 'debit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentRejected } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      await handlePaymentRejected(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].status).toBe('failed');
    });
  });

  describe('handlePaymentReturned', () => {
    it('should update transfer status to failed', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const goal = new SavingsGoal({
        userId: user._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: new Date(),
          status: 'pending',
          type: 'debit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentReturned } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      await handlePaymentReturned(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].status).toBe('failed');
    });
  });

  describe('handlePaymentCanceled', () => {
    it('should update transfer status to canceled', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const goal = new SavingsGoal({
        userId: user._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 0,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: new Date(),
          status: 'pending',
          type: 'debit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentCanceled } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      await handlePaymentCanceled(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].status).toBe('canceled');
    });
  });
});
