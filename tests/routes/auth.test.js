const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

// Mock passport with a proper implementation BEFORE requiring the router
jest.mock('passport', () => ({
  authenticate: jest.fn((strategy, options) => (req, res, next) => {
    // Default behavior - just call next()
    next();
  })
}));

// Mock Unit SDK properly
const mockUnitInstance = {
  customerToken: {
    createToken: jest.fn()
  },
  applications: {
    listDocuments: jest.fn()
  }
};

jest.mock('@unit-finance/unit-node-sdk', () => ({
  Unit: jest.fn(() => mockUnitInstance)
}));

jest.mock('axios');

// Mock multer properly with all required methods
jest.mock('multer', () => {
  const mockSingle = jest.fn((fieldName) => (req, res, next) => {
    // Default behavior - just call next()
    next();
  });

  const mockMemoryStorage = jest.fn(() => ({}));

  const mockMulter = jest.fn(() => ({
    single: mockSingle,
    array: jest.fn(),
    fields: jest.fn()
  }));

  mockMulter.memoryStorage = mockMemoryStorage;

  return mockMulter;
});

// Mock ensureAuthenticated middleware
jest.mock('../../middleware/auth.js', () => ({
  ensureAuthenticated: jest.fn()
}));

const passport = require('passport');
const axios = require('axios');
const { Unit } = require('@unit-finance/unit-node-sdk');
const multer = require('multer');
const { ensureAuthenticated } = require('../../middleware/auth.js');

const User = require('../../models/User');
const authRouter = require('../../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

describe('Auth Routes', () => {
  let mongoServer;
  let testUser;
  let authToken;

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
    
    testUser = new User({
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      status: 'approved',
      unitCustomerId: 'customer-123',
      unitApplicationId: 'app-123'
    });
    await testUser.save();
    
    authToken = jwt.sign({ userId: testUser._id }, process.env.JWT_SECRET || 'test-secret');
    
    // Set up ensureAuthenticated mock for each test
    ensureAuthenticated.mockImplementation((req, res, next) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
          req.user = { _id: decoded.userId };
          next();
        } catch (err) {
          res.status(401).json({ error: 'Unauthorized' });
        }
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    });
    
    // Reset Unit SDK mocks
    mockUnitInstance.customerToken.createToken.mockClear();
    mockUnitInstance.applications.listDocuments.mockClear();
    
    jest.clearAllMocks();
  });

  describe('GET /google', () => {
    it('should initiate Google OAuth authentication', async () => {
      passport.authenticate.mockReturnValue((req, res, next) => {
        res.status(200).json({ message: 'OAuth initiated' });
      });

      const response = await request(app)
        .get('/api/auth/google')
        .expect(200);

      expect(passport.authenticate).toHaveBeenCalledWith('google', { scope: ['profile', 'email'] });
      expect(response.body.message).toBe('OAuth initiated');
    });
  });

  describe('GET /google/callback', () => {
    // it('should handle Google callback and create new user', async () => {
    //   await User.deleteMany({});
      
    //   passport.authenticate.mockImplementation((strategy, options) => (req, res, next) => {
    //     req.user = {
    //       email: 'newuser@example.com',
    //       id: 'google-123',
    //       name: { givenName: 'New', familyName: 'User' }
    //     };
    //     next();
    //   });

    //   const response = await request(app)
    //     .get('/api/auth/google/callback')
    //     .expect(302);

    //   const user = await User.findOne({ email: 'newuser@example.com' });
    //   expect(user).toBeTruthy();
    //   expect(user.googleId).toBe('google-123');
    //   expect(user.status).toBe('pending');
    //   expect(response.headers.location).toContain(`${process.env.REACT_APP_URL}/application-signup?token=`);
    // });

    // it('should redirect to home if user is approved', async () => {
    //   passport.authenticate.mockImplementation((strategy, options) => (req, res, next) => {
    //     req.user = {
    //       email: testUser.email,
    //       id: 'google-123',
    //       name: { givenName: 'Test', familyName: 'User' }
    //     };
    //     next();
    //   });

    //   const response = await request(app)
    //     .get('/api/auth/google/callback')
    //     .expect(302);

    //   expect(response.headers.location).toContain(`${process.env.REACT_APP_URL}/home?token=`);
    // });

    it('should redirect to / on failure', async () => {
      passport.authenticate.mockImplementation((strategy, options) => (req, res, next) => {
        req.user = null;
        next();
      });

      const response = await request(app)
        .get('/api/auth/google/callback')
        .expect(302);

      expect(response.headers.location).toBe('/');
    });
  });

  describe('GET /current_user', () => {
    it('should return user data with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/current_user')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        email: testUser.email,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        status: testUser.status
      });
    });

    it('should return null with no token', async () => {
      const response = await request(app)
        .get('/api/auth/current_user')
        .expect(200);

      expect(response.body).toBeNull();
    });

    it('should return null with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/current_user')
        .set('Authorization', `Bearer invalid-token`)
        .expect(200);

      expect(response.body).toBeNull();
    });
  });

  describe('GET /customer-token', () => {
    it('should return customer token for authenticated user', async () => {
      mockUnitInstance.customerToken.createToken.mockResolvedValue({
        data: { attributes: { token: 'unit-token-123' } }
      });

      const response = await request(app)
        .get('/api/auth/customer-token')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({ token: 'unit-token-123' });
      expect(mockUnitInstance.customerToken.createToken).toHaveBeenCalledWith(testUser.unitCustomerId, {
        attributes: { scope: 'customers statements accounts authorizations transactions' },
        type: 'customerToken'
      });
    });

    it('should return 400 if no unitCustomerId', async () => {
      await User.findByIdAndUpdate(testUser._id, { unitCustomerId: null });

      const response = await request(app)
        .get('/api/auth/customer-token')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body).toEqual({ error: 'No Unit application found for user' });
    });

    it('should return 401 if not authenticated', async () => {
      const response = await request(app)
        .get('/api/auth/customer-token')
        .expect(401);

      expect(response.body).toEqual({ error: 'Unauthorized' });
    });
  });

  describe('GET /logout', () => {
    it('should return logout success message', async () => {
      const response = await request(app)
        .get('/api/auth/logout')
        .expect(200);

      expect(response.body).toEqual({ message: 'Logged out successfully' });
    });
  });

  describe('GET /create-application-form', () => {
    it('should create new application form', async () => {
      axios.post.mockResolvedValue({
        data: {
          data: {
            id: 'form-123',
            attributes: { applicationFormToken: { token: 'form-token-123', expiration: '2025-10-01T00:00:00Z' } },
            links: { related: { href: 'https://api.s.unit.sh/form/123' } }
          }
        }
      });

      const response = await request(app)
        .get('/api/auth/create-application-form')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        id: 'form-123',
        token: 'form-token-123',
        expiration: '2025-10-01T00:00:00Z',
        url: 'https://api.s.unit.sh/form/123'
      });

      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.unitApplicationFormId).toBe('form-123');
    });

    it('should return 400 if user not found', async () => {
      await User.deleteMany({});

      const response = await request(app)
        .get('/api/auth/create-application-form')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body).toEqual({ error: 'User not found' });
    });

    it('should return 401 if not authenticated', async () => {
      const response = await request(app)
        .get('/api/auth/create-application-form')
        .expect(401);

      expect(response.body).toEqual({ error: 'Unauthorized' });
    });
  });
});