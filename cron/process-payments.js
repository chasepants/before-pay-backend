// before-pay-backend/cron/process-payments.js
const mongoose = require('mongoose');
const { Unit } = require('@unit-finance/unit-node-sdk');
require('dotenv').config();
const User = require('../models/User');
const SavingsGoal = require('../models/SavingsGoal');

const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGO_URI, { });
}

function todayPartsUTC() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const date = new Date(Date.UTC(y, m, d));
  const dayOfMonth = date.getUTCDate();
  const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayOfWeek = daysOfWeek[date.getUTCDay()];
  return { dayOfMonth, dayOfWeek };
}

async function processScheduledPayments() {
  await connectDB();
  const { dayOfMonth, dayOfWeek } = todayPartsUTC();

  const savingsGoals = await SavingsGoal.find({
    $or: [
      { "schedule.dayOfMonth": dayOfMonth },
      { "schedule.dayOfWeek": dayOfWeek }
    ]
  });

  for (const goal of savingsGoals) {
    try {
      const { savingsAmount, plaidToken, userId } = goal;
      const user = await User.findById(userId);
      if (!user || !user.unitAccountId) continue;

      const achPaymentRequest = {
        type: 'achPayment',
        attributes: {
          amount: parseFloat(savingsAmount) * 100,
          direction: 'Debit',
          description: 'Funding',
          plaidProcessorToken: plaidToken,
          tags: { savingsGoalId: goal._id }
        },
        relationships: {
          account: { data: { type: 'account', id: user.unitAccountId } }
        }
      };

      const achPayment = await unit.payments.create(achPaymentRequest);

      goal.transfers.push({
        transferId: achPayment.data.id,
        amount: parseFloat(savingsAmount),
        date: new Date(),
        status: 'pending',
        type: 'debit'
      });

      await goal.save();
    } catch (err) {
      console.error('Cron payment error:', err?.message || err);
    }
  }
}

module.exports = { processScheduledPayments };
