const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const SavingsGoalService = require('../../services/savingsGoalService');
const PaymentService = require('../../services/paymentService');
const PaymentAccount = require('../../models/PaymentAccount');
const Payment = require('../../models/Payment');
const SavingsGoal = require('../../models/SavingsGoal');
const { ManualSavingsGoal, ShopifySavingsGoal } = require('../../models/SavingsGoal');
const User = require('../../models/User');
const ShopifyMerchant = require('../../models/ShopifyMerchant');
const CheckoutCart = require('../../models/CheckoutCart');

// Mock PaymentService
jest.mock('../../services/paymentService');

// Mock Shopify API
const mockShopifyClient = {
  request: jest.fn()
};

const mockShopifySession = {
  accessToken: 'test-token'
};

const mockShopifyApi = {
  auth: {
    clientCredentials: jest.fn().mockResolvedValue({
      session: mockShopifySession
    })
  },
  clients: {
    Graphql: jest.fn().mockImplementation(() => mockShopifyClient)
  }
};

jest.mock('@shopify/shopify-api', () => ({
  shopifyApi: jest.fn().mockImplementation(() => mockShopifyApi),
  ApiVersion: {
    July25: '2025-07'
  }
}));

describe('SavingsGoalService', () => {
  let mongoServer;
  let savingsGoalService;
  let mockPaymentService;

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
    await CheckoutCart.deleteMany({});

    // Drop and recreate Payment collection to ensure new indexes are applied
    // This is necessary because MongoMemoryServer might cache old index definitions
    try {
      await mongoose.connection.db.collection('payments').drop();
    } catch (e) {
      // Collection might not exist, which is fine
    }

    // Reset mocks
    jest.clearAllMocks();
    mockPaymentService = {
      createPayment: jest.fn(),
      updatePaymentStatus: jest.fn(),
      getPaymentByPaymentId: jest.fn(),
      getPaymentsByBatchId: jest.fn()
    };
    PaymentService.mockImplementation(() => mockPaymentService);
    
    savingsGoalService = new SavingsGoalService();
  });

  describe('findOrCreatePaymentAccount', () => {
    let testUser;
    let testGoal;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'unit-account-123'
      });
      await testUser.save();

      testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        category: 'other',
        bank: {
          bankName: 'Test Bank',
          bankAccountName: 'Test Account',
          bankLastFour: '1234',
          bankAccountType: 'checking',
          plaidToken: 'plaid-token-123'
        }
      });
      await testGoal.save();
    });

    it('should create new PaymentAccount if not exists', async () => {
      const bankAccountDetails = {
        bankName: 'Test Bank',
        bankAccountName: 'Test Account',
        bankLastFour: '1234',
        bankAccountType: 'checking'
      };
      const paymentAccount = await savingsGoalService.findOrCreatePaymentAccount(
        testGoal,
        'plaid-token-123',
        bankAccountDetails
      );

      expect(paymentAccount).toBeDefined();
      expect(paymentAccount.userId.toString()).toBe(testUser._id.toString());
      expect(paymentAccount.plaidProcessorToken).toBe('plaid-token-123');
      expect(paymentAccount.bankName).toBe('Test Bank');
      expect(paymentAccount.accountType).toBe('checking');
    });

    it('should reuse existing PaymentAccount if exists', async () => {
      // Create PaymentAccount first
      const existingAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await existingAccount.save();

      const paymentAccount = await savingsGoalService.findOrCreatePaymentAccount(
        testGoal,
        'plaid-token-123'
      );

      expect(paymentAccount._id.toString()).toBe(existingAccount._id.toString());
      
      // Verify only one PaymentAccount exists
      const count = await PaymentAccount.countDocuments();
      expect(count).toBe(1);
    });

    it('should throw error if goal has no userId', async () => {
      const goalWithoutUser = new ManualSavingsGoal({
        goalName: 'No User Goal',
        targetAmount: 1000,
        category: 'other'
      });

      await expect(
        savingsGoalService.findOrCreatePaymentAccount(goalWithoutUser, 'token')
      ).rejects.toThrow('Goal must have a userId');
    });
  });

  describe('getUnitAccountIdForGoal', () => {
    let testUser;
    let testMerchant;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'user-unit-account-123'
      });
      await testUser.save();

      testMerchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'shop-123',
        unitAccountId: 'merchant-unit-account-123'
      });
      await testMerchant.save();
    });

    it('should return user unitAccountId for ManualSavingsGoal', async () => {
      const goal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Manual Goal',
        targetAmount: 1000,
        category: 'other'
      });

      const unitAccountId = await savingsGoalService.getUnitAccountIdForGoal(goal);
      expect(unitAccountId).toBe('user-unit-account-123');
    });

    it('should return merchant unitAccountId for ShopifySavingsGoal', async () => {
      testUser.shopifyMerchantId = testMerchant._id;
      await testUser.save();

      const goal = new ShopifySavingsGoal({
        userId: testUser._id,
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId()
      });

      const unitAccountId = await savingsGoalService.getUnitAccountIdForGoal(goal);
      expect(unitAccountId).toBe('merchant-unit-account-123');
    });

    it('should throw error if User not found', async () => {
      const goal = new ManualSavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'No User Goal',
        targetAmount: 1000,
        category: 'other'
      });

      await expect(
        savingsGoalService.getUnitAccountIdForGoal(goal)
      ).rejects.toThrow('User not found');
    });

    it('should throw error if user has no unitAccountId', async () => {
      const userWithoutUnit = new User({
        email: 'nouint@example.com',
        unitAccountId: null
      });
      await userWithoutUnit.save();

      const goal = new ManualSavingsGoal({
        userId: userWithoutUnit._id,
        goalName: 'No Unit Goal',
        targetAmount: 1000,
        category: 'other'
      });

      await expect(
        savingsGoalService.getUnitAccountIdForGoal(goal)
      ).rejects.toThrow('does not have a unitAccountId');
    });

    it('should throw error if Shopify goal has no shopDomain', async () => {
      const goal = new ShopifySavingsGoal({
        userId: testUser._id,
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: null,
        checkoutCartId: new mongoose.Types.ObjectId()
      });

      await expect(
        savingsGoalService.getUnitAccountIdForGoal(goal)
      ).rejects.toThrow('ShopifySavingsGoal missing shopDomain');
    });

    it('should throw error if ShopifyMerchant not found for shopDomain', async () => {
      const goal = new ShopifySavingsGoal({
        userId: testUser._id,
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: 'nonexistent-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId()
      });

      await expect(
        savingsGoalService.getUnitAccountIdForGoal(goal)
      ).rejects.toThrow('Merchant not found for shopDomain');
    });
  });

  describe('createPaymentForGoal', () => {
    let testUser;
    let testGoal;
    let mockPayment;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'unit-account-123'
      });
      await testUser.save();

      testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        category: 'other',
        bank: {
          bankName: 'Test Bank',
          bankAccountName: 'Test Account',
          bankLastFour: '1234',
          bankAccountType: 'checking',
          plaidToken: 'plaid-token-123'
        },
        transfers: []
      });
      await testGoal.save();

      mockPayment = {
        _id: new mongoose.Types.ObjectId(),
        paymentId: 'payment-123',
        direction: 'Debit',
        amount: 50,
        status: 'pending',
        date: new Date()
      };

      mockPaymentService.createPayment.mockResolvedValue(mockPayment);
    });

    it('should create payment with PaymentAccount and Unit account ID', async () => {
      const payment = await savingsGoalService.createPaymentForGoal(testGoal, {
        direction: 'Debit',
        amount: 50,
        paymentType: 'manual_installment',
        plaidProcessorToken: 'plaid-token-123',
        description: 'Funding'
      });

      expect(payment).toBeDefined();
      expect(mockPaymentService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          savingsGoalId: testGoal._id.toString(),
          userId: testUser._id.toString(),
          direction: 'Debit',
          amount: 50,
          paymentType: 'manual_installment',
          paymentAccountId: expect.any(String),
          unitAccountId: 'unit-account-123',
          description: 'Funding'
        })
      );

      // Verify PaymentAccount was created
      const paymentAccount = await PaymentAccount.findOne({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123'
      });
      expect(paymentAccount).toBeDefined();

      // Verify goal.transfers was updated
      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.transfers).toHaveLength(1);
      expect(updatedGoal.transfers[0].transferId).toBe('payment-123');
    });

    it('should determine direction from paymentType if not provided', async () => {
      await savingsGoalService.createPaymentForGoal(testGoal, {
        amount: 50,
        paymentType: 'refund',
        plaidProcessorToken: 'plaid-token-123'
      });

      expect(mockPaymentService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'Credit'
        })
      );
    });

    it('should default to Debit direction for installments', async () => {
      await savingsGoalService.createPaymentForGoal(testGoal, {
        amount: 50,
        paymentType: 'manual_installment',
        plaidProcessorToken: 'plaid-token-123'
      });

      expect(mockPaymentService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'Debit'
        })
      );
    });
  });

  describe('createBatchTransfer', () => {
    let testUser;
    let goal1, goal2;
    let mockPayment;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'unit-account-123'
      });
      await testUser.save();

      goal1 = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Goal 1',
        targetAmount: 1000,
        currentAmount: 100,
        category: 'other',
        bank: {
          plaidToken: 'plaid-token-123'
        },
        transfers: []
      });

      // Create PaymentAccount first
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        isActive: true
      });
      await paymentAccount.save();

      goal2 = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Goal 2',
        targetAmount: 500,
        currentAmount: 50,
        category: 'other',
        paymentAccountId: paymentAccount._id,
        transfers: []
      });

      // Update goal1 to also have paymentAccountId
      goal1.paymentAccountId = paymentAccount._id;
      await Promise.all([goal1.save(), goal2.save()]);

      mockPayment = {
        _id: new mongoose.Types.ObjectId(),
        paymentId: 'batch-payment-123',
        direction: 'Credit',
        amount: 150,
        status: 'pending',
        date: new Date(),
        save: jest.fn().mockResolvedValue(true)
      };

      // Mock createPayment to actually create Payment records in the database
      // Note: The implementation will call findOrCreatePaymentAccount first,
      // so we need to ensure the PaymentAccount exists
      mockPaymentService.createPayment.mockImplementation(async (options) => {
        // Verify paymentAccountId exists (it should, since findOrCreatePaymentAccount was called)
        const account = await PaymentAccount.findById(options.paymentAccountId);
        if (!account) {
          throw new Error(`PaymentAccount not found: ${options.paymentAccountId}`);
        }
        
        const payment = new Payment({
          paymentId: 'batch-payment-123',
          savingsGoalId: options.savingsGoalId,
          userId: options.userId,
          paymentAccountId: options.paymentAccountId,
          direction: options.direction,
          amount: options.amount,
          paymentType: options.paymentType,
          status: 'pending',
          batchId: options.batchId,
          description: options.description,
          tags: options.tags,
          date: new Date()
        });
        await payment.save();
        return payment;
      });
    });

    it('should create batch transfer with single Unit payment and multiple Payment records', async () => {
      const allocations = [
        { savingsGoalId: goal1._id.toString(), amount: 100 },
        { savingsGoalId: goal2._id.toString(), amount: 50 }
      ];
      const goals = [goal1, goal2];
      const goalsById = new Map([
        [goal1._id.toString(), goal1],
        [goal2._id.toString(), goal2]
      ]);

      const result = await savingsGoalService.createBatchTransfer({
        totalAmount: 150,
        allocations,
        goals,
        goalsById,
        batchId: 'batch-123'
      });

      expect(result.paymentId).toBe('batch-payment-123');
      expect(result.batchId).toBe('batch-123');
      expect(result.processed).toBe(2);

      // Verify single Unit payment was created
      expect(mockPaymentService.createPayment).toHaveBeenCalledTimes(1);
      expect(mockPaymentService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 150,
          direction: 'Credit',
          paymentType: 'transfer_back_batch',
          batchId: 'batch-123'
        })
      );

      // Verify multiple Payment records were created
      // The implementation:
      // 1. Creates first payment via createPaymentForGoal (which calls paymentService.createPayment - mocked)
      // 2. Updates that payment's amount
      // 3. Creates additional Payment records directly for remaining goals
      // Since we're mocking paymentService.createPayment, it creates the first Payment in the DB
      // Then the implementation creates the second Payment directly
      const payments = await Payment.find({ batchId: 'batch-123' });
      expect(payments).toHaveLength(2);
      
      // Both payments should have the same paymentId (for batch transfers)
      expect(payments[0].paymentId).toBe('batch-payment-123');
      expect(payments[1].paymentId).toBe('batch-payment-123');
      
      // Verify amounts are correct
      const amounts = payments.map(p => p.amount).sort((a, b) => b - a);
      expect(amounts).toEqual([100, 50]);

      // Verify goal transfers were updated
      const [updatedGoal1, updatedGoal2] = await Promise.all([
        SavingsGoal.findById(goal1._id),
        SavingsGoal.findById(goal2._id)
      ]);
      expect(updatedGoal1.transfers).toHaveLength(1);
      expect(updatedGoal2.transfers).toHaveLength(1);
    });

    it('should throw error if no destination Plaid token found', async () => {
      goal1.paymentAccountId = null;
      await goal1.save();

      const allocations = [
        { savingsGoalId: goal1._id.toString(), amount: 100 }
      ];
      const goals = [goal1];
      const goalsById = new Map([[goal1._id.toString(), goal1]]);

      await expect(
        savingsGoalService.createBatchTransfer({
          totalAmount: 100,
          allocations,
          goals,
          goalsById,
          batchId: 'batch-123'
        })
      ).rejects.toThrow('No destination bank found');
    });
  });

  describe('linkPaymentToGoal', () => {
    let testUser;
    let testGoal;
    let payment;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'unit-account-123'
      });
      await testUser.save();

      testGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000,
        category: 'other',
        transfers: []
      });
      await testGoal.save();

      payment = {
        paymentId: 'payment-123',
        transactionId: null,
        batchId: null,
        amount: 50,
        date: new Date(),
        status: 'pending',
        direction: 'Debit'
      };
    });

    it('should add payment to goal transfers array', async () => {
      await savingsGoalService.linkPaymentToGoal(testGoal, payment);

      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.transfers).toHaveLength(1);
      expect(updatedGoal.transfers[0]).toMatchObject({
        transferId: 'payment-123',
        amount: 50,
        status: 'pending',
        type: 'debit' // Derived from direction
      });
    });

    it('should not duplicate transfer if already exists', async () => {
      testGoal.transfers.push({
        transferId: 'payment-123',
        amount: 50,
        date: new Date(),
        status: 'pending',
        type: 'debit'
      });
      await testGoal.save();

      await savingsGoalService.linkPaymentToGoal(testGoal, payment);

      const updatedGoal = await SavingsGoal.findById(testGoal._id);
      expect(updatedGoal.transfers).toHaveLength(1);
    });
  });

  describe('handlePaymentFailed', () => {
    it('should log failed payment without changing goal amount', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const userId = new mongoose.Types.ObjectId();
      const goal = new ManualSavingsGoal({
        userId: userId,
        goalName: 'Test Goal',
        targetAmount: 1000,
        currentAmount: 500,
        category: 'other'
      });
      await goal.save();

      const paymentAccount = new PaymentAccount({
        userId: userId,
        plaidProcessorToken: 'plaid-token-123',
        bankName: 'Test Bank',
        accountType: 'checking'
      });
      await paymentAccount.save();

      const payment = new Payment({
        paymentId: 'payment-failed-123',
        savingsGoalId: goal._id,
        userId: userId,
        paymentAccountId: paymentAccount._id,
        direction: 'Debit',
        amount: 100,
        status: 'failed',
        paymentType: 'manual_installment'
      });
      await payment.save();

      await savingsGoalService.handlePaymentFailed(goal, payment);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Payment payment-failed-123 failed')
      );

      const updatedGoal = await SavingsGoal.findById(goal._id);
      expect(updatedGoal.currentAmount).toBe(500); // Should not change

      consoleSpy.mockRestore();
    });
  });

  describe('getPaymentByPaymentId', () => {
    it('should delegate to paymentService.getPaymentByPaymentId', async () => {
      const paymentId = 'payment-123';
      const mockPayment = {
        paymentId,
        amount: 100,
        status: 'pending'
      };

      jest.spyOn(savingsGoalService.paymentService, 'getPaymentByPaymentId')
        .mockResolvedValue(mockPayment);

      const result = await savingsGoalService.getPaymentByPaymentId(paymentId);

      expect(savingsGoalService.paymentService.getPaymentByPaymentId).toHaveBeenCalledWith(paymentId);
      expect(result).toEqual(mockPayment);
    });
  });

  describe('findDestinationPlaidToken', () => {
    it('should return plaidProcessorToken from first goal with paymentAccountId', async () => {
      const paymentAccount = new PaymentAccount({
        userId: new mongoose.Types.ObjectId(),
        plaidProcessorToken: 'plaid-token-123',
        bankName: 'Test Bank',
        accountType: 'checking'
      });
      await paymentAccount.save();

      const goal1 = new ManualSavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Goal 1',
        targetAmount: 1000,
        paymentAccountId: paymentAccount._id,
        category: 'other'
      });
      await goal1.save();

      const goal2 = new ManualSavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Goal 2',
        targetAmount: 500,
        category: 'other'
      });
      await goal2.save();

      const token = await savingsGoalService.findDestinationPlaidToken([goal1, goal2]);

      expect(token).toBe('plaid-token-123');
    });

    it('should return null if no goal has paymentAccountId', async () => {
      const goal1 = new ManualSavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Goal 1',
        targetAmount: 1000,
        category: 'other'
      });
      await goal1.save();

      const token = await savingsGoalService.findDestinationPlaidToken([goal1]);

      expect(token).toBeNull();
    });

    it('should return null if PaymentAccount not found', async () => {
      const goal = new ManualSavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Goal 1',
        targetAmount: 1000,
        paymentAccountId: new mongoose.Types.ObjectId(),
        category: 'other'
      });
      await goal.save();

      const token = await savingsGoalService.findDestinationPlaidToken([goal]);

      expect(token).toBeNull();
    });

    it('should return null if PaymentAccount has no plaidProcessorToken', async () => {
      // Create a PaymentAccount without plaidProcessorToken by using a minimal valid account
      // Since plaidProcessorToken is required, we'll test the case where it's missing
      // by checking if the method handles null/undefined properly
      const userId = new mongoose.Types.ObjectId();
      const paymentAccount = new PaymentAccount({
        userId: userId,
        plaidProcessorToken: 'temp-token',
        bankName: 'Test Bank',
        accountType: 'checking'
      });
      await paymentAccount.save();
      
      // Manually set plaidProcessorToken to null after save to test the null case
      paymentAccount.plaidProcessorToken = null;
      await paymentAccount.save({ validateBeforeSave: false });

      const goal = new ManualSavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Goal 1',
        targetAmount: 1000,
        paymentAccountId: paymentAccount._id,
        category: 'other'
      });
      await goal.save();

      const token = await savingsGoalService.findDestinationPlaidToken([goal]);

      expect(token).toBeNull();
    });
  });

  describe('createOrder', () => {
    beforeEach(() => {
      process.env.SHOPIFY_CLIENT_ID = 'test-client-id';
      process.env.SHOPIFY_CLIENT_SECRET = 'test-client-secret';
      jest.clearAllMocks();
    });

    afterEach(() => {
      delete process.env.SHOPIFY_CLIENT_ID;
      delete process.env.SHOPIFY_CLIENT_SECRET;
    });

    it('should throw error when goal is not a ShopifySavingsGoal', async () => {
      const goal = new ManualSavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Manual Goal',
        targetAmount: 1000,
        category: 'other'
      });
      await goal.save();

      await expect(savingsGoalService.createOrder(goal)).rejects.toThrow(
        'createOrder can only be called on ShopifySavingsGoal'
      );
    });

    it('should throw error when checkoutCartId is missing', async () => {
      const goal = new ShopifySavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId()
      });
      await goal.save();
      
      // Remove checkoutCartId to test the error case
      goal.checkoutCartId = null;
      await goal.save({ validateBeforeSave: false });

      await expect(savingsGoalService.createOrder(goal)).rejects.toThrow(
        'Missing checkoutCartId on ShopifySavingsGoal'
      );
    });

    it('should throw error when checkout cart is not found', async () => {
      const goal = new ShopifySavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: new mongoose.Types.ObjectId(),
        category: 'other'
      });
      await goal.save();

      await expect(savingsGoalService.createOrder(goal)).rejects.toThrow(
        'Checkout cart not found'
      );
    });

    it('should throw error when cart has no customerId', async () => {
      const cart = new CheckoutCart({
        checkoutId: 'checkout-123',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '100.00',
        lineItems: [
          {
            productId: 'product-1',
            variantId: 'variant-1',
            quantity: 1,
            presentmentTitle: 'Test Product',
            vendor: 'Test Vendor',
            price: '100.00'
          }
        ]
      });
      await cart.save();

      const goal = new ShopifySavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: cart._id,
        category: 'other'
      });
      await goal.save();

      await expect(savingsGoalService.createOrder(goal)).rejects.toThrow(
        'CheckoutCart has no customerId - this might be a guest checkout'
      );
    });

    it('should successfully create an order', async () => {
      const cart = new CheckoutCart({
        checkoutId: 'checkout-123',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '100.00',
        customerId: 'customer-123',
        lineItems: [
          {
            productId: 'product-1',
            variantId: 'variant-1',
            quantity: 2,
            presentmentTitle: 'Test Product',
            vendor: 'Test Vendor',
            price: '50.00'
          }
        ]
      });
      await cart.save();

      const goal = new ShopifySavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: cart._id,
        category: 'other'
      });
      await goal.save();

      const mockResponse = {
        data: {
          orderCreate: {
            userErrors: [],
            order: {
              id: 'gid://shopify/Order/123456',
              displayFinancialStatus: 'PAID',
              customer: {
                id: 'gid://shopify/Customer/customer-123'
              }
            }
          }
        }
      };

      mockShopifyClient.request.mockResolvedValue(mockResponse);

      await savingsGoalService.createOrder(goal);

      expect(mockShopifyApi.auth.clientCredentials).toHaveBeenCalledWith({
        shop: 'test-shop.myshopify.com'
      });
      expect(mockShopifyApi.clients.Graphql).toHaveBeenCalledWith({
        session: mockShopifySession,
        apiVersion: '2025-07'
      });
      expect(mockShopifyClient.request).toHaveBeenCalled();
      
      const [mutation, options] = mockShopifyClient.request.mock.calls[0];
      expect(mutation).toContain('mutation orderCreate');
      expect(options.variables.order.lineItems).toEqual([
        {
          variantId: 'gid://shopify/ProductVariant/variant-1',
          quantity: 2
        }
      ]);
      expect(options.variables.order.customer.toAssociate.id).toBe('gid://shopify/Customer/customer-123');
      expect(options.variables.order.financialStatus).toBe('PAID');
    });

    it('should throw error when order creation has userErrors', async () => {
      const cart = new CheckoutCart({
        checkoutId: 'checkout-123',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '100.00',
        customerId: 'customer-123',
        lineItems: [
          {
            productId: 'product-1',
            variantId: 'variant-1',
            quantity: 1,
            presentmentTitle: 'Test Product',
            vendor: 'Test Vendor',
            price: '100.00'
          }
        ]
      });
      await cart.save();

      const goal = new ShopifySavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: cart._id,
        category: 'other'
      });
      await goal.save();

      const mockResponse = {
        data: {
          orderCreate: {
            userErrors: [
              { field: ['lineItems'], message: 'Variant not found' },
              { field: ['customer'], message: 'Customer not found' }
            ],
            order: null
          }
        }
      };

      mockShopifyClient.request.mockResolvedValue(mockResponse);

      await expect(savingsGoalService.createOrder(goal)).rejects.toThrow(
        'Order creation failed: Variant not found, Customer not found'
      );
    });

    it('should handle multiple line items correctly', async () => {
      const cart = new CheckoutCart({
        checkoutId: 'checkout-123',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        totalPrice: '150.00',
        customerId: 'customer-123',
        lineItems: [
          {
            productId: 'product-1',
            variantId: 'variant-1',
            quantity: 1,
            presentmentTitle: 'Product 1',
            vendor: 'Vendor 1',
            price: '50.00'
          },
          {
            productId: 'product-2',
            variantId: 'variant-2',
            quantity: 2,
            presentmentTitle: 'Product 2',
            vendor: 'Vendor 2',
            price: '50.00'
          }
        ]
      });
      await cart.save();

      const goal = new ShopifySavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Shopify Goal',
        targetAmount: 1000,
        shopDomain: 'test-shop.myshopify.com',
        checkoutCartId: cart._id,
        category: 'other'
      });
      await goal.save();

      const mockResponse = {
        data: {
          orderCreate: {
            userErrors: [],
            order: {
              id: 'gid://shopify/Order/123456',
              displayFinancialStatus: 'PAID',
              customer: {
                id: 'gid://shopify/Customer/customer-123'
              }
            }
          }
        }
      };

      mockShopifyClient.request.mockResolvedValue(mockResponse);

      await savingsGoalService.createOrder(goal);

      const [mutation, options] = mockShopifyClient.request.mock.calls[0];
      expect(options.variables.order.lineItems).toHaveLength(2);
      expect(options.variables.order.lineItems[0]).toEqual({
        variantId: 'gid://shopify/ProductVariant/variant-1',
        quantity: 1
      });
      expect(options.variables.order.lineItems[1]).toEqual({
        variantId: 'gid://shopify/ProductVariant/variant-2',
        quantity: 2
      });
    });
  });
});

