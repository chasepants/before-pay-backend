const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const SavingsGoal = require('../../models/SavingsGoal');
const User = require('../../models/User');

describe('Transaction Webhooks', () => {
  let mongoServer;

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
  });

  describe('handleTransactionCreated', () => {
    it('should handle transferBackBatch transaction', async () => {
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
        currentAmount: 100,
        savingsAmount: 100,
        transfers: [{
          transferId: 'transfer-123',
          batchId: 'batch-123',
          amount: 50,
          date: new Date(),
          status: 'pending',
          type: 'credit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        attributes: {
          tags: {
            kind: 'transferBackBatch',
            batchId: 'batch-123'
          }
        },
        relationships: {
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await handleTransactionCreated(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].transactionId).toBe('transaction-123');
      expect(updatedGoal.transfers[0].status).toBe('completed');
      expect(updatedGoal.currentAmount).toBe(50);
    });

    it('should handle single payment transaction', async () => {
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
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          },
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await handleTransactionCreated(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].transactionId).toBe('transaction-123');
      expect(updatedGoal.transfers[0].status).toBe('completed');
      expect(updatedGoal.currentAmount).toBe(100);
    });

    it('should handle credit transfer correctly', async () => {
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
        currentAmount: 200,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 50,
          date: new Date(),
          status: 'pending',
          type: 'credit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          },
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await handleTransactionCreated(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].transactionId).toBe('transaction-123');
      expect(updatedGoal.transfers[0].status).toBe('completed');
      expect(updatedGoal.currentAmount).toBe(150);
    });

    it('should handle credit transfer with minimum amount', async () => {
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
        currentAmount: 50,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: new Date(),
          status: 'pending',
          type: 'credit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          },
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await handleTransactionCreated(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].transactionId).toBe('transaction-123');
      expect(updatedGoal.transfers[0].status).toBe('completed');
      expect(updatedGoal.currentAmount).toBe(0);
    });

    it('should handle missing payment ID', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await expect(handleTransactionCreated(eventData)).resolves.toBeUndefined();
    });

    it('should handle non-existent goal', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'non-existent-payment'
            }
          },
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await expect(handleTransactionCreated(eventData)).resolves.toBeUndefined();
    });

    it('should handle missing transfer in goal', async () => {
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
        transfers: []
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          },
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await expect(handleTransactionCreated(eventData)).resolves.toBeUndefined();
    });

    it('should handle already completed transfer', async () => {
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
        currentAmount: 100,
        savingsAmount: 100,
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: new Date(),
          status: 'completed',
          type: 'debit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          },
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await handleTransactionCreated(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.currentAmount).toBe(100);
    });

    it('should handle Shopify refund transaction correctly', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const goal = new SavingsGoal({
        userId: user._id,
        goalName: 'Shopify Order',
        targetAmount: 400,
        currentAmount: 200,
        savingsAmount: 100,
        isPaused: false,
        product: {
          type: 'Shopify',
          shopDomain: 'test-shop.myshopify.com'
        },
        transfers: [{
          transferId: 'refund-payment-123',
          amount: 200,
          date: new Date(),
          status: 'pending',
          type: 'credit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        attributes: {
          tags: {
            type: 'shopifyRefund',
            savingsGoalId: goal._id.toString(),
            userId: user._id.toString()
          }
        },
        relationships: {
          payment: {
            data: {
              id: 'refund-payment-123'
            }
          },
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await handleTransactionCreated(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].transactionId).toBe('transaction-123');
      expect(updatedGoal.transfers[0].status).toBe('completed');
      expect(updatedGoal.currentAmount).toBe(0);
      expect(updatedGoal.isPaused).toBe(true);
      expect(updatedGoal.savingsAmount).toBe(0);
    });

    it('should handle regular credit transfer (not Shopify refund)', async () => {
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
        currentAmount: 200,
        savingsAmount: 100,
        transfers: [{
          transferId: 'credit-payment-123',
          amount: 50,
          date: new Date(),
          status: 'pending',
          type: 'credit'
        }]
      });
      await goal.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleTransactionCreated } = webhookHandlers;

      const eventData = {
        attributes: {
          tags: {
            type: 'otherTransfer'
          }
        },
        relationships: {
          payment: {
            data: {
              id: 'credit-payment-123'
            }
          },
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await handleTransactionCreated(eventData);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers[0].transactionId).toBe('transaction-123');
      expect(updatedGoal.transfers[0].status).toBe('completed');
      expect(updatedGoal.currentAmount).toBe(150); // 200 - 50
      // Should not be paused for non-Shopify refunds (defaults to false)
      expect(updatedGoal.isPaused).toBe(false);
    });
  });
});
