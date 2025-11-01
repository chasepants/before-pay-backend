const mongoose = require('mongoose');
const { Unit } = require('@unit-finance/unit-node-sdk');
require('dotenv').config();
const ShopifyMerchant = require('../models/ShopifyMerchant');
const SavingsGoal = require('../models/SavingsGoal');

const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

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

async function processScheduledInstallments(date = null) {
  await connectDB();
  const { dayOfMonth, dayOfWeek } = todayPartsUTC(date);

  console.log(`Finding installments for ${dayOfMonth} ${dayOfWeek}`);

  const savingsGoals = await SavingsGoal.find({
    "product.type": "Shopify",
    $or: [
      { "schedule.dayOfMonth": dayOfMonth },
      { "schedule.dayOfWeek": dayOfWeek }
    ]
  }).sort({ _id: 1 });

  console.log(`Processing ${savingsGoals.length} savings goals`);

  for (const goal of savingsGoals) {
    try {
      if (goal.isPaused) {
        console.log(`Skipping paused savings goal: ${goal.goalName}`);
        continue;
      }

      if (hasProcessInstallment(goal, date)) {
        console.log(`Installment already processed for goal: ${goal._id}`);
        continue;
      }

      const { savingsAmount, plaidToken, userId } = goal;

      const merchant = await ShopifyMerchant.findOne({ shopifyShopId: "stashpay-2" });

      const achPaymentRequest = {
        type: 'achPayment',
        attributes: {
          amount: parseFloat(savingsAmount) * 100,
          direction: 'Debit',
          description: 'Funding',
          plaidProcessorToken: plaidToken,
          tags: { savingsGoalId: goal._id, userId: userId }
        },
        relationships: {
          account: { data: { type: 'account', id: merchant.unitAccountId } }
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

      console.log(`Created payment for ${goal.goalName}`);
    } catch (err) {
      console.log(err);
      console.error('Cron payment error:', err?.message || err);
    }
  }
}

function hasProcessInstallment(goal, date) {
  if (!goal.transfers || goal.transfers.length === 0) {
    return false;
  }

  if (!date) {
    console.warn('No date given to hasProcessedInstallment');
    return false;
  }

  const checkDate = new Date(date);

  const checkDateStart = new Date(Date.UTC(
    checkDate.getUTCFullYear(),
    checkDate.getUTCMonth(),
    checkDate.getUTCDate()
  ));
  
  const checkDateEnd = new Date(checkDateStart);
  checkDateEnd.setUTCHours(23, 59, 59, 999);

  const hasTransferToday = goal.transfers.some(transfer => {
    const transferDate = new Date(transfer.date);
    return transferDate >= checkDateStart && transferDate <= checkDateEnd && transfer.status !== "failed";
  });

  return hasTransferToday;
}

module.exports = { processScheduledInstallments, hasProcessInstallment };
