const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../../models/User');
const User = require('../../models/User');

const { ensureAuthenticated } = require('../../middleware/auth');

describe('ensureAuthenticated middleware', () => {
  let mongoServer;
  let mockReq;
  let mockRes;
  let mockNext;
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

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockReq = {
      headers: {},
      user: null
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    
    mockNext = jest.fn();
    
    testUser = {
      _id: new mongoose.Types.ObjectId(),
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User'
    };
    
    process.env.JWT_SECRET = 'test-secret';
  });

  describe('when token is provided and valid', () => {
    it('should call next() and set req.user when token is valid and user exists', async () => {
      const token = jwt.sign({ userId: testUser._id }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      
      User.findById.mockResolvedValue(testUser);
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockReq.user).toEqual(testUser);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should handle token with different authorization header formats', async () => {
      const token = jwt.sign({ userId: testUser._id }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `bearer ${token}`;
      
      User.findById.mockResolvedValue(testUser);
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockReq.user).toEqual(testUser);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('when token is missing or invalid', () => {
    it('should return 401 when no authorization header is provided', async () => {
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: No token provided' 
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockReq.user).toBeNull();
    });

    it('should return 401 when authorization header is empty', async () => {
      mockReq.headers.authorization = '';
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: No token provided' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header has no Bearer token', async () => {
      mockReq.headers.authorization = 'Basic some-credentials';
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: Invalid token' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when Bearer token is empty', async () => {
      mockReq.headers.authorization = 'Bearer ';
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: No token provided' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token is malformed', async () => {
      mockReq.headers.authorization = 'Bearer malformed-token';
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: Invalid token' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token is signed with wrong secret', async () => {
      const token = jwt.sign({ userId: testUser._id }, 'wrong-secret');
      mockReq.headers.authorization = `Bearer ${token}`;
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: Invalid token' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token is expired', async () => {
      const token = jwt.sign(
        { userId: testUser._id }, 
        process.env.JWT_SECRET, 
        { expiresIn: '-1h' }
      );
      mockReq.headers.authorization = `Bearer ${token}`;
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: Invalid token' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('when user is not found', () => {
    it('should return 401 when user does not exist in database', async () => {
      const token = jwt.sign({ userId: testUser._id }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      
      User.findById.mockResolvedValue(null);
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: User not found' 
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockReq.user).toBeNull();
    });

    it('should return 401 when User.findById throws an error', async () => {
      const token = jwt.sign({ userId: testUser._id }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      
      User.findById.mockRejectedValue(new Error('Database connection error'));
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: Invalid token' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('when token payload is invalid', () => {
    it('should return 401 when token has no userId', async () => {
      const token = jwt.sign({ email: 'test@example.com' }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: Invalid token' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token has invalid userId format', async () => {
      const token = jwt.sign({ userId: 'invalid-id' }, process.env.JWT_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: Invalid token' 
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('error handling and logging', () => {
    it('should log token verification errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const token = jwt.sign({ userId: testUser._id }, 'wrong-secret');
      mockReq.headers.authorization = `Bearer ${token}`;
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Token verification error:', 
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle JWT verification throwing unexpected errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const originalVerify = jwt.verify;
      jwt.verify = jest.fn().mockImplementation(() => {
        throw new Error('Unexpected JWT error');
      });
      
      const token = 'some-token';
      mockReq.headers.authorization = `Bearer ${token}`;
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Token verification error:', 
        expect.any(Error)
      );
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: Invalid token' 
      });
      
      jwt.verify = originalVerify;
      consoleSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle undefined authorization header', async () => {
      mockReq.headers.authorization = undefined;
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: No token provided' 
      });
    });

    it('should handle null authorization header', async () => {
      mockReq.headers.authorization = null;
      
      await ensureAuthenticated(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ 
        error: 'Unauthorized: No token provided' 
      });
    });
  });
});
