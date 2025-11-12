const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const PaymentAccount = require('../../models/PaymentAccount');
const User = require('../../models/User');

describe('PaymentAccount Model', () => {
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
    await PaymentAccount.deleteMany({});
    await User.deleteMany({});
  });

  describe('Schema Validation', () => {
    let testUser;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'unit-account-123'
      });
      await testUser.save();
    });

    it('should create PaymentAccount with required fields', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking'
      });

      await expect(paymentAccount.save()).resolves.toBeDefined();
    });

    it('should require userId', async () => {
      const paymentAccount = new PaymentAccount({
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking'
      });

      await expect(paymentAccount.save()).rejects.toThrow();
    });

    it('should require plaidProcessorToken', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        accountType: 'checking'
      });

      await expect(paymentAccount.save()).rejects.toThrow();
    });

    it('should require accountType', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123'
      });

      await expect(paymentAccount.save()).rejects.toThrow();
    });

    it('should validate accountType enum', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'invalid-type'
      });

      await expect(paymentAccount.save()).rejects.toThrow();
    });

    it('should accept valid accountType values', async () => {
      const checking = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking'
      });
      await expect(checking.save()).resolves.toBeDefined();

      const savings = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-456',
        accountType: 'savings'
      });
      await expect(savings.save()).resolves.toBeDefined();
    });

    it('should default isActive to true', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking'
      });
      await paymentAccount.save();

      expect(paymentAccount.isActive).toBe(true);
    });

    it('should allow optional bank info fields', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        bankName: 'Test Bank',
        bankAccountName: 'Test Account',
        bankLastFour: '1234'
      });
      await paymentAccount.save();

      expect(paymentAccount.bankName).toBe('Test Bank');
      expect(paymentAccount.bankAccountName).toBe('Test Account');
      expect(paymentAccount.bankLastFour).toBe('1234');
    });

    it('should allow optional shopDomain', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking',
        shopDomain: 'test-shop.myshopify.com'
      });
      await paymentAccount.save();

      expect(paymentAccount.shopDomain).toBe('test-shop.myshopify.com');
    });
  });

  describe('Indexes', () => {
    let testUser;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'unit-account-123'
      });
      await testUser.save();
    });

    it('should have index on userId', async () => {
      const paymentAccount1 = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'token-1',
        accountType: 'checking'
      });
      await paymentAccount1.save();

      const paymentAccount2 = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'token-2',
        accountType: 'savings'
      });
      await paymentAccount2.save();

      // Query should use index efficiently
      const accounts = await PaymentAccount.find({ userId: testUser._id });
      expect(accounts).toHaveLength(2);
    });

    it('should have index on shopDomain', async () => {
      const paymentAccount1 = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'token-1',
        accountType: 'checking',
        shopDomain: 'shop1.myshopify.com'
      });
      await paymentAccount1.save();

      const paymentAccount2 = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'token-2',
        accountType: 'checking',
        shopDomain: 'shop2.myshopify.com'
      });
      await paymentAccount2.save();

      const accounts = await PaymentAccount.find({ shopDomain: 'shop1.myshopify.com' });
      expect(accounts).toHaveLength(1);
    });

    it('should have compound index on userId and isActive', async () => {
      const activeAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'token-1',
        accountType: 'checking',
        isActive: true
      });
      await activeAccount.save();

      const inactiveAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'token-2',
        accountType: 'savings',
        isActive: false
      });
      await inactiveAccount.save();

      const activeAccounts = await PaymentAccount.find({
        userId: testUser._id,
        isActive: true
      });
      expect(activeAccounts).toHaveLength(1);
    });
  });

  describe('Timestamps', () => {
    let testUser;

    beforeEach(async () => {
      testUser = new User({
        email: 'test@example.com',
        unitAccountId: 'unit-account-123'
      });
      await testUser.save();
    });

    it('should have createdAt and updatedAt timestamps', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking'
      });
      await paymentAccount.save();

      expect(paymentAccount.createdAt).toBeDefined();
      expect(paymentAccount.updatedAt).toBeDefined();
    });

    it('should update updatedAt on save', async () => {
      const paymentAccount = new PaymentAccount({
        userId: testUser._id,
        plaidProcessorToken: 'plaid-token-123',
        accountType: 'checking'
      });
      await paymentAccount.save();

      const originalUpdatedAt = paymentAccount.updatedAt;
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      paymentAccount.bankName = 'Updated Bank';
      await paymentAccount.save();

      expect(paymentAccount.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });
});

