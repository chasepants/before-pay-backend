const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const ShopifyMerchant = require('../models/ShopifyMerchant');
const SavingsGoal = require('../models/SavingsGoal');
const { ShopifySavingsGoal, ManualSavingsGoal } = require('../models/SavingsGoal');
const PaymentAccount = require('../models/PaymentAccount');
const Payment = require('../models/Payment');
const SavingsGoalService = require('../services/savingsGoalService');

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGO_URI, { });
}

function todayPartsUTC(date = null) {
  const now = date ? new Date(date) : new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const dateObj = new Date(Date.UTC(y, m, d));
  const dayOfMonth = dateObj.getUTCDate();
  const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayOfWeek = daysOfWeek[dateObj.getUTCDay()];
  return { dayOfMonth, dayOfWeek };
}

/**
 * Check if a payment already exists for a goal on a given date
 * Uses Payment model as source of truth for idempotency
 * @param {ObjectId} goalId - SavingsGoal ID
 * @param {Date} date - Date to check
 * @param {String} paymentType - Payment type ('manual_installment' or 'shopify_installment')
 * @returns {Promise<Boolean>}
 */
async function hasExistingPayment(goalId, date, paymentType) {
  // If no date provided, use today
  const checkDate = date ? new Date(date) : new Date();
  const checkDateStart = new Date(Date.UTC(
    checkDate.getUTCFullYear(),
    checkDate.getUTCMonth(),
    checkDate.getUTCDate()
  ));
  
  const checkDateEnd = new Date(checkDateStart);
  checkDateEnd.setUTCHours(23, 59, 59, 999);

  // Check for existing payment on this date with same paymentType
  // Block on all statuses (including failed/canceled) - retries should be handled separately
  const existingPayment = await Payment.findOne({
    savingsGoalId: goalId,
    paymentType: paymentType,
    date: {
      $gte: checkDateStart,
      $lte: checkDateEnd
    }
  });

  return !!existingPayment;
}

/**
 * Process scheduled payments for all savings goals
 * Handles both manual savings goals and Shopify installments
 * @param {Date} date - Optional date to process (defaults to today)
 */
async function processScheduledPayments(date = null) {
  await connectDB();
  const { dayOfMonth, dayOfWeek } = todayPartsUTC(date);

  console.log(`Finding savings goals for ${dayOfMonth} ${dayOfWeek}`);

  // Find all goals matching today's schedule
  const savingsGoals = await SavingsGoal.find({
    $or: [
      { "schedule.dayOfMonth": dayOfMonth },
      { "schedule.dayOfWeek": dayOfWeek },
    ]
  }).sort({ _id: 1 });

  console.log(`Processing ${savingsGoals.length} savings goals`);

  const savingsGoalService = new SavingsGoalService();

  for (const goal of savingsGoals) {
    try {
      // Skip paused goals
      if (goal.isPaused) {
        console.log(`Skipping paused savings goal: ${goal.goalName}`);
        continue;
      }

      // Validate required fields
      const { savingsAmount, userId } = goal;
      
      // Get PaymentAccount to retrieve plaidProcessorToken
      if (!goal.paymentAccountId) {
        console.log(`Skipping goal ${goal._id}: no paymentAccountId`);
        continue;
      }
      
      const paymentAccount = await PaymentAccount.findById(goal.paymentAccountId);
      if (!paymentAccount || !paymentAccount.plaidProcessorToken) {
        console.log(`Skipping goal ${goal._id}: PaymentAccount not found or no plaidProcessorToken`);
        continue;
      }
      
      const plaidToken = paymentAccount.plaidProcessorToken;

      // Determine payment type based on goal type
      let paymentType;

      if (goal instanceof ShopifySavingsGoal) {
        // Shopify installment - use merchant account
        // Check if payment already exists for this date (idempotency check)
        if (await hasExistingPayment(goal._id, date, 'shopify_installment')) {
          console.log(`Payment already exists for Shopify goal: ${goal._id}`);
          continue;
        }

        const merchant = await ShopifyMerchant.findOne({ shopDomain: goal.shopDomain });
        if (!merchant) {
          console.warn(`Merchant not found for shopDomain: ${goal.shopDomain}`);
          continue;
        }

        if (!merchant.unitAccountId) {
          console.log(`Merchant onboarding not complete for shopDomain: ${goal.shopDomain}`);
          continue;
        }

        paymentType = 'shopify_installment';
      } else if (goal instanceof ManualSavingsGoal) {
        // Manual savings goal - use user account
        // Check if payment already exists for this date (idempotency check)
        if (await hasExistingPayment(goal._id, date, 'manual_installment')) {
          console.log(`Payment already exists for manual goal: ${goal._id}`);
          continue;
        }

        const user = await User.findById(userId);
        if (!user || !user.unitAccountId) {
          console.log(`User not found or no unitAccountId for goal: ${goal._id}`);
          continue;
        }

        paymentType = 'manual_installment';
      } else {
        console.log(`Unknown goal type for goal: ${goal._id}`);
        continue;
      }

      // Create payment using SavingsGoalService
      await savingsGoalService.createPaymentForGoal(goal, {
        direction: 'Debit',
        amount: parseFloat(savingsAmount),
        paymentType,
        plaidProcessorToken: plaidToken,
        description: 'Funding',
        tags: {
          savingsGoalId: goal._id.toString(),
          ...(userId ? { userId: userId.toString() } : {})
        }
      });

      console.log(`Created ${paymentType} payment for ${goal.goalName}`);
    } catch (err) {
      console.error(`Cron payment error for goal ${goal._id}:`, err?.message || err);
    }
  }
}

module.exports = { processScheduledPayments, hasExistingPayment };

