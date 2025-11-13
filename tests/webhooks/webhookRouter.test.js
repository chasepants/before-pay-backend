const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

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

jest.mock('axios');
const axios = require('axios');

// Set UNIT_API_KEY for tests
process.env.UNIT_API_KEY = 'test-api-key';

const { webhook } = require('../../webhooks/index');

describe('Webhook Router', () => {
  let app;
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    app = express();
    app.use(express.json());
    app.post('/api/webhooks/unit', webhook);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
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

  describe('POST /api/webhooks/unit', () => {
    it('should handle valid webhook payload', async () => {
      const payload = {
        data: [{
          type: 'application.approved',
          attributes: {
            tags: {
              userId: '507f1f77bcf86cd799439011'
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

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle multiple events in payload', async () => {
      const payload = {
        data: [
          {
            type: 'application.approved',
            attributes: {
              tags: {
                userId: '507f1f77bcf86cd799439011'
              }
            },
            relationships: {
              application: {
                data: {
                  id: 'app-123'
                }
              }
            }
          },
          {
            type: 'customer.created',
            attributes: {
              tags: {
                userId: '507f1f77bcf86cd799439011'
              }
            },
            relationships: {
              customer: {
                data: {
                  id: 'customer-123'
                }
              }
            }
          }
        ]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle string payload', async () => {
      const payload = {
        data: [{
          type: 'application.approved',
          attributes: {
            tags: {
              userId: '507f1f77bcf86cd799439011'
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

      const response = await request(app)
        .post('/api/webhooks/unit')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(payload))
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle invalid payload - not array', async () => {
      const payload = {
        data: {
          type: 'application.approved'
        }
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(400);

      expect(response.body).toEqual({ error: 'Invalid webhook payload' });
    });

    it('should handle invalid JSON', async () => {
      const response = await request(app)
        .post('/api/webhooks/unit')
        .send('invalid json')
        .expect(400);

      expect(response.body).toEqual({ error: 'Invalid webhook payload' });
    });

    it('should handle unrecognized event type', async () => {
      const payload = {
        data: [{
          type: 'unknown.event.type',
          attributes: {}
        }]
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
      expect(consoleSpy).toHaveBeenCalledWith('unrecognized event', 'unknown.event.type');
      consoleSpy.mockRestore();
    });

    it('should handle merchant application events', async () => {
      const payload = {
        data: [{
          type: 'application.created',
          attributes: {
            tags: {
              merchantId: '507f1f77bcf86cd799439011'
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

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle merchant customer events', async () => {
      const payload = {
        data: [{
          type: 'customer.created',
          attributes: {
            tags: {
              merchantId: '507f1f77bcf86cd799439011'
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

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle merchant account events', async () => {
      const payload = {
        data: [{
          type: 'account.created',
          attributes: {
            tags: {
              merchantId: '507f1f77bcf86cd799439011'
            }
          },
          relationships: {
            account: {
              data: {
                id: 'account-123'
              }
            }
          }
        }]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle regular account events', async () => {
      const payload = {
        data: [{
          type: 'account.created',
          attributes: {
            tags: {
              userId: '507f1f77bcf86cd799439011'
            }
          },
          relationships: {
            account: {
              data: {
                id: 'account-123'
              }
            }
          }
        }]
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
      expect(consoleSpy).toHaveBeenCalledWith('Regular account.created event (not merchant)');
      consoleSpy.mockRestore();
    });

    it('should handle payment events', async () => {
      // Create test data
      const User = require('../../models/User');
      const SavingsGoal = require('../../models/SavingsGoal');
      const Payment = require('../../models/Payment');
      const PaymentAccount = require('../../models/PaymentAccount');
      
      const user = new User({
        email: 'test@example.com',
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
        savingsAmount: 100
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

      const payload = {
        data: [{
          type: 'payment.created',
          relationships: {
            payment: {
              data: {
                id: 'payment-123'
              }
            }
          }
        }]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    }, 10000); // Increase timeout

    it('should handle payment.clearing event', async () => {
      const payload = {
        data: [{
          type: 'payment.clearing',
          relationships: {
            payment: {
              data: {
                id: 'payment-123'
              }
            }
          }
        }]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle payment.sent event', async () => {
      const payload = {
        data: [{
          type: 'payment.sent',
          relationships: {
            payment: {
              data: {
                id: 'payment-123'
              }
            }
          }
        }]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle payment.rejected event', async () => {
      const payload = {
        data: [{
          type: 'payment.rejected',
          relationships: {
            payment: {
              data: {
                id: 'payment-123'
              }
            }
          }
        }]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle payment.returned event', async () => {
      const payload = {
        data: [{
          type: 'payment.returned',
          relationships: {
            payment: {
              data: {
                id: 'payment-123'
              }
            }
          }
        }]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle payment.canceled event', async () => {
      const payload = {
        data: [{
          type: 'payment.canceled',
          relationships: {
            payment: {
              data: {
                id: 'payment-123'
              }
            }
          }
        }]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });

    it('should handle transaction events', async () => {
      const payload = {
        data: [{
          type: 'transaction.created',
          relationships: {
            transaction: {
              data: {
                id: 'transaction-123'
              }
            }
          }
        }]
      };

      const response = await request(app)
        .post('/api/webhooks/unit')
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ received: true });
    });
  });
});
