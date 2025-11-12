const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { processScheduledPayments } = require('../../cron/process-scheduled-payments');
const SavingsGoalService = require('../../services/savingsGoalService');
const PaymentAccount = require('../../models/PaymentAccount');
const Payment = require('../../models/Payment');
const User = require('../../models/User');
const ShopifyMerchant = require('../../models/ShopifyMerchant');
const SavingsGoal = require('../../models/SavingsGoal');
const { ManualSavingsGoal, ShopifySavingsGoal } = require('../../models/SavingsGoal');

// Mock SavingsGoalService
jest.mock('../../services/savingsGoalService');

describe('process-scheduled-payments', () => {
  let mongoServer;
  let mockSavingsGoalService;
  let testUser;
  let testMerchant;

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
    await PaymentAccount.deleteMany({});
    await Payment.deleteMany({});
    await SavingsGoal.deleteMany({});
    await User.deleteMany({});
    await ShopifyMerchant.deleteMany({});

    testUser = new User({
      email: 'test@example.com',
      unitAccountId: 'test-unit-account-id',
      firstName: 'Test',
      lastName: 'User'
    });
    await testUser.save();

    testMerchant = new ShopifyMerchant({
      shopDomain: 'test-shop.myshopify.com',
      shopifyShopId: 'shop-123',
      unitAccountId: 'merchant-unit-account-id'
    });
    await testMerchant.save();

    // Mock SavingsGoalService
    mockSavingsGoalService = {
      createPaymentForGoal: jest.fn().mockResolvedValue({
        paymentId: 'test-payment-id',
        direction: 'Debit',
        amount: 50,
        status: 'pending'
      })
    };
    SavingsGoalService.mockImplementation(() => mockSavingsGoalService);

    jest.clearAllMocks();
  });

  describe('processScheduledPayments', () => {
    it('should process manual savings goals scheduled for today (day of month)', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      // Create PaymentAccount first
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'test-plaid-token',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        paymentAccountId: paymentAccount._id,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: savingsGoal._id
        }),
        expect.objectContaining({
          direction: 'Debit',
          amount: 50.00,
          paymentType: 'manual_installment',
          plaidProcessorToken: 'test-plaid-token',
          description: 'Funding'
        })
      );
    });

    it('should process manual savings goals scheduled for today (day of week)', async () => {
      const today = new Date();
      const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const dayOfWeek = daysOfWeek[today.getUTCDay()];

      // Create PaymentAccount first
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'test-plaid-token-2',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal 2',
        targetAmount: 500.00,
        savingsAmount: 25.00,
        category: 'other',
        paymentAccountId: paymentAccount._id,
        schedule: {
          dayOfMonth: null,
          dayOfWeek: dayOfWeek
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).toHaveBeenCalled();
    });

    it('should process Shopify savings goals scheduled for today', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      testUser.shopifyMerchantId = testMerchant._id;
      await testUser.save();

      // Create PaymentAccount first
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'test-plaid-token',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const savingsGoal = new ShopifySavingsGoal({
        userId: testUser._id,
        goalName: 'Shopify Goal',
        targetAmount: 1000.00,
        savingsAmount: 250.00,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        paymentAccountId: paymentAccount._id,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: savingsGoal._id
        }),
        expect.objectContaining({
          direction: 'Debit',
          amount: 250.00,
          paymentType: 'shopify_installment',
          plaidProcessorToken: 'test-plaid-token',
          description: 'Funding'
        })
      );
    });

    it('should not process savings goals not scheduled for today', async () => {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const tomorrowDayOfMonth = tomorrow.getUTCDate();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Tomorrow Goal',
        targetAmount: 2000.00,
        savingsAmount: 100.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token'
        },
        schedule: {
          dayOfMonth: tomorrowDayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).not.toHaveBeenCalled();
    });

    it('should skip paused savings goals', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      // Create PaymentAccount first
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'test-plaid-token',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const pausedGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Paused Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        paymentAccountId: paymentAccount._id,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: [],
        isPaused: true
      });
      await pausedGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).not.toHaveBeenCalled();
    });

    it('should skip savings goals without paymentAccountId', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'No Token Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        paymentAccountId: null,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).not.toHaveBeenCalled();
    });

    it('should skip savings goals for users without unitAccountId', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const userWithoutUnit = new User({
        email: 'nouint@example.com',
        unitAccountId: null,
        firstName: 'No',
        lastName: 'Unit'
      });
      await userWithoutUnit.save();

      // Create PaymentAccount first
      const paymentAccount = new PaymentAccount({
        userId: userWithoutUnit._id,
        plaidProcessorToken: 'test-plaid-token',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const savingsGoal = new ManualSavingsGoal({
        userId: userWithoutUnit._id,
        goalName: 'No Unit Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        paymentAccountId: paymentAccount._id,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).not.toHaveBeenCalled();
    });

    it('should skip Shopify goals if merchant not found', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      testUser.shopifyMerchantId = testMerchant._id;
      await testUser.save();

      const savingsGoal = new ShopifySavingsGoal({
        userId: testUser._id,
        goalName: 'Shopify Goal',
        targetAmount: 1000.00,
        savingsAmount: 250.00,
        shopDomain: 'non-existent-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).not.toHaveBeenCalled();
    });

    it('should skip Shopify goals if merchant has no unitAccountId', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const merchantWithoutUnit = new ShopifyMerchant({
        shopDomain: 'no-unit-shop.myshopify.com',
        shopifyShopId: 'shop-456',
        unitAccountId: null
      });
      await merchantWithoutUnit.save();

      testUser.shopifyMerchantId = merchantWithoutUnit._id;
      await testUser.save();

      const savingsGoal = new ShopifySavingsGoal({
        userId: testUser._id,
        goalName: 'Shopify Goal',
        targetAmount: 1000.00,
        savingsAmount: 250.00,
        shopDomain: 'no-unit-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).not.toHaveBeenCalled();
    });

    it('should handle payment creation errors gracefully', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      // Create PaymentAccount first
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'test-plaid-token',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Error Test Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        paymentAccountId: paymentAccount._id,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      const paymentError = new Error('Payment creation failed');
      mockSavingsGoalService.createPaymentForGoal.mockRejectedValueOnce(paymentError);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await processScheduledPayments();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cron payment error'),
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });

    it('should process multiple savings goals for the same user', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      // Create PaymentAccounts first
      const paymentAccount1 = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'test-plaid-token-1',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount1.save();

      const paymentAccount2 = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'test-plaid-token-2',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount2.save();

      const savingsGoal1 = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Multi Goal 1',
        targetAmount: 500.00,
        savingsAmount: 25.00,
        category: 'other',
        paymentAccountId: paymentAccount1._id,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });

      const savingsGoal2 = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Multi Goal 2',
        targetAmount: 1500.00,
        savingsAmount: 75.00,
        category: 'other',
        paymentAccountId: paymentAccount2._id,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });

      await Promise.all([savingsGoal1.save(), savingsGoal2.save()]);

      await processScheduledPayments();

      expect(mockSavingsGoalService.createPaymentForGoal).toHaveBeenCalledTimes(2);
    });

    it('should process savings goals for a specific date', async () => {
      const date = new Date('2025-09-27');
      const dayOfMonth = date.getUTCDate();

      // Create PaymentAccount first
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'test-plaid-token',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Specific Date Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        paymentAccountId: paymentAccount._id,
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments(date);

      expect(mockSavingsGoalService.createPaymentForGoal).toHaveBeenCalled();
    });
  });
});

