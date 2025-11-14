/**
 * Calculate next run date based on schedule
 * Since there's no retry logic for failed payments, the next run date is simply
 * the next occurrence of the schedule from today, regardless of payment history.
 * @param {Object} goal - SavingsGoal instance (can be ShopifySavingsGoal or ManualSavingsGoal)
 * @returns {Date|null} Next run date in UTC, or null if not applicable
 */
function calculateNextRunDate(goal) {
  if (!goal.schedule || !goal.schedule.interval || goal.isPaused) {
    return null;
  }

  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  if (goal.schedule.interval === 'Monthly' && goal.schedule.dayOfMonth) {
    const nextDate = new Date(todayUTC);
    if (goal.schedule.dayOfMonth > todayUTC.getUTCDate()) {
      // This month's occurrence hasn't passed yet
      nextDate.setUTCDate(goal.schedule.dayOfMonth);
    } else {
      // This month's occurrence has passed (or is today), use next month
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
      nextDate.setUTCDate(goal.schedule.dayOfMonth);
    }
    nextDate.setUTCHours(0, 0, 0, 0);
    return nextDate;
  }

  if (goal.schedule.interval === 'Weekly' && goal.schedule.dayOfWeek) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const targetDayIndex = days.indexOf(goal.schedule.dayOfWeek);
    
    if (targetDayIndex === -1) {
      return null; // Invalid day of week
    }
    
    const nextDate = new Date(todayUTC);
    const currentDayIndex = nextDate.getUTCDay();
    let daysUntilNext = (targetDayIndex - currentDayIndex + 7) % 7;
    if (daysUntilNext === 0) daysUntilNext = 7; // If today is the target day, use next week
    nextDate.setUTCDate(nextDate.getUTCDate() + daysUntilNext);
    nextDate.setUTCHours(0, 0, 0, 0);
    return nextDate;
  }

  return null;
}

module.exports = { calculateNextRunDate };

