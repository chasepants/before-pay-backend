const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ShopifyMerchant = require('../../models/ShopifyMerchant');

jest.mock('@unit-finance/unit-node-sdk', () => {
  return {
    Unit: jest.fn().mockImplementation(() => ({
      accounts: {
        create: jest.fn().mockResolvedValue({
          data: {
            id: 'account-123',
            attributes: {
              depositProduct: 'checking',
              status: 'Open'
            }
          }
        })
      }
    }))
  };
});

const { Unit } = require('@unit-finance/unit-node-sdk');

describe('Merchant Webhooks', () => {
  let mongoServer;
  let mockUnit;

  beforeAll(async () => {

    process.env.UNIT_API_KEY = 'test-api-key';
    process.env.UNIT_API_BASE = 'https://api.s.unit.sh';
    
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await ShopifyMerchant.deleteMany({});
    jest.clearAllMocks();

    mockUnit = new Unit('test-api-key', 'https://api.s.unit.sh');
    mockUnit.accounts.create.mockResolvedValue({
      data: {
        id: 'account-123',
        attributes: {}
      }
    });
    
    const webhookHandlers = require('../../webhooks/index');
    webhookHandlers.setUnitInstance(mockUnit);
  });

  describe('handleMerchantApplicationCreated', () => {
    it('should create merchant application and update status', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'pending'
      });
      await merchant.save();

      const eventData = {
        attributes: {
          tags: {
            merchantId: merchant._id.toString()
          }
        },
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantApplicationCreated } = webhookHandlers;

      await handleMerchantApplicationCreated(eventData);

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.unitApplicationId).toBe('app-123');
      expect(updatedMerchant.onboardingStatus).toBe('in_progress');
    });

    it('should handle missing merchantId in tags', async () => {
      const eventData = {
        attributes: {
          tags: {}
        },
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantApplicationCreated } = webhookHandlers;

      await expect(handleMerchantApplicationCreated(eventData)).resolves.not.toThrow();
    });

    it('should handle non-existent merchant', async () => {
      const eventData = {
        attributes: {
          tags: {
            merchantId: new mongoose.Types.ObjectId().toString()
          }
        },
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantApplicationCreated } = webhookHandlers;

      await expect(handleMerchantApplicationCreated(eventData)).resolves.not.toThrow();
    });
  });

  describe('handleMerchantApplicationApproved', () => {
    it('should update merchant status to in_progress when not completed', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'pending'
      });
      await merchant.save();

      const eventData = {
        attributes: {
          tags: {
            merchantId: merchant._id.toString()
          }
        },
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantApplicationApproved } = webhookHandlers;

      await handleMerchantApplicationApproved(eventData);

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.onboardingStatus).toBe('in_progress');
    });

    it('should not update status when merchant is already completed', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'completed'
      });
      await merchant.save();

      const eventData = {
        attributes: {
          tags: {
            merchantId: merchant._id.toString()
          }
        },
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantApplicationApproved } = webhookHandlers;

      await handleMerchantApplicationApproved(eventData);

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.onboardingStatus).toBe('completed');
    });
  });

  describe('handleMerchantCustomerCreated', () => {
    it('should create customer and deposit account, then complete onboarding', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'in_progress'
      });
      await merchant.save();

      const eventData = {
        attributes: {
          tags: {
            merchantId: merchant._id.toString()
          }
        },
        relationships: {
          customer: {
            data: {
              id: 'customer-123'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantCustomerCreated } = webhookHandlers;

      await handleMerchantCustomerCreated(eventData);

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.unitCustomerId).toBe('customer-123');
      expect(updatedMerchant.unitAccountId).toBe('account-123');
      expect(updatedMerchant.onboardingStatus).toBe('completed');
    });

    it('should handle Unit account creation failure', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'in_progress'
      });
      await merchant.save();

      mockUnit.accounts.create.mockRejectedValue(new Error('Unit API error'));

      const eventData = {
        attributes: {
          tags: {
            merchantId: merchant._id.toString()
          }
        },
        relationships: {
          customer: {
            data: {
              id: 'customer-123'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantCustomerCreated } = webhookHandlers;

      await expect(handleMerchantCustomerCreated(eventData)).rejects.toThrow('Failed to create deposit account for merchant');

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.unitCustomerId).toBe('customer-123');
      expect(updatedMerchant.onboardingStatus).toBe('in_progress');
    });
  });

  describe('handleMerchantAccountCreated', () => {
    it('should update account ID when account does not exist', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'in_progress'
      });
      await merchant.save();

      const eventData = {
        attributes: {
          tags: {
            merchantId: merchant._id.toString()
          }
        },
        relationships: {
          account: {
            data: {
              id: 'account-456'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantAccountCreated } = webhookHandlers;

      await handleMerchantAccountCreated(eventData);

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.unitAccountId).toBe('account-456');
      expect(updatedMerchant.onboardingStatus).toBe('completed');
    });

    it('should not update when account already exists', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'completed',
        unitAccountId: 'existing-account'
      });
      await merchant.save();

      const eventData = {
        attributes: {
          tags: {
            merchantId: merchant._id.toString()
          }
        },
        relationships: {
          account: {
            data: {
              id: 'account-456'
            }
          }
        }
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantAccountCreated } = webhookHandlers;

      await handleMerchantAccountCreated(eventData);

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.unitAccountId).toBe('existing-account');
    });
  });

  describe('Webhook Router Integration', () => {
    it('should route merchant application.created events correctly', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'pending'
      });
      await merchant.save();

      const eventData = {
        data: [{
          type: 'application.created',
          attributes: {
            tags: {
              merchantId: merchant._id.toString()
            }
          },
          relationships: {
            application: {
              data: {
                id: 'app-123'
              }
            }
          }
        }]
      };

      const mockWebhook = jest.fn();
      const express = require('express');
      const app = express();
      app.use(express.json());
      app.post('/webhook', mockWebhook);

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantApplicationCreated } = webhookHandlers;

      await handleMerchantApplicationCreated(eventData.data[0]);

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.unitApplicationId).toBe('app-123');
      expect(updatedMerchant.onboardingStatus).toBe('in_progress');
    });

    it('should route merchant customer.created events correctly', async () => {
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'in_progress'
      });
      await merchant.save();

      const eventData = {
        data: [{
          type: 'customer.created',
          attributes: {
            tags: {
              merchantId: merchant._id.toString()
            }
          },
          relationships: {
            customer: {
              data: {
                id: 'customer-123'
              }
            }
          }
        }]
      };

      const webhookHandlers = require('../../webhooks/index');
      const { handleMerchantCustomerCreated } = webhookHandlers;

      await handleMerchantCustomerCreated(eventData.data[0]);

      const updatedMerchant = await ShopifyMerchant.findById(merchant._id);
      expect(updatedMerchant.unitCustomerId).toBe('customer-123');
      expect(updatedMerchant.unitAccountId).toBe('account-123');
      expect(updatedMerchant.onboardingStatus).toBe('completed');
    });
  });
});
