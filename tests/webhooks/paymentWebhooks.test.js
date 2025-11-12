const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const SavingsGoal = require('../../models/SavingsGoal');
const Payment = require('../../models/Payment');
const PaymentAccount = require('../../models/PaymentAccount');
const User = require('../../models/User');

// Mock webhookService module
const mockWebhookService = {
  handlePaymentCreated: jest.fn(),
  handlePaymentClearing: jest.fn(),
  handlePaymentSent: jest.fn(),
  handlePaymentRejected: jest.fn(),
  handlePaymentReturned: jest.fn(),
  handlePaymentCanceled: jest.fn(),
  handleTransactionCreated: jest.fn(),
  handleBatchTransferCompleted: jest.fn()
};

jest.mock('../../services/webhookService', () => mockWebhookService);

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
    await Payment.deleteMany({});
    await PaymentAccount.deleteMany({});
    await SavingsGoal.deleteMany({});
    await User.deleteMany({});
    jest.clearAllMocks();
  });

  describe('handlePaymentCreated', () => {
    it('should delegate to SavingsGoalService', async () => {
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

      expect(mockWebhookService.handlePaymentCreated).toHaveBeenCalledWith(eventData);
    });

    it('should handle missing payment ID gracefully', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentCreated } = webhookHandlers;

      const eventData = {
        relationships: {}
      };

      await expect(handlePaymentCreated(eventData)).resolves.toBeUndefined();
      expect(mockWebhookService.handlePaymentCreated).toHaveBeenCalledWith(eventData);
    });

    it('should handle empty event data', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handlePaymentCreated } = webhookHandlers;

      const eventData = {};

      await expect(handlePaymentCreated(eventData)).resolves.toBeUndefined();
      expect(mockWebhookService.handlePaymentCreated).toHaveBeenCalledWith(eventData);
    });
  });

  describe('handlePaymentClearing', () => {
    it('should delegate to SavingsGoalService', async () => {
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

      expect(mockWebhookService.handlePaymentClearing).toHaveBeenCalledWith(eventData);
    });
  });

  describe('handlePaymentSent', () => {
    it('should delegate to SavingsGoalService', async () => {
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

      expect(mockWebhookService.handlePaymentSent).toHaveBeenCalledWith(eventData);
    });
  });

  describe('handlePaymentRejected', () => {
    it('should delegate to SavingsGoalService with failed status', async () => {
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

      expect(mockWebhookService.handlePaymentRejected).toHaveBeenCalledWith(eventData);
    });
  });

  describe('handlePaymentReturned', () => {
    it('should delegate to SavingsGoalService with failed status', async () => {
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

      expect(mockWebhookService.handlePaymentReturned).toHaveBeenCalledWith(eventData);
    });
  });

  describe('handlePaymentCanceled', () => {
    it('should delegate to SavingsGoalService with canceled status', async () => {
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

      expect(mockWebhookService.handlePaymentCanceled).toHaveBeenCalledWith(eventData);
    });
  });
});
