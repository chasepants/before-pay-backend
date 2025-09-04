const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const launchRouter = require('../../routes/launch');
const LaunchUser = require('../../models/LaunchUser');

const app = express();
app.use(express.json());
app.use('/api/launch', launchRouter);

describe('Launch Routes', () => {
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
    await LaunchUser.deleteMany({});
  });

  describe('POST /notify', () => {
    it('should successfully register a new launch user', async () => {
      const userData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com'
      };

      const response = await request(app)
        .post('/api/launch/notify')
        .send(userData)
        .expect(201);

      expect(response.body.message).toBe('Successfully registered for launch notifications!');
      expect(response.body.user).toEqual(userData);

      // Verify user was saved to database
      const savedUser = await LaunchUser.findOne({ email: userData.email });
      expect(savedUser).toBeTruthy();
      expect(savedUser.firstName).toBe(userData.firstName);
      expect(savedUser.lastName).toBe(userData.lastName);
      expect(savedUser.email).toBe(userData.email);
      expect(savedUser.source).toBe('landing_page');
      expect(savedUser.createdAt).toBeInstanceOf(Date);
    });

    it('should return 400 when firstName is missing', async () => {
      const userData = {
        lastName: 'Doe',
        email: 'john.doe@example.com'
      };

      const response = await request(app)
        .post('/api/launch/notify')
        .send(userData)
        .expect(400);

      expect(response.body.error).toBe('First name, last name, and email are required');
    });

    it('should return 400 when lastName is missing', async () => {
      const userData = {
        firstName: 'John',
        email: 'john.doe@example.com'
      };

      const response = await request(app)
        .post('/api/launch/notify')
        .send(userData)
        .expect(400);

      expect(response.body.error).toBe('First name, last name, and email are required');
    });

    it('should return 400 when email is missing', async () => {
      const userData = {
        firstName: 'John',
        lastName: 'Doe'
      };

      const response = await request(app)
        .post('/api/launch/notify')
        .send(userData)
        .expect(400);

      expect(response.body.error).toBe('First name, last name, and email are required');
    });

    it('should return 400 when all required fields are missing', async () => {
      const response = await request(app)
        .post('/api/launch/notify')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('First name, last name, and email are required');
    });

    it('should return 409 when email already exists', async () => {
      // First, create a user
      const existingUser = new LaunchUser({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com'
      });
      await existingUser.save();

      // Try to create another user with the same email
      const duplicateUser = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'jane.smith@example.com'
      };

      const response = await request(app)
        .post('/api/launch/notify')
        .send(duplicateUser)
        .expect(409);

      expect(response.body.error).toBe('Email already registered for launch notifications');

      // Verify only one user exists in database
      const users = await LaunchUser.find({ email: 'jane.smith@example.com' });
      expect(users).toHaveLength(1);
    });

    it('should handle empty strings as missing values', async () => {
      const userData = {
        firstName: '',
        lastName: 'Doe',
        email: 'john.doe@example.com'
      };

      const response = await request(app)
        .post('/api/launch/notify')
        .send(userData)
        .expect(400);

      expect(response.body.error).toBe('First name, last name, and email are required');
    });

    it('should handle whitespace-only strings as missing values', async () => {
      const userData = {
        firstName: '   ',
        lastName: 'Doe',
        email: 'john.doe@example.com'
      };

      const response = await request(app)
        .post('/api/launch/notify')
        .send(userData)
        .expect(400);

      expect(response.body.error).toBe('First name, last name, and email are required');
    });

    it('should return 500 when database error occurs', async () => {
      // Mock a database error by temporarily breaking the connection
      const originalSave = LaunchUser.prototype.save;
      LaunchUser.prototype.save = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const userData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com'
      };

      const response = await request(app)
        .post('/api/launch/notify')
        .send(userData)
        .expect(500);

      expect(response.body.error).toBe('Failed to register for launch notifications');

      // Restore the original save method
      LaunchUser.prototype.save = originalSave;
    });

    it('should save user with correct default values', async () => {
      const userData = {
        firstName: 'Alice',
        lastName: 'Johnson',
        email: 'alice.johnson@example.com'
      };

      await request(app)
        .post('/api/launch/notify')
        .send(userData)
        .expect(201);

      const savedUser = await LaunchUser.findOne({ email: userData.email });
      expect(savedUser.source).toBe('landing_page');
      expect(savedUser.createdAt).toBeInstanceOf(Date);
      
      // Check that createdAt is recent (within last 5 seconds)
      const now = new Date();
      const timeDiff = now.getTime() - savedUser.createdAt.getTime();
      expect(timeDiff).toBeLessThan(5000);
    });
  });
});
