const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Mock Firebase Admin SDK
const mockCreateUser = jest.fn();
const mockVerifyIdToken = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockSendPasswordResetEmail = jest.fn();
const mockSendEmailVerification = jest.fn();

jest.mock('../../services/firebaseService', () => ({
  createUserWithEmailAndPassword: mockCreateUser,
  verifyIdToken: mockVerifyIdToken,
  getUserByEmail: mockGetUserByEmail,
  sendPasswordResetEmail: mockSendPasswordResetEmail,
  sendEmailVerification: mockSendEmailVerification,
}));

const firebaseService = require('../../services/firebaseService');

describe('Email/Password Authentication Routes', () => {
  let mongoServer;
  let app;

  beforeAll(async () => {
    // Start in-memory MongoDB server
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
    
    // Create a test Express app with auth routes
    app = express();
    app.use(express.json());
    
    // Mock JWT secret
    process.env.JWT_SECRET = 'test-jwt-secret';
    
    // Import and use auth routes and user routes
    const authRoutes = require('../../routes/auth');
    const userRoutes = require('../../routes/users');
    app.use('/api/auth', authRoutes);
    app.use('/api/users', userRoutes);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/users (user registration)', () => {
    it('should register a new user successfully', async () => {
      const mockFirebaseUser = {
        uid: 'firebase-uid-123',
        email: 'test@example.com'
      };
      
      mockCreateUser.mockResolvedValue(mockFirebaseUser);

      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe'
        })
        .expect(201);

      expect(response.body).toMatchObject({
        message: 'User created successfully',
        token: expect.any(String),
        user: {
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          status: 'pending'
        }
      });

      expect(mockCreateUser).toHaveBeenCalledWith(
        'test@example.com',
        'password123',
        'John',
        'Doe'
      );
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'test@example.com',
          password: 'password123'
          // Missing firstName and lastName
        })
        .expect(400);

      expect(response.body).toEqual({ error: 'All fields are required' });
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'invalid-email',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe'
        })
        .expect(400);

      expect(response.body).toEqual({ error: 'Invalid email format' });
    });

    it('should return 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'test@example.com',
          password: '123', // Too short
          firstName: 'John',
          lastName: 'Doe'
        })
        .expect(400);

      expect(response.body).toEqual({ error: 'Password must be at least 6 characters long' });
    });

    it('should return 409 for existing user', async () => {
      // First, create a user
      const mockFirebaseUser = {
        uid: 'firebase-uid-123',
        email: 'test@example.com'
      };
      mockCreateUser.mockResolvedValue(mockFirebaseUser);

      await request(app)
        .post('/api/users')
        .send({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe'
        });

      // Try to register the same user again
      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe'
        })
        .expect(409);

      expect(response.body).toEqual({ error: 'User already exists' });
    });

    it('should handle Firebase errors', async () => {
      const firebaseError = new Error('Email already exists');
      firebaseError.code = 'auth/email-already-exists';
      mockCreateUser.mockRejectedValue(firebaseError);

      const response = await request(app)
        .post('/api/users')
        .send({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe'
        })
        .expect(409);

      expect(response.body).toEqual({ error: 'User already exists' });
    });
  });

  describe('POST /api/auth/verify-firebase-token', () => {
    it('should verify Firebase token and create user session', async () => {
      const mockDecodedToken = {
        uid: 'firebase-uid-123',
        email: 'test@example.com',
        name: 'John Doe'
      };
      
      mockVerifyIdToken.mockResolvedValue(mockDecodedToken);

      const response = await request(app)
        .post('/api/auth/verify-firebase-token')
        .send({
          idToken: 'firebase-id-token'
        })
        .expect(200);

      expect(response.body).toMatchObject({
        message: 'Authentication successful',
        token: expect.any(String),
        user: {
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          status: 'pending'
        }
      });

      expect(mockVerifyIdToken).toHaveBeenCalledWith('firebase-id-token');
    });

    it('should return 400 for missing ID token', async () => {
      const response = await request(app)
        .post('/api/auth/verify-firebase-token')
        .send({})
        .expect(400);

      expect(response.body).toEqual({ error: 'ID token is required' });
    });

    it('should handle invalid token', async () => {
      const firebaseError = new Error('Invalid token');
      firebaseError.code = 'auth/invalid-token';
      mockVerifyIdToken.mockRejectedValue(firebaseError);

      const response = await request(app)
        .post('/api/auth/verify-firebase-token')
        .send({
          idToken: 'invalid-token'
        })
        .expect(401);

      expect(response.body).toEqual({ error: 'Invalid token' });
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should send password reset email for existing user', async () => {
      // First create a user
      const mockFirebaseUser = {
        uid: 'firebase-uid-123',
        email: 'test@example.com'
      };
      mockCreateUser.mockResolvedValue(mockFirebaseUser);

      await request(app)
        .post('/api/users')
        .send({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe'
        });

      // Mock password reset
      mockSendPasswordResetEmail.mockResolvedValue('https://reset-link.com');

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({
          email: 'test@example.com'
        })
        .expect(200);

      expect(response.body).toMatchObject({
        message: 'Password reset email sent',
        resetLink: 'https://reset-link.com'
      });

      expect(mockSendPasswordResetEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({
          email: 'nonexistent@example.com'
        })
        .expect(404);

      expect(response.body).toEqual({ error: 'User not found' });
    });

    it('should return 400 for missing email', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({})
        .expect(400);

      expect(response.body).toEqual({ error: 'Email is required' });
    });
  });
});
