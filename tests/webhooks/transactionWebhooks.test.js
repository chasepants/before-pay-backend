const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const SavingsGoal = require('../../models/SavingsGoal');
const Payment = require('../../models/Payment');
const PaymentAccount = require('../../models/PaymentAccount');
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
    await Payment.deleteMany({});
    await PaymentAccount.deleteMany({});
    await SavingsGoal.deleteMany({});
    await User.deleteMany({});
    jest.clearAllMocks();
    
    // Set UNIT_API_KEY for tests
    process.env.UNIT_API_KEY = 'test-api-key';
  });

  describe('handleTransactionCreated', () => {
    it('should handle transferBackBatch transaction', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const paymentAccount = new PaymentAccount({
        userId: user._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

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

      // Create Payment record for batch transfer
      const payment = new Payment({
        paymentId: 'transfer-123',
        savingsGoalId: goal._id,
        userId: user._id,
        paymentAccountId: paymentAccount._id,
        direction: 'Credit',
        amount: 50,
        paymentType: 'transfer_back_batch',
        status: 'pending',
        batchId: 'batch-123'
      });
      await payment.save();

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

      const paymentAccount = new PaymentAccount({
        userId: user._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

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

      // Create Payment record
      const payment = new Payment({
        paymentId: 'payment-123',
        savingsGoalId: goal._id,
        userId: user._id,
        paymentAccountId: paymentAccount._id,
        direction: 'Debit',
        amount: 100,
        paymentType: 'manual_installment',
        status: 'pending'
      });
      await payment.save();

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

      const paymentAccount = new PaymentAccount({
        userId: user._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

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

      // Create Payment record
      const payment = new Payment({
        paymentId: 'payment-123',
        savingsGoalId: goal._id,
        userId: user._id,
        paymentAccountId: paymentAccount._id,
        direction: 'Credit',
        amount: 50,
        paymentType: 'transfer_back',
        status: 'pending'
      });
      await payment.save();

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

      const paymentAccount = new PaymentAccount({
        userId: user._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

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

      // Create Payment record
      const payment = new Payment({
        paymentId: 'payment-123',
        savingsGoalId: goal._id,
        userId: user._id,
        paymentAccountId: paymentAccount._id,
        direction: 'Credit',
        amount: 100,
        paymentType: 'transfer_back',
        status: 'pending'
      });
      await payment.save();

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

    it('should handle non-existent payment gracefully', async () => {
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

      // Should throw error but be caught and logged
      await expect(handleTransactionCreated(eventData)).rejects.toThrow('Payment not found');
    });

    it('should handle missing payment gracefully', async () => {
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

      // Should throw error but be caught and logged
      await expect(handleTransactionCreated(eventData)).rejects.toThrow('Payment not found');
    });

    it('should handle already completed transfer', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123',
        unitAccountId: 'account-123'
      });
      await user.save();

      const paymentAccount = new PaymentAccount({
        userId: user._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

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

      // Create Payment record
      const payment = new Payment({
        paymentId: 'payment-123',
        savingsGoalId: goal._id,
        userId: user._id,
        paymentAccountId: paymentAccount._id,
        direction: 'Debit',
        amount: 100,
        paymentType: 'manual_installment',
        status: 'completed'
      });
      await payment.save();

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

      const paymentAccount = new PaymentAccount({
        userId: user._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const { ShopifySavingsGoal } = require('../../models/SavingsGoal');
      const goal = new ShopifySavingsGoal({
        userId: user._id,
        goalName: 'Shopify Order',
        targetAmount: 400,
        currentAmount: 200,
        savingsAmount: 100,
        isPaused: false,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        transfers: [{
          transferId: 'refund-payment-123',
          amount: 200,
          date: new Date(),
          status: 'pending',
          type: 'credit'
        }]
      });
      await goal.save();

      // Create Payment record
      const payment = new Payment({
        paymentId: 'refund-payment-123',
        savingsGoalId: goal._id,
        userId: user._id,
        paymentAccountId: paymentAccount._id,
        direction: 'Credit',
        amount: 200,
        paymentType: 'refund',
        status: 'pending',
        tags: {
          type: 'shopifyRefund',
          savingsGoalId: goal._id.toString(),
          userId: user._id.toString()
        }
      });
      await payment.save();

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

      const paymentAccount = new PaymentAccount({
        userId: user._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

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

      // Create Payment record
      const payment = new Payment({
        paymentId: 'credit-payment-123',
        savingsGoalId: goal._id,
        userId: user._id,
        paymentAccountId: paymentAccount._id,
        direction: 'Credit',
        amount: 50,
        paymentType: 'transfer_back',
        status: 'pending',
        tags: {
          type: 'otherTransfer'
        }
      });
      await payment.save();

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
