const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../../models/User');

jest.mock('axios');
const axios = require('axios');

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

describe('User Webhooks', () => {
  let mongoServer;
  let mockUnit;

  beforeAll(async () => {
    // Set environment variables for testing
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
    await User.deleteMany({});
    jest.clearAllMocks();

    // Setup Unit mock
    mockUnit = new Unit('test-api-key', 'https://api.s.unit.sh');
    
    // Mock successful Shopify API response
    axios.get.mockResolvedValue({
      data: {
        session: {
          id: 'test-session-id',
          shop_id: '123456789',
          shop_domain: 'test-shop.myshopify.com',
          is_online: true,
          state: 'active'
        }
      }
    });
  });

  describe('handleApplicationCreated', () => {
    it('should create user application and approve in non-production', async () => {
      const user = new User({
        email: 'test@example.com',
        unitCustomerId: 'customer-123'
      });
      await user.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleApplicationCreated } = webhookHandlers;

      const eventData = {
        attributes: {
          tags: {
            userId: user._id.toString()
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

      // Mock axios for approveTestUserApplication
      axios.post.mockResolvedValue({ data: { success: true } });

      await handleApplicationCreated(eventData);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.unitApplicationId).toBe('app-123');
      expect(updatedUser.status).toBe('pending');
    });

    it('should handle missing userId in tags', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handleApplicationCreated } = webhookHandlers;

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

      // Should not throw error
      await expect(handleApplicationCreated(eventData)).resolves.toBeUndefined();
    });

    it('should handle non-existent user', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handleApplicationCreated } = webhookHandlers;

      const eventData = {
        attributes: {
          tags: {
            userId: '507f1f77bcf86cd799439011' // Non-existent ObjectId
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

      // Should not throw error
      await expect(handleApplicationCreated(eventData)).resolves.toBeUndefined();
    });
  });

  describe('handleApplicationApproved', () => {
    it('should update user status to approved', async () => {
      const user = new User({
        email: 'test@example.com',
        unitApplicationId: 'app-123',
        status: 'pending'
      });
      await user.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleApplicationApproved } = webhookHandlers;

      const eventData = {
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      await handleApplicationApproved(eventData);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.status).toBe('approved');
    });

    it('should handle non-existent user', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handleApplicationApproved } = webhookHandlers;

      const eventData = {
        relationships: {
          application: {
            data: {
              id: 'non-existent-app'
            }
          }
        }
      };

      // Should not throw error
      await expect(handleApplicationApproved(eventData)).resolves.toBeUndefined();
    });
  });

  describe('handleApplicationDenied', () => {
    it('should update user status to denied', async () => {
      const user = new User({
        email: 'test@example.com',
        unitApplicationId: 'app-123',
        status: 'pending'
      });
      await user.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleApplicationDenied } = webhookHandlers;

      const eventData = {
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      await handleApplicationDenied(eventData);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.status).toBe('denied');
    });
  });

  describe('handleCustomerCreated', () => {
    it('should create customer and deposit account', async () => {
      const user = new User({
        email: 'test@example.com',
        unitApplicationId: 'app-123',
        status: 'pending'
      });
      await user.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleCustomerCreated, setUnitInstance } = webhookHandlers;
      
      // Inject the mock Unit instance
      setUnitInstance(mockUnit);

      const eventData = {
        attributes: {
          tags: {
            userId: user._id.toString()
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

      await handleCustomerCreated(eventData);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.unitCustomerId).toBe('customer-123');
      expect(updatedUser.unitAccountId).toBe('account-123');
      expect(updatedUser.status).toBe('approved');
    });

    it('should handle Unit account creation failure', async () => {
      const user = new User({
        email: 'test@example.com',
        unitApplicationId: 'app-123',
        status: 'pending'
      });
      await user.save();

      // Mock Unit account creation to fail
      mockUnit.accounts.create.mockRejectedValue(new Error('Unit API error'));

      const webhookHandlers = require('../../webhooks/index');
      const { handleCustomerCreated, setUnitInstance } = webhookHandlers;
      
      // Inject the mock Unit instance
      setUnitInstance(mockUnit);

      const eventData = {
        attributes: {
          tags: {
            userId: user._id.toString()
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

      await expect(handleCustomerCreated(eventData)).rejects.toThrow('Failed to create deposit account');

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.status).toBe('pending');
    });
  });

  describe('handleApplicationAwaitingDocuments', () => {
    it('should update user status to awaitingDocuments', async () => {
      const user = new User({
        email: 'test@example.com',
        unitApplicationId: 'app-123',
        status: 'pending'
      });
      await user.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleApplicationAwaitingDocuments } = webhookHandlers;

      const eventData = {
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      await handleApplicationAwaitingDocuments(eventData);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.status).toBe('awaitingDocuments');
    });
  });

  describe('handleApplicationPendingReview', () => {
    it('should update user status to pendingReview', async () => {
      const user = new User({
        email: 'test@example.com',
        unitApplicationId: 'app-123',
        status: 'pending'
      });
      await user.save();

      const webhookHandlers = require('../../webhooks/index');
      const { handleApplicationPendingReview } = webhookHandlers;

      const eventData = {
        relationships: {
          application: {
            data: {
              id: 'app-123'
            }
          }
        }
      };

      await handleApplicationPendingReview(eventData);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.status).toBe('pendingReview');
    });
  });

  describe('handleDocumentApproved', () => {
    it('should log document approved event', async () => {
      const webhookHandlers = require('../../webhooks/index');
      const { handleDocumentApproved } = webhookHandlers;

      const eventData = {
        type: 'document.approved',
        attributes: {
          documentId: 'doc-123'
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await expect(handleDocumentApproved(eventData)).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith('document approved', eventData);
      consoleSpy.mockRestore();
    });
  });
});
