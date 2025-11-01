const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { hasProcessInstallment } = require('../../cron/process-installments');
const SavingsGoal = require('../../models/SavingsGoal');

describe('hasProcessInstallment', () => {
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
    await SavingsGoal.deleteMany({});
  });

  describe('Basic functionality', () => {
    it('should return false when goal has no transfers', () => {
      const goal = { transfers: [] };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when transfers array is null', () => {
      const goal = { transfers: null };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when transfers array is undefined', () => {
      const goal = {};
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when no date is provided', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15'),
          status: 'completed',
          type: 'debit'
        }]
      };
      expect(hasProcessInstallment(goal)).toBe(false);
    });
  });

  describe('Date matching', () => {
    it('should return true when transfer exists on the exact date', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:30:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return true when transfer exists at start of day', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T00:00:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return true when transfer exists at end of day', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T23:59:59Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return false when transfer is on different date', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-14T10:30:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when transfer is on next day', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-16T00:00:01Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });
  });

  describe('Failed transfers', () => {
    it('should return false when transfer has failed status', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:30:00Z'),
          status: 'failed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return true when transfer is pending', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:30:00Z'),
          status: 'pending',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return true when transfer is completed', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:30:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });
  });

  describe('Multiple transfers', () => {
    it('should return true when at least one non-failed transfer exists on date', () => {
      const goal = {
        transfers: [
          {
            date: new Date('2024-01-14T10:30:00Z'),
            status: 'completed',
            type: 'debit'
          },
          {
            date: new Date('2024-01-15T10:30:00Z'),
            status: 'failed',
            type: 'debit'
          },
          {
            date: new Date('2024-01-15T11:30:00Z'),
            status: 'completed',
            type: 'debit'
          }
        ]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should return false when all transfers on date have failed status', () => {
      const goal = {
        transfers: [
          {
            date: new Date('2024-01-15T10:30:00Z'),
            status: 'failed',
            type: 'debit'
          },
          {
            date: new Date('2024-01-15T11:30:00Z'),
            status: 'failed',
            type: 'debit'
          }
        ]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should return false when no transfers exist on the specific date', () => {
      const goal = {
        transfers: [
          {
            date: new Date('2024-01-14T10:30:00Z'),
            status: 'completed',
            type: 'debit'
          },
          {
            date: new Date('2024-01-16T10:30:00Z'),
            status: 'completed',
            type: 'debit'
          }
        ]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });
  });

  describe('Different timezones', () => {
    it('should correctly handle UTC dates', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T12:00:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should correctly handle dates with timezone offset', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-15T10:00:00-05:00'), // EST
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty transfers array', () => {
      const goal = { transfers: [] };
      const date = new Date('2024-01-15');
      expect(hasProcessInstallment(goal, date)).toBe(false);
    });

    it('should handle dates at different months', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-01-31T10:00:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-01-31');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });

    it('should handle dates at year boundaries', () => {
      const goal = {
        transfers: [{
          date: new Date('2024-12-31T10:00:00Z'),
          status: 'completed',
          type: 'debit'
        }]
      };
      const date = new Date('2024-12-31');
      expect(hasProcessInstallment(goal, date)).toBe(true);
    });
  });
});
