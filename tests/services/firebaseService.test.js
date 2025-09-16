// Mock Firebase Admin SDK before importing the service
const mockAuth = {
  createUser: jest.fn(),
  generateEmailVerificationLink: jest.fn(),
  verifyIdToken: jest.fn(),
  getUserByEmail: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  generatePasswordResetLink: jest.fn()
};

const mockAdmin = {
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn()
  },
  auth: jest.fn(() => mockAuth)
};

jest.mock('firebase-admin', () => mockAdmin);

// Import the service after mocking
const firebaseService = require('../../services/firebaseService');

describe('FirebaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up environment variables
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----';
  });

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  describe('createUserWithEmailAndPassword', () => {
    it('should create user successfully', async () => {
      const mockUserRecord = {
        uid: 'test-uid-123',
        email: 'test@example.com',
        displayName: 'John Doe',
        emailVerified: false
      };

      mockAuth.createUser.mockResolvedValue(mockUserRecord);
      mockAuth.generateEmailVerificationLink.mockResolvedValue('https://example.com/verify');

      const result = await firebaseService.createUserWithEmailAndPassword(
        'test@example.com',
        'password123',
        'John',
        'Doe'
      );

      expect(mockAuth.createUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'John Doe',
        emailVerified: false
      });

      expect(mockAuth.generateEmailVerificationLink).toHaveBeenCalledWith('test@example.com');
      expect(result).toEqual(mockUserRecord);
    });

    it('should handle createUser error', async () => {
      const error = new Error('Email already exists');
      mockAuth.createUser.mockRejectedValue(error);

      await expect(firebaseService.createUserWithEmailAndPassword(
        'test@example.com',
        'password123',
        'John',
        'Doe'
      )).rejects.toThrow('Email already exists');
    });

    it('should handle generateEmailVerificationLink error', async () => {
      const mockUserRecord = {
        uid: 'test-uid-123',
        email: 'test@example.com',
        displayName: 'John Doe',
        emailVerified: false
      };

      mockAuth.createUser.mockResolvedValue(mockUserRecord);
      mockAuth.generateEmailVerificationLink.mockRejectedValue(new Error('Verification link error'));

      // The service should throw the error when verification link fails
      await expect(firebaseService.createUserWithEmailAndPassword(
        'test@example.com',
        'password123',
        'John',
        'Doe'
      )).rejects.toThrow('Verification link error');
    });
  });

  describe('verifyIdToken', () => {
    it('should verify token successfully', async () => {
      const mockDecodedToken = {
        uid: 'test-uid-123',
        email: 'test@example.com',
        email_verified: true,
        iat: 1234567890,
        exp: 1234567890
      };

      mockAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);

      const result = await firebaseService.verifyIdToken('valid-token');

      expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('valid-token');
      expect(result).toEqual(mockDecodedToken);
    });

    it('should handle invalid token error', async () => {
      const error = new Error('Invalid token');
      mockAuth.verifyIdToken.mockRejectedValue(error);

      await expect(firebaseService.verifyIdToken('invalid-token'))
        .rejects
        .toThrow('Invalid token');
    });

    it('should handle expired token error', async () => {
      const error = new Error('Token expired');
      mockAuth.verifyIdToken.mockRejectedValue(error);

      await expect(firebaseService.verifyIdToken('expired-token'))
        .rejects
        .toThrow('Token expired');
    });
  });

  describe('getUserByEmail', () => {
    it('should get user by email successfully', async () => {
      const mockUserRecord = {
        uid: 'test-uid-123',
        email: 'test@example.com',
        displayName: 'John Doe'
      };

      mockAuth.getUserByEmail.mockResolvedValue(mockUserRecord);

      const result = await firebaseService.getUserByEmail('test@example.com');

      expect(mockAuth.getUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(result).toEqual(mockUserRecord);
    });

    it('should return null for user not found', async () => {
      const error = new Error('User not found');
      error.code = 'auth/user-not-found';
      mockAuth.getUserByEmail.mockRejectedValue(error);

      const result = await firebaseService.getUserByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should handle other errors', async () => {
      const error = new Error('Permission denied');
      mockAuth.getUserByEmail.mockRejectedValue(error);

      await expect(firebaseService.getUserByEmail('test@example.com'))
        .rejects
        .toThrow('Permission denied');
    });
  });

  describe('updateUser', () => {
    it('should update user successfully', async () => {
      const mockUpdatedUser = {
        uid: 'test-uid-123',
        email: 'updated@example.com',
        displayName: 'Updated Name'
      };

      const updates = {
        email: 'updated@example.com',
        displayName: 'Updated Name'
      };

      mockAuth.updateUser.mockResolvedValue(mockUpdatedUser);

      const result = await firebaseService.updateUser('test-uid-123', updates);

      expect(mockAuth.updateUser).toHaveBeenCalledWith('test-uid-123', updates);
      expect(result).toEqual(mockUpdatedUser);
    });

    it('should handle update error', async () => {
      const error = new Error('User not found');
      mockAuth.updateUser.mockRejectedValue(error);

      await expect(firebaseService.updateUser('invalid-uid', { displayName: 'New Name' }))
        .rejects
        .toThrow('User not found');
    });

    it('should handle invalid updates', async () => {
      const error = new Error('Invalid update data');
      mockAuth.updateUser.mockRejectedValue(error);

      await expect(firebaseService.updateUser('test-uid-123', { invalidField: 'value' }))
        .rejects
        .toThrow('Invalid update data');
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      mockAuth.deleteUser.mockResolvedValue();

      await firebaseService.deleteUser('test-uid-123');

      expect(mockAuth.deleteUser).toHaveBeenCalledWith('test-uid-123');
    });

    it('should handle delete error', async () => {
      const error = new Error('User not found');
      mockAuth.deleteUser.mockRejectedValue(error);

      await expect(firebaseService.deleteUser('invalid-uid'))
        .rejects
        .toThrow('User not found');
    });

    it('should handle permission error', async () => {
      const error = new Error('Insufficient permissions');
      mockAuth.deleteUser.mockRejectedValue(error);

      await expect(firebaseService.deleteUser('test-uid-123'))
        .rejects
        .toThrow('Insufficient permissions');
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should send password reset email successfully', async () => {
      const mockResetLink = 'https://example.com/reset?token=abc123';
      mockAuth.generatePasswordResetLink.mockResolvedValue(mockResetLink);

      const result = await firebaseService.sendPasswordResetEmail('test@example.com');

      expect(mockAuth.generatePasswordResetLink).toHaveBeenCalledWith('test@example.com');
      expect(result).toBe(mockResetLink);
    });

    it('should handle email not found error', async () => {
      const error = new Error('Email not found');
      mockAuth.generatePasswordResetLink.mockRejectedValue(error);

      await expect(firebaseService.sendPasswordResetEmail('nonexistent@example.com'))
        .rejects
        .toThrow('Email not found');
    });

    it('should handle invalid email error', async () => {
      const error = new Error('Invalid email format');
      mockAuth.generatePasswordResetLink.mockRejectedValue(error);

      await expect(firebaseService.sendPasswordResetEmail('invalid-email'))
        .rejects
        .toThrow('Invalid email format');
    });
  });

  describe('sendEmailVerification', () => {
    it('should send email verification successfully', async () => {
      const mockVerificationLink = 'https://example.com/verify?token=xyz789';
      mockAuth.generateEmailVerificationLink.mockResolvedValue(mockVerificationLink);

      const result = await firebaseService.sendEmailVerification('test@example.com');

      expect(mockAuth.generateEmailVerificationLink).toHaveBeenCalledWith('test@example.com');
      expect(result).toBe(mockVerificationLink);
    });

    it('should handle email not found error', async () => {
      const error = new Error('Email not found');
      mockAuth.generateEmailVerificationLink.mockRejectedValue(error);

      await expect(firebaseService.sendEmailVerification('nonexistent@example.com'))
        .rejects
        .toThrow('Email not found');
    });

    it('should handle already verified error', async () => {
      const error = new Error('Email already verified');
      mockAuth.generateEmailVerificationLink.mockRejectedValue(error);

      await expect(firebaseService.sendEmailVerification('verified@example.com'))
        .rejects
        .toThrow('Email already verified');
    });
  });

  describe('Firebase initialization', () => {
    it('should handle private key with escaped newlines', () => {
      process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----';
      
      // Re-import the service to test the key replacement
      jest.resetModules();
      require('../../services/firebaseService');

      expect(mockAdmin.credential.cert).toHaveBeenCalledWith({
        projectId: 'test-project',
        clientEmail: 'test@test-project.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----'
      });
    });
  });
});
