
const mockCreatePayment = jest.fn();
jest.mock('@unit-finance/unit-node-sdk', () => ({
  Unit: jest.fn().mockImplementation(() => ({
    payments: {
      create: mockCreatePayment
    }
  }))
}));

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { Unit } = require('@unit-finance/unit-node-sdk');

const { processScheduledPayments } = require('../../cron/process-payments');
const User = require('../../models/User');
const SavingsGoal = require('../../models/SavingsGoal');
const { ManualSavingsGoal } = require('../../models/SavingsGoal');

describe('process-payments', () => {
  let mongoServer;
  let mockUnit;
  let testUser;

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
      password: 'hashedpassword',
      unitAccountId: 'test-unit-account-id',
      firstName: 'Test',
      lastName: 'User'
    });
    await testUser.save();

    mockUnit = new Unit('test-api-key', 'https://api.s.unit.sh');
    
    mockCreatePayment.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockCreatePayment.mockClear();
  });

  describe('processScheduledPayments', () => {
    it('should process savings goals scheduled for today (day of month)', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token'
        },
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();


      const mockPayment = {
        data: {
          id: 'test-payment-id',
          type: 'achPayment'
        }
      };
      mockCreatePayment.mockResolvedValue(mockPayment);

      await processScheduledPayments();


      expect(mockCreatePayment).toHaveBeenCalledWith({
        type: 'achPayment',
        attributes: {
          amount: 5000,
          direction: 'Debit',
          description: 'Funding',
          plaidProcessorToken: 'test-plaid-token',
          tags: { savingsGoalId: savingsGoal._id }
        },
        relationships: {
          account: { data: { type: 'account', id: 'test-unit-account-id' } }
        }
      });


      const updatedGoal = await SavingsGoal.findById(savingsGoal._id);
      expect(updatedGoal.transfers).toHaveLength(1);
      expect(updatedGoal.transfers[0]).toMatchObject({
        transferId: 'test-payment-id',
        amount: 50.00,
        status: 'pending',
        type: 'debit'
      });
    });

    it('should process savings goals scheduled for today (day of week)', async () => {
      const today = new Date();
      const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const dayOfWeek = daysOfWeek[today.getUTCDay()];

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Test Goal 2',
        targetAmount: 500.00,
        savingsAmount: 25.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token-2'
        },
        schedule: {
          dayOfMonth: null,
          dayOfWeek: dayOfWeek
        },
        transfers: []
      });
      await savingsGoal.save();

      const mockPayment = {
        data: {
          id: 'test-payment-id-2',
          type: 'achPayment'
        }
      };
      mockCreatePayment.mockResolvedValue(mockPayment);

      await processScheduledPayments();

      expect(mockCreatePayment).toHaveBeenCalledWith({
        type: 'achPayment',
        attributes: {
          amount: 2500,
          direction: 'Debit',
          description: 'Funding',
          plaidProcessorToken: 'test-plaid-token-2',
          tags: { savingsGoalId: savingsGoal._id }
        },
        relationships: {
          account: { data: { type: 'account', id: 'test-unit-account-id' } }
        }
      });

      const updatedGoal = await SavingsGoal.findById(savingsGoal._id);
      expect(updatedGoal.transfers).toHaveLength(1);
      expect(updatedGoal.transfers[0]).toMatchObject({
        transferId: 'test-payment-id-2',
        amount: 25.00,
        status: 'pending',
        type: 'debit'
      });
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

      expect(mockCreatePayment).not.toHaveBeenCalled();

      const updatedGoal = await SavingsGoal.findById(savingsGoal._id);
      expect(updatedGoal.transfers).toHaveLength(0);
    });

    it('should skip savings goals for users without unitAccountId', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const userWithoutUnit = new User({
        email: 'nouint@example.com',
        password: 'hashedpassword',
        unitAccountId: null,
        firstName: 'No',
        lastName: 'Unit'
      });
      await userWithoutUnit.save();

      const savingsGoal = new ManualSavingsGoal({
        userId: userWithoutUnit._id,
        goalName: 'No Unit Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token'
        },
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockCreatePayment).not.toHaveBeenCalled();

      const updatedGoal = await SavingsGoal.findById(savingsGoal._id);
      expect(updatedGoal.transfers).toHaveLength(0);
    });

    it('should skip savings goals for non-existent users', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const savingsGoal = new ManualSavingsGoal({
        userId: new mongoose.Types.ObjectId(),
        goalName: 'Non-existent User Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token'
        },
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      await processScheduledPayments();

      expect(mockCreatePayment).not.toHaveBeenCalled();

      const updatedGoal = await SavingsGoal.findById(savingsGoal._id);
      expect(updatedGoal.transfers).toHaveLength(0);
    });

    it('should handle payment creation errors gracefully', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Error Test Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token'
        },
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      const paymentError = new Error('Payment creation failed');
      mockCreatePayment.mockRejectedValue(paymentError);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await processScheduledPayments();

      expect(consoleSpy).toHaveBeenCalledWith('Cron payment error:', 'Payment creation failed');

      const updatedGoal = await SavingsGoal.findById(savingsGoal._id);
      expect(updatedGoal.transfers).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it('should process multiple savings goals for the same user', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const savingsGoal1 = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Multi Goal 1',
        targetAmount: 500.00,
        savingsAmount: 25.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token-1'
        },
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
        bank: {
          plaidToken: 'test-plaid-token-2'
        },
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });

      await Promise.all([savingsGoal1.save(), savingsGoal2.save()]);

      const mockPayment1 = { data: { id: 'test-payment-id-1', type: 'achPayment' } };
      const mockPayment2 = { data: { id: 'test-payment-id-2', type: 'achPayment' } };
      
      mockCreatePayment
        .mockResolvedValueOnce(mockPayment1)
        .mockResolvedValueOnce(mockPayment2);

      await processScheduledPayments();

      expect(mockCreatePayment).toHaveBeenCalledTimes(2);

      const [updatedGoal1, updatedGoal2] = await Promise.all([
        SavingsGoal.findById(savingsGoal1._id),
        SavingsGoal.findById(savingsGoal2._id)
      ]);

      expect(updatedGoal1.transfers).toHaveLength(1);
      expect(updatedGoal1.transfers[0].amount).toBe(25.00);
      expect(['test-payment-id-1', 'test-payment-id-2']).toContain(updatedGoal1.transfers[0].transferId);

      expect(updatedGoal2.transfers).toHaveLength(1);
      expect(updatedGoal2.transfers[0].amount).toBe(75.00);
      expect(['test-payment-id-1', 'test-payment-id-2']).toContain(updatedGoal2.transfers[0].transferId);

      expect(updatedGoal1.transfers[0].transferId).not.toBe(updatedGoal2.transfers[0].transferId);
    });

    it('should handle mixed dayOfMonth and dayOfWeek schedules', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();
      const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const dayOfWeek = daysOfWeek[today.getUTCDay()];

      const goalByMonth = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Month Goal',
        targetAmount: 600.00,
        savingsAmount: 30.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token-month'
        },
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });

      const goalByWeek = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Week Goal',
        targetAmount: 800.00,
        savingsAmount: 40.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token-week'
        },
        schedule: {
          dayOfMonth: null,
          dayOfWeek: dayOfWeek
        },
        transfers: []
      });

      await Promise.all([goalByMonth.save(), goalByWeek.save()]);

      const mockPayment1 = { data: { id: 'test-payment-month', type: 'achPayment' } };
      const mockPayment2 = { data: { id: 'test-payment-week', type: 'achPayment' } };
      
      mockCreatePayment
        .mockResolvedValueOnce(mockPayment1)
        .mockResolvedValueOnce(mockPayment2);

      await processScheduledPayments();

      expect(mockCreatePayment).toHaveBeenCalledTimes(2);

      const [updatedGoal1, updatedGoal2] = await Promise.all([
        SavingsGoal.findById(goalByMonth._id),
        SavingsGoal.findById(goalByWeek._id)
      ]);

      expect(updatedGoal1.transfers).toHaveLength(1);
      expect(updatedGoal2.transfers).toHaveLength(1);
    });

    it('should skip paused savings goals', async () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();

      const pausedGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Paused Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token'
        },
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: [],
        isPaused: true
      });
      await pausedGoal.save();

      await processScheduledPayments();

      expect(mockCreatePayment).not.toHaveBeenCalled();

      const updatedGoal = await SavingsGoal.findById(pausedGoal._id);
      expect(updatedGoal.transfers).toHaveLength(0);
    });

    it('should process savings goals for a specific date', async () => {
      const date = new Date('2025-09-27');
      const dayOfMonth = date.getUTCDate();

      const savingsGoal = new ManualSavingsGoal({
        userId: testUser._id,
        goalName: 'Specific Date Goal',
        targetAmount: 1000.00,
        savingsAmount: 50.00,
        category: 'other',
        bank: {
          plaidToken: 'test-plaid-token'
        },
        schedule: {
          dayOfMonth: dayOfMonth,
          dayOfWeek: null
        },
        transfers: []
      });
      await savingsGoal.save();

      mockCreatePayment.mockResolvedValue({ data: { id: 'test-payment-id' } });

      await processScheduledPayments(date);

      expect(mockCreatePayment).toHaveBeenCalledWith({
        type: 'achPayment',
        attributes: {
          amount: 5000,
          direction: 'Debit',
          description: 'Funding',
          plaidProcessorToken: 'test-plaid-token',
          tags: { savingsGoalId: savingsGoal._id }
        },
        relationships: {
          account: { data: { type: 'account', id: 'test-unit-account-id' } }
        }
      });

      const updatedGoal = await SavingsGoal.findById(savingsGoal._id);
      expect(updatedGoal.transfers).toHaveLength(1);
      expect(updatedGoal.transfers[0]).toMatchObject({
        transferId: 'test-payment-id',
        amount: 50.00,
        status: 'pending',
        type: 'debit'
      });
    });
  });
});
