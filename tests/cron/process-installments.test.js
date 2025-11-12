const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const SavingsGoal = require('../../models/SavingsGoal');
const { ShopifySavingsGoal } = require('../../models/SavingsGoal');
const ShopifyMerchant = require('../../models/ShopifyMerchant');
const PaymentAccount = require('../../models/PaymentAccount');

// Create mock function that can be accessed later
let mockCreatePayment;

jest.mock('@unit-finance/unit-node-sdk', () => {
  mockCreatePayment = jest.fn().mockResolvedValue({
    data: {
      id: 'payment-123',
      attributes: {
        amount: 5000,
        direction: 'Debit',
        status: 'pending'
      }
    }
  });

  return {
    Unit: jest.fn().mockImplementation(() => ({
      payments: {
        create: mockCreatePayment
      }
    }))
  };
});

const { hasProcessInstallment, processScheduledInstallments } = require('../../cron/process-installments');

// Shared MongoDB connection for all tests
let sharedMongoServer;

beforeAll(async () => {
  if (!sharedMongoServer) {
    sharedMongoServer = await MongoMemoryServer.create();
    const mongoUri = sharedMongoServer.getUri();
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    process.env.MONGO_URI = mongoUri;
    process.env.UNIT_API_KEY = 'test-api-key';
  }
});

afterAll(async () => {
  if (sharedMongoServer) {
    await mongoose.disconnect();
    await sharedMongoServer.stop();
  }
});

describe('hasProcessInstallment', () => {

  beforeEach(async () => {
    await SavingsGoal.deleteMany({});
  });

  describe('Basic functionality', () => {
    it('should return false when goal has no transfers', () => {
      const goal = { transfers: [] };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when transfers array is null', () => {
      const goal = { transfers: null };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when transfers array is undefined', () => {
      const goal = {};
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when no date is provided', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15'),
          status: 'completed',
          type: 'debit'
        }]
      };
      expect(hasProcessInstallment(goal)).toBe(false);
    });
  });

  describe('Date matching', () => {
    it('should return true when transfer exists on the exact date', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:30:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return true when transfer exists at start of day', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T00:00:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return true when transfer exists at end of day', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T23:59:59Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return false when transfer is on different date', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-14T10:30:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when transfer is on next day', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-16T00:00:01Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });
  });

  describe('Failed transfers', () => {
    it('should return false when transfer has failed status', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:30:00Z'),
          status: 'failed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return true when transfer is pending', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:30:00Z'),
          status: 'pending',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return true when transfer is completed', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:30:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });
  });

  describe('Multiple transfers', () => {
    it('should return true when at least one non-failed transfer exists on date', () => {
      const goal = {
        transfers: [
          {
            date: new Date('2024-01-14T10:30:00Z'),
            status: 'completed',
            type: 'debit'
          },
          {
            date: new Date('2024-01-15T10:30:00Z'),
            status: 'failed',
            type: 'debit'
          },
          {
            date: new Date('2024-01-15T11:30:00Z'),
            status: 'completed',
            type: 'debit'
          }
        ]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return false when all transfers on date have failed status', () => {
      const goal = {
        transfers: [
          {
            date: new Date('2024-01-15T10:30:00Z'),
            status: 'failed',
            type: 'debit'
          },
          {
            date: new Date('2024-01-15T11:30:00Z'),
            status: 'failed',
            type: 'debit'
          }
        ]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when no transfers exist on the specific date', () => {
      const goal = {
        transfers: [
          {
            date: new Date('2024-01-14T10:30:00Z'),
            status: 'completed',
            type: 'debit'
          },
          {
            date: new Date('2024-01-16T10:30:00Z'),
            status: 'completed',
            type: 'debit'
          }
        ]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });
  });

  describe('Different timezones', () => {
    it('should correctly handle UTC dates', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T12:00:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should correctly handle dates with timezone offset', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:00:00-05:00'), // EST
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty transfers array', () => {
      const goal = { transfers: [] };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should handle dates at different months', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-31T10:00:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-31');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should handle dates at year boundaries', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-12-31T10:00:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-12-31');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });
  });

  describe('processScheduledInstallments', () => {

    beforeEach(async () => {
      await SavingsGoal.deleteMany({});
      await ShopifyMerchant.deleteMany({});
      jest.clearAllMocks();
      // Reset mock to default success behavior
      mockCreatePayment.mockResolvedValue({
        data: {
          id: 'payment-123',
          attributes: {
            amount: 5000,
            direction: 'Debit',
            status: 'pending'
          }
        }
      });
    });

    it('should skip paused goals', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const merchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'test-shop',
        unitAccountId: 'merchant-account-123'
      });
      await merchant.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'Paused Goal',
        targetAmount: 1000,
        savingsAmount: 100,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        isPaused: true,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await goal.save();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await processScheduledInstallments(today);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping paused savings goal')
      );

      consoleSpy.mockRestore();
    });

    it('should skip goals that already have installments processed today', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const merchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'test-shop',
        unitAccountId: 'merchant-account-123'
      });
      await merchant.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'Already Processed Goal',
        targetAmount: 1000,
        savingsAmount: 100,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        isPaused: false,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: [{
          transferId: 'payment-123',
          amount: 100,
          date: today,
          status: 'pending',
          type: 'debit'
        }]
      });
      await goal.save();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await processScheduledInstallments(today);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Installment already processed')
      );

      consoleSpy.mockRestore();
    });

    it('should skip goals without paymentAccountId', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const merchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'test-shop',
        unitAccountId: 'merchant-account-123'
      });
      await merchant.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'No Payment Account Goal',
        targetAmount: 1000,
        savingsAmount: 100,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        isPaused: false,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await goal.save();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await processScheduledInstallments(today);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('no paymentAccountId')
      );

      consoleSpy.mockRestore();
    });

    it('should skip goals when merchant not found', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const userId = new mongoose.Types.ObjectId();
      
      // Create PaymentAccount
      const paymentAccount = new PaymentAccount({
        userId: userId,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'No Merchant Goal',
        targetAmount: 1000,
        savingsAmount: 100,
        shopDomain: 'unknown-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        userId: userId,
        paymentAccountId: paymentAccount._id,
        isPaused: false,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await goal.save();

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await processScheduledInstallments(today);

      expect(consoleWarnSpy).toHaveBeenCalledWith('merchant not found');

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should skip goals when merchant onboarding not complete', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const merchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'test-shop',
        unitAccountId: null // Not complete
      });
      await merchant.save();

      const userId = new mongoose.Types.ObjectId();
      
      // Create PaymentAccount
      const paymentAccount = new PaymentAccount({
        userId: userId,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'Incomplete Merchant Goal',
        targetAmount: 1000,
        savingsAmount: 100,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        userId: userId,
        paymentAccountId: paymentAccount._id,
        isPaused: false,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await goal.save();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await processScheduledInstallments(today);

      // Check that it was called with the message (might be called multiple times)
      const calls = consoleSpy.mock.calls.map(call => call[0]);
      expect(calls).toContain('Merchant onboarding not complete');

      consoleSpy.mockRestore();
    });

    it('should create payment for valid goal', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const merchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'test-shop',
        unitAccountId: 'merchant-account-123'
      });
      await merchant.save();

      const userId = new mongoose.Types.ObjectId();
      
      // Create PaymentAccount
      const paymentAccount = new PaymentAccount({
        userId: userId,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'Valid Goal',
        targetAmount: 1000,
        savingsAmount: 50,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        userId: userId,
        paymentAccountId: paymentAccount._id,
        isPaused: false,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await goal.save();

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await processScheduledInstallments(today);

      // Reload the goal to get the latest state
      const updatedGoal = await SavingsGoal.findById(goal._id).lean();
      expect(updatedGoal.transfers).toHaveLength(1);
      expect(updatedGoal.transfers[0].transferId).toBe('payment-123');
      expect(updatedGoal.transfers[0].amount).toBe(50);
      expect(updatedGoal.transfers[0].status).toBe('pending');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created payment for Valid Goal')
      );

      consoleSpy.mockRestore();
      
      // Verify the mock was called
      expect(mockCreatePayment).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const merchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'test-shop',
        unitAccountId: 'merchant-account-123'
      });
      await merchant.save();

      const userId = new mongoose.Types.ObjectId();
      
      // Create PaymentAccount
      const paymentAccount = new PaymentAccount({
        userId: userId,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'Error Goal',
        targetAmount: 1000,
        savingsAmount: 50,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        userId: userId,
        paymentAccountId: paymentAccount._id,
        isPaused: false,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await goal.save();

      // Mock Unit API to throw an error for this specific test
      mockCreatePayment.mockRejectedValueOnce(new Error('API Error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await processScheduledInstallments(today);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Cron payment error:',
        expect.any(String)
      );

      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should process goals scheduled by dayOfWeek', async () => {
      const today = new Date();
      const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const dayOfWeek = daysOfWeek[today.getUTCDay()];

      const merchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'test-shop',
        unitAccountId: 'merchant-account-123'
      });
      await merchant.save();

      const userId = new mongoose.Types.ObjectId();
      
      // Create PaymentAccount
      const paymentAccount = new PaymentAccount({
        userId: userId,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'Weekly Goal',
        targetAmount: 1000,
        savingsAmount: 50,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        userId: userId,
        paymentAccountId: paymentAccount._id,
        isPaused: false,
        schedule: {
          dayOfMonth: null,
          dayOfWeek: dayOfWeek
        },
        transfers: []
      });
      await goal.save();

      await processScheduledInstallments(today);

      const updatedGoal = await SavingsGoal.findById(goal._id).lean();
      expect(updatedGoal.transfers).toHaveLength(1);
      
      // Verify the mock was called
      expect(mockCreatePayment).toHaveBeenCalled();
    });

    it('should not process goals not scheduled for today', async () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const dayOfMonth = tomorrow.getUTCDate();

      const merchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'test-shop',
        unitAccountId: 'merchant-account-123'
      });
      await merchant.save();

      const goal = new ShopifySavingsGoal({
        goalName: 'Future Goal',
        targetAmount: 1000,
        savingsAmount: 50,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        isPaused: false,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await goal.save();

      await processScheduledInstallments(today);

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.transfers).toHaveLength(0);
    });
  });
});
