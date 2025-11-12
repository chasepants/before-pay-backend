const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const PaymentService = require('../../services/paymentService');
const UnitService = require('../../services/unitService');
const Payment = require('../../models/Payment');
const PaymentAccount = require('../../models/PaymentAccount');
const User = require('../../models/User');
const ShopifyMerchant = require('../../models/ShopifyMerchant');

// Mock UnitService
jest.mock('../../services/unitService');

describe('PaymentService', () => {
  let mongoServer;
  let paymentService;
  let mockUnitService;

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
    await User.deleteMany({});
    await ShopifyMerchant.deleteMany({});

    jest.clearAllMocks();
    mockUnitService = {
      createPayment: jest.fn()
    };
    UnitService.mockImplementation(() => mockUnitService);
    
    paymentService = new PaymentService();
  });

  describe('createPayment', () => {
    let testUser;
    let testPaymentAccount;
    let testMerchant;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'user-unit-account-123'
      });
      await testUser.save();

      testPaymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        bankName: 'Test Bank',
        accountType: 'checking',
        isActive: true
      });
      await testPaymentAccount.save();

      mockUnitService.createPayment.mockResolvedValue({
        data: {
          id: 'unit-payment-123'
        }
      });
    });

    it('should create payment with user PaymentAccount', async () => {
      const payment = await paymentService.createPayment({
        savingsGoalId: new mongoose.Types.ObjectId().toString(),
        userId: testUser._id.toString(),
        direction: 'Debit',
        amount: 50,
        paymentType: 'manual_installment',
        paymentAccountId: testPaymentAccount._id.toString(),
        unitAccountId: 'user-unit-account-123',
        description: 'Funding'
      });

      expect(payment).toBeDefined();
      expect(payment.paymentId).toBe('unit-payment-123');
      expect(payment.paymentAccountId.toString()).toBe(testPaymentAccount._id.toString());
      expect(payment.direction).toBe('Debit');
      expect(payment.amount).toBe(50);

      // Verify Unit API was called correctly
      expect(mockUnitService.createPayment).toHaveBeenCalledWith({
        type: 'achPayment',
        attributes: {
          amount: 5000, // Converted to cents
          direction: 'Debit',
          description: 'Funding',
          plaidProcessorToken: 'plaid-token-123',
          tags: expect.objectContaining({
            savingsGoalId: expect.any(String)
          })
        },
        relationships: {
          account: { data: { type: 'account', id: 'user-unit-account-123' } }
        }
      });
    });

    it('should create payment with merchant PaymentAccount', async () => {
      testMerchant = new ShopifyMerchant({
        shopDomain: 'test-shop.myshopify.com',
        shopifyShopId: 'shop-123',
        unitAccountId: 'merchant-unit-account-123'
      });
      await testMerchant.save();

      testPaymentAccount.shopDomain = 'test-shop.myshopify.com';
      await testPaymentAccount.save();

      const payment = await paymentService.createPayment({
        savingsGoalId: new mongoose.Types.ObjectId().toString(),
        userId: testUser._id.toString(),
        direction: 'Credit',
        amount: 100,
        paymentType: 'refund',
        paymentAccountId: testPaymentAccount._id.toString(),
        unitAccountId: 'merchant-unit-account-123',
        description: 'Refund'
      });

      expect(payment).toBeDefined();
      expect(mockUnitService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          relationships: {
            account: { data: { type: 'account', id: 'merchant-unit-account-123' } }
          }
        })
      );
    });

    it('should throw error if PaymentAccount not found', async () => {
      await expect(
        paymentService.createPayment({
          savingsGoalId: new mongoose.Types.ObjectId().toString(),
          userId: testUser._id.toString(),
          direction: 'Debit',
          amount: 50,
          paymentType: 'manual_installment',
          paymentAccountId: new mongoose.Types.ObjectId().toString(),
          unitAccountId: 'unit-account-123'
        })
      ).rejects.toThrow('PaymentAccount not found');
    });

    it('should throw error if required fields missing', async () => {
      await expect(
        paymentService.createPayment({
          savingsGoalId: new mongoose.Types.ObjectId().toString(),
          // Missing direction, amount, etc.
        })
      ).rejects.toThrow('Missing required payment fields');
    });

    it('should include batchId in payment record', async () => {
      const payment = await paymentService.createPayment({
        savingsGoalId: new mongoose.Types.ObjectId().toString(),
        userId: testUser._id.toString(),
        direction: 'Debit',
        amount: 50,
        paymentType: 'transfer_back_batch',
        paymentAccountId: testPaymentAccount._id.toString(),
        unitAccountId: 'user-unit-account-123',
        batchId: 'batch-123'
      });

      expect(payment.batchId).toBe('batch-123');
    });
  });

  describe('updatePaymentStatus', () => {
    let testPayment;

    beforeEach(async () => {
      testPayment = new Payment({
        paymentId: 'unit-payment-123',
        savingsGoalId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        paymentAccountId: new mongoose.Types.ObjectId(),
        direction: 'Debit',
        amount: 50,
        paymentType: 'manual_installment',
        status: 'pending'
      });
      await testPayment.save();
    });

    it('should update payment status', async () => {
      const updated = await paymentService.updatePaymentStatus('unit-payment-123', 'completed');

      expect(updated.status).toBe('completed');
      
      const dbPayment = await Payment.findOne({ paymentId: 'unit-payment-123' });
      expect(dbPayment.status).toBe('completed');
    });

    it('should update payment status with transactionId', async () => {
      const updated = await paymentService.updatePaymentStatus(
        'unit-payment-123',
        'completed',
        'transaction-123'
      );

      expect(updated.status).toBe('completed');
      expect(updated.transactionId).toBe('transaction-123');
    });

    it('should throw error if payment not found', async () => {
      await expect(
        paymentService.updatePaymentStatus('non-existent-payment', 'completed')
      ).rejects.toThrow('Payment not found');
    });
  });

  describe('getPaymentsForGoal', () => {
    let testGoalId;
    let testPayments;

    beforeEach(async () => {
      testGoalId = new mongoose.Types.ObjectId();
      
      testPayments = [
        new Payment({
          paymentId: 'payment-1',
          savingsGoalId: testGoalId,
          userId: new mongoose.Types.ObjectId(),
          paymentAccountId: new mongoose.Types.ObjectId(),
          direction: 'Debit',
          amount: 50,
          paymentType: 'manual_installment',
          status: 'completed',
          date: new Date('2024-01-01')
        }),
        new Payment({
          paymentId: 'payment-2',
          savingsGoalId: testGoalId,
          userId: new mongoose.Types.ObjectId(),
          paymentAccountId: new mongoose.Types.ObjectId(),
          direction: 'Debit',
          amount: 75,
          paymentType: 'manual_installment',
          status: 'pending',
          date: new Date('2024-01-02')
        })
      ];
      await Payment.insertMany(testPayments);
    });

    it('should return payments for goal sorted by date descending', async () => {
      const payments = await paymentService.getPaymentsForGoal(testGoalId.toString());

      expect(payments).toHaveLength(2);
      expect(payments[0].paymentId).toBe('payment-2'); // Most recent first
      expect(payments[1].paymentId).toBe('payment-1');
    });
  });

  describe('getPaymentsForUser', () => {
    let testUserId;
    let testPayments;

    beforeEach(async () => {
      testUserId = new mongoose.Types.ObjectId();
      
      testPayments = [
        new Payment({
          paymentId: 'payment-1',
          savingsGoalId: new mongoose.Types.ObjectId(),
          userId: testUserId,
          paymentAccountId: new mongoose.Types.ObjectId(),
          direction: 'Debit',
          amount: 50,
          paymentType: 'manual_installment',
          status: 'completed',
          date: new Date('2024-01-01')
        }),
        new Payment({
          paymentId: 'payment-2',
          savingsGoalId: new mongoose.Types.ObjectId(),
          userId: testUserId,
          paymentAccountId: new mongoose.Types.ObjectId(),
          direction: 'Debit',
          amount: 75,
          paymentType: 'manual_installment',
          status: 'pending',
          date: new Date('2024-01-02')
        })
      ];
      await Payment.insertMany(testPayments);
    });

    it('should return payments for user sorted by date descending', async () => {
      const payments = await paymentService.getPaymentsForUser(testUserId.toString());

      expect(payments).toHaveLength(2);
      expect(payments[0].paymentId).toBe('payment-2');
      expect(payments[1].paymentId).toBe('payment-1');
    });
  });

  describe('getPaymentByPaymentId', () => {
    let testPayment;

    beforeEach(async () => {
      testPayment = new Payment({
        paymentId: 'unit-payment-123',
        savingsGoalId: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        paymentAccountId: new mongoose.Types.ObjectId(),
        direction: 'Debit',
        amount: 50,
        paymentType: 'manual_installment',
        status: 'pending'
      });
      await testPayment.save();
    });

    it('should return payment by Unit payment ID', async () => {
      const payment = await paymentService.getPaymentByPaymentId('unit-payment-123');

      expect(payment).toBeDefined();
      expect(payment.paymentId).toBe('unit-payment-123');
    });

    it('should return null if payment not found', async () => {
      const payment = await paymentService.getPaymentByPaymentId('non-existent');

      expect(payment).toBeNull();
    });
  });

  describe('getPaymentsByBatchId', () => {
    let testPayments;

    beforeEach(async () => {
      testPayments = [
        new Payment({
          paymentId: 'payment-1',
          savingsGoalId: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(),
          paymentAccountId: new mongoose.Types.ObjectId(),
          direction: 'Credit',
          amount: 100,
          paymentType: 'transfer_back_batch',
          status: 'pending',
          batchId: 'batch-123'
        }),
        new Payment({
          paymentId: 'payment-1-batch', // Different paymentId to avoid unique constraint
          savingsGoalId: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(),
          paymentAccountId: new mongoose.Types.ObjectId(),
          direction: 'Credit',
          amount: 50,
          paymentType: 'transfer_back_batch',
          status: 'pending',
          batchId: 'batch-123'
        }),
        new Payment({
          paymentId: 'payment-other',
          savingsGoalId: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(),
          paymentAccountId: new mongoose.Types.ObjectId(),
          direction: 'Debit',
          amount: 25,
          paymentType: 'manual_installment',
          status: 'pending',
          batchId: 'other-batch'
        })
      ];
      await Payment.insertMany(testPayments);
    });

    it('should return all payments for batch', async () => {
      const payments = await paymentService.getPaymentsByBatchId('batch-123');

      expect(payments).toHaveLength(2);
      expect(payments.every(p => p.batchId === 'batch-123')).toBe(true);
    });
  });
});

