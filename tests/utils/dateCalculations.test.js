const { calculateNextRunDate } = require('../../utils/dateCalculations');
const mongoose = require('mongoose');

describe('calculateNextRunDate', () => {
  let testUserId;

  beforeEach(() => {
    testUserId = new mongoose.Types.ObjectId();
  });

  describe('Monthly schedules', () => {
    it('should return null if goal is paused', () => {
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: 15, startDate: new Date('2025-01-15') },
        isPaused: true,
        transfers: []
      };
      expect(calculateNextRunDate(goal)).toBeNull();
    });

    it('should return null if no schedule', () => {
      const goal = {
        isPaused: false,
        transfers: []
      };
      expect(calculateNextRunDate(goal)).toBeNull();
    });

    it('should calculate next occurrence from today when dayOfMonth is today', () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate();
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should be next month since today is the target day
      expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
    });

    it('should calculate from today when no payments and dayOfMonth is in future this month', () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate() + 5; // 5 days from now
      const goal = {
        schedule: { 
          interval: 'Monthly', 
          dayOfMonth
          // No startDate - should calculate from today
        },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      expect(result.getUTCMonth()).toBe(today.getUTCMonth());
    });

    it('should calculate next month when no payments and dayOfMonth is in past', () => {
      const today = new Date();
      const dayOfMonth = today.getUTCDate() - 5; // 5 days ago
      const goal = {
        schedule: { 
          interval: 'Monthly', 
          dayOfMonth
          // No startDate - should calculate from today
        },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
    });

    it('should calculate from today regardless of payment history (1 payment)', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today, not from payment date
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should calculate from today regardless of payment history (multiple payments)', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-2',
            date: new Date('2025-02-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-3',
            date: new Date('2025-03-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today, not from payment dates
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should calculate from today regardless of pending payments', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-2',
            date: new Date('2025-02-15T00:00:00.000Z'),
            status: 'pending',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today, ignoring payment history
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should calculate from today regardless of failed payments', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-2',
            date: new Date('2025-02-15T00:00:00.000Z'),
            status: 'failed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today, ignoring failed payments
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should calculate from today regardless of refund (credit) payments', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-2',
            date: new Date('2025-02-15T00:00:00.000Z'),
            status: 'completed',
            type: 'credit', // Refund
            amount: 50
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today, ignoring all payment history
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should handle month boundaries correctly', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should handle year boundaries correctly', () => {
      // Test when today is in December and dayOfMonth is in the past
      const mockDate = new Date('2025-12-20T12:00:00.000Z'); // December 20
      const originalDate = global.Date;
      global.Date = jest.fn((...args) => {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      });
      global.Date.UTC = originalDate.UTC;
      global.Date.now = originalDate.now;
      global.Date.prototype = originalDate.prototype;
      
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: 15 },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result.getUTCDate()).toBe(15);
      expect(result.getUTCMonth()).toBe(0); // January (0-indexed, next month)
      expect(result.getUTCFullYear()).toBe(2026);
      
      global.Date = originalDate;
    });
  });

  describe('Weekly schedules', () => {
    it('should calculate next occurrence from today when no payments exist', () => {
      const goal = {
        schedule: { interval: 'Weekly', dayOfWeek: 'Monday' },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDay()).toBe(1); // Monday
      // Should be next Monday from today
      const today = new Date();
      const daysUntilMonday = (1 - today.getUTCDay() + 7) % 7 || 7;
      const expectedDate = new Date(today);
      expectedDate.setUTCDate(today.getUTCDate() + daysUntilMonday);
      expectedDate.setUTCHours(0, 0, 0, 0);
      expect(result.getTime()).toBe(expectedDate.getTime());
    });

    it('should calculate from today regardless of payment history (1 payment)', () => {
      const goal = {
        schedule: { interval: 'Weekly', dayOfWeek: 'Monday' },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-13T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDay()).toBe(1); // Monday
      // Should calculate from today, not from payment date
      const today = new Date();
      const daysUntilMonday = (1 - today.getUTCDay() + 7) % 7 || 7;
      const expectedDate = new Date(today);
      expectedDate.setUTCDate(today.getUTCDate() + daysUntilMonday);
      expectedDate.setUTCHours(0, 0, 0, 0);
      expect(result.getTime()).toBe(expectedDate.getTime());
    });

    it('should calculate from today regardless of payment history (multiple payments)', () => {
      const goal = {
        schedule: { interval: 'Weekly', dayOfWeek: 'Monday' },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-13T00:00:00.000Z'), // Monday
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-2',
            date: new Date('2025-01-20T00:00:00.000Z'), // Monday
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-3',
            date: new Date('2025-01-27T00:00:00.000Z'), // Monday
            status: 'completed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDay()).toBe(1); // Monday
      // Should calculate from today, not from payment dates
      const today = new Date();
      const daysUntilMonday = (1 - today.getUTCDay() + 7) % 7 || 7;
      const expectedDate = new Date(today);
      expectedDate.setUTCDate(today.getUTCDate() + daysUntilMonday);
      expectedDate.setUTCHours(0, 0, 0, 0);
      expect(result.getTime()).toBe(expectedDate.getTime());
    });

    it('should calculate from today regardless of pending and failed payments', () => {
      const goal = {
        schedule: { interval: 'Weekly', dayOfWeek: 'Monday' },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-13T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-2',
            date: new Date('2025-01-20T00:00:00.000Z'),
            status: 'pending',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-3',
            date: new Date('2025-01-27T00:00:00.000Z'),
            status: 'failed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      // Should calculate from today, not from payment dates
      const today = new Date();
      const daysUntilMonday = (1 - today.getUTCDay() + 7) % 7 || 7;
      const expectedDate = new Date(today);
      expectedDate.setUTCDate(today.getUTCDate() + daysUntilMonday);
      expectedDate.setUTCHours(0, 0, 0, 0);
      expect(result.getTime()).toBe(expectedDate.getTime());
    });

    it('should find next occurrence when no payments and today is before target day', () => {
      // Mock today as Wednesday
      const mockDate = new Date('2025-01-15T12:00:00.000Z'); // Wednesday
      const originalDate = global.Date;
      global.Date = jest.fn((...args) => {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      });
      // Preserve static methods
      global.Date.UTC = originalDate.UTC;
      global.Date.now = originalDate.now;
      global.Date.prototype = originalDate.prototype;
      
      const goal = {
        schedule: { interval: 'Weekly', dayOfWeek: 'Friday' },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result.getUTCDay()).toBe(5); // Friday
      // Should be 2 days from Wednesday
      expect(result.getUTCDate()).toBe(17);
      
      global.Date = originalDate;
    });

    it('should find next week when no payments and today is target day', () => {
      // Mock today as Monday
      const mockDate = new Date('2025-01-13T12:00:00.000Z'); // Monday
      const originalDate = global.Date;
      global.Date = jest.fn((...args) => {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      });
      // Preserve static methods
      global.Date.UTC = originalDate.UTC;
      global.Date.now = originalDate.now;
      global.Date.prototype = originalDate.prototype;
      
      const goal = {
        schedule: { interval: 'Weekly', dayOfWeek: 'Monday' },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result.getUTCDay()).toBe(1); // Monday
      // Should be 7 days from today
      expect(result.getUTCDate()).toBe(20);
      
      global.Date = originalDate;
    });
  });

  describe('ShopifySavingsGoal vs ManualSavingsGoal', () => {
    it('should work for ShopifySavingsGoal', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        __t: 'ShopifySavingsGoal',
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should work for ManualSavingsGoal', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        __t: 'ManualSavingsGoal',
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });
  });

  describe('Edge cases', () => {
    it('should return null for invalid dayOfWeek', () => {
      const goal = {
        schedule: { interval: 'Weekly', dayOfWeek: 'InvalidDay' },
        isPaused: false,
        transfers: []
      };
      expect(calculateNextRunDate(goal)).toBeNull();
    });

    it('should return null when interval is neither Monthly nor Weekly', () => {
      const goal = {
        schedule: { interval: 'Daily' },
        isPaused: false,
        transfers: []
      };
      expect(calculateNextRunDate(goal)).toBeNull();
    });

    it('should handle empty transfers array', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: []
      };
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      // Should calculate from today
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should handle transfers with only pending/failed payments', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'pending',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-2',
            date: new Date('2025-02-15T00:00:00.000Z'),
            status: 'failed',
            type: 'debit',
            amount: 100
          }
        ]
      };
      // Should calculate from today, ignoring payment history
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should handle transfers with only credit (refund) payments', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'credit',
            amount: 50
          }
        ]
      };
      // Should calculate from today, ignoring payment history
      const result = calculateNextRunDate(goal);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });

    it('should handle mixed payment statuses correctly', () => {
      const today = new Date();
      const dayOfMonth = 15;
      const goal = {
        schedule: { interval: 'Monthly', dayOfMonth: dayOfMonth },
        isPaused: false,
        transfers: [
          {
            transferId: 'transfer-1',
            date: new Date('2025-01-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-2',
            date: new Date('2025-02-15T00:00:00.000Z'),
            status: 'pending',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-3',
            date: new Date('2025-03-15T00:00:00.000Z'),
            status: 'completed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-4',
            date: new Date('2025-04-15T00:00:00.000Z'),
            status: 'failed',
            type: 'debit',
            amount: 100
          },
          {
            transferId: 'transfer-5',
            date: new Date('2025-05-15T00:00:00.000Z'),
            status: 'completed',
            type: 'credit',
            amount: 50
          }
        ]
      };
      // Should calculate from today, ignoring all payment history
      const result = calculateNextRunDate(goal);
      expect(result.getUTCDate()).toBe(dayOfMonth);
      if (today.getUTCDate() <= dayOfMonth) {
        expect(result.getUTCMonth()).toBe(today.getUTCMonth());
      } else {
        expect(result.getUTCMonth()).toBe((today.getUTCMonth() + 1) % 12);
      }
    });
  });
});

