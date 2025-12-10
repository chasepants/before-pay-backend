const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const SavingsGoal = require('../models/SavingsGoal');
const { ShopifySavingsGoal, ManualSavingsGoal } = require('../models/SavingsGoal');
const emailService = require('../services/emailService');

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGO_URI, { });
}

function tomorrowPartsUTC(date = null) {
  const now = date ? new Date(date) : new Date();
  // Get tomorrow's date
  // Note: setUTCDate() automatically handles month/year rollover (e.g., Jan 31 -> Feb 1, Dec 31 -> Jan 1)
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  
  const y = tomorrow.getUTCFullYear();
  const m = tomorrow.getUTCMonth();
  const d = tomorrow.getUTCDate();
  const dateObj = new Date(Date.UTC(y, m, d));
  const dayOfMonth = dateObj.getUTCDate();
  const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayOfWeek = daysOfWeek[dateObj.getUTCDay()];
  return { dayOfMonth, dayOfWeek, date: dateObj };
}

/**
 * Send payment reminder emails for savings goals that will be processed tomorrow
 * @param {Date} date - Optional date to check (defaults to today, finds goals for tomorrow)
 */
async function sendPaymentReminders(date = null) {
  await connectDB();
  const { dayOfMonth, dayOfWeek, date: tomorrowDate } = tomorrowPartsUTC(date);

  console.log(`Finding savings goals scheduled for tomorrow (${dayOfMonth} ${dayOfWeek})`);

  // Find all goals matching tomorrow's schedule
  const savingsGoals = await SavingsGoal.find({
    $or: [
      { "schedule.dayOfMonth": dayOfMonth },
      { "schedule.dayOfWeek": dayOfWeek },
    ],
    isPaused: false // Only send reminders for active goals
  }).sort({ _id: 1 });

  console.log(`Found ${savingsGoals.length} savings goals scheduled for tomorrow`);

  let sentCount = 0;
  let errorCount = 0;

  for (const goal of savingsGoals) {
    try {
      // Skip if no savings amount
      if (!goal.savingsAmount || goal.savingsAmount <= 0) {
        console.log(`Skipping goal ${goal._id}: no savingsAmount`);
        continue;
      }

      // Get user email
      let userEmail = null;
      
      // Try to get email from User model if userId exists
      if (goal.userId) {
        const user = await User.findById(goal.userId);
        if (user && user.email) {
          userEmail = user.email;
        }
      }
      
      // Fall back to guestEmail if no user email found
      if (!userEmail && goal.guestEmail) {
        userEmail = goal.guestEmail;
      }

      // Skip if no email available
      if (!userEmail) {
        console.log(`Skipping goal ${goal._id}: no email found`);
        continue;
      }

      // Format payment amount as currency
      const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(goal.savingsAmount);

      // Format tomorrow's date
      const formattedDate = tomorrowDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Send reminder email
      const result = await emailService.sendPaymentReminderEmail(
        userEmail,
        formattedAmount,
        formattedDate
      );

      if (result.success) {
        console.log(`Payment reminder sent to ${userEmail} for goal ${goal._id}`);
        sentCount++;
      } else {
        console.error(`Failed to send reminder to ${userEmail} for goal ${goal._id}:`, result.error);
        errorCount++;
      }
    } catch (err) {
      console.error(`Error sending payment reminder for goal ${goal._id}:`, err?.message || err);
      errorCount++;
    }
  }

  console.log(`Payment reminder processing completed. Sent: ${sentCount}, Errors: ${errorCount}`);
}

module.exports = { sendPaymentReminders };

