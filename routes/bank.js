const express = require('express');
const axios = require('axios');
const { Unit } = require('@unit-finance/unit-node-sdk');
const router = express.Router();
const SavingsGoal = require('../models/SavingsGoal');
const {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} = require('plaid');
require('dotenv').config();

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

router.post('/plaid-link-token', ensureAuthenticated, async (req, res) => {
  try {
    const response = await axios.post(`https://${process.env.PLAID_ENVIRONMENT}.plaid.com/link/token/create`, {
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      user: { client_user_id: req.user._id.toString() },
      client_name: 'Beforepay',
      products: ['auth', 'transactions'],
      country_codes: ['US'],
      language: 'en',
      webhook: 'https://your-webhook-url'
    });
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create Plaid link token' });
  }
});

// backend/routes/bank.js (partial update)
router.post('/setup-savings', ensureAuthenticated, async (req, res) => {
  const { savingsGoalId, plaidAccessToken, plaidAccountId, amount, schedule } = req.body;
  console.log('Request body:', req.body);

  // Validate required fields
  if (!savingsGoalId || !plaidAccountId || !amount || !schedule) {
    return res.status(400).json({ error: 'savingsGoalId, plaidAccountId, amount, and schedule are required' });
  }

  // Validate schedule
  const { startTime, interval } = schedule;
  if (!startTime || !interval) {
    return res.status(400).json({ error: 'startTime and interval are required' });
  }
  if (interval !== 'Weekly' && interval !== 'Monthly') {
    return res.status(400).json({ error: 'interval must be Weekly or Monthly' });
  }

  let dayOfWeek = false;
  let dayOfMonth = false;

  if ("Monthly" == interval) {
    const date = new Date(startTime);
    dayOfMonth = date.getDate();
  }

  if ("Weekly" == interval) {
    const date = new Date(startTime);
    date.setHours(date.getHours()+12); // const date was equal to 2025-08-11T00:00:00.000Z, for example, which is a Monday but was showing as a Sunday... I think because of UTC or time zones. Putting the date to 12 hours later helped get the correct day index.
    console.log(date);
    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    console.log(daysOfWeek);
    dayOfWeek = daysOfWeek[date.getDay()];
  }

  if (dayOfMonth && (isNaN(parseInt(dayOfMonth)) || parseInt(dayOfMonth) < -5 || parseInt(dayOfMonth) > 28 || (parseInt(dayOfMonth) > 0 && parseInt(dayOfMonth) < 1))) {
    return res.status(400).json({ error: 'dayOfMonth must be between 1-28 or -5 to -1' });
  }
  if (dayOfWeek && !['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(dayOfWeek)) {
    return res.status(400).json({ error: 'dayOfWeek must be a valid day (e.g., Monday)' });
  }

  try {
    var savingsGoal = await SavingsGoal.findById(savingsGoalId);
  } catch(error) {
    res.status(500).json({ error: 'We had an issue finding the savings item' })
  }

  if (!savingsGoal || savingsGoal.userId.toString() !== req.user._id.toString()) {
    return res.status(404).json({ error: 'Savings goal not found or unauthorized' });
  }

  let processorToken;
  const configuration = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENVIRONMENT],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
        'Plaid-Version': '2020-09-14',
      },
    },
  });

  const plaidClient = new PlaidApi(configuration);

  try {
    // Exchange the public_token from Plaid Link for an access token
    var tokenResponse = await plaidClient.itemPublicTokenExchange({
      public_token: plaidAccessToken,
    });
    console.log('Plaid token exchange response:', tokenResponse.data);
  } catch (error) {
    console.error('Setup savings error:', error.response?.data || error.message, error.stack);
    res.status(500).json({ error: 'Failed to set up savings plan: ' + (error.response?.data?.message || error.message) });
  }

  const accessToken = tokenResponse.data.access_token;
  console.log('Plaid access token:', accessToken);

  // Create a processor token for a specific account id
  const request = {
    access_token: accessToken,
    account_id: plaidAccountId,
    processor: 'unit',
  };

  try {
    var processorTokenResponse = await plaidClient.processorTokenCreate(request);
    console.log('Plaid processor token response:', processorTokenResponse.data);
  } catch (error) {
    console.error('Setup savings error:', error.response?.data || error.message, error.stack);
    res.status(500).json({ error: 'Failed to set up savings plan: ' + (error.response?.data?.message || error.message) });
  }

  processorToken = processorTokenResponse.data.processor_token;
  console.log('Plaid processor token:', processorToken);

  // update savings goal
  savingsGoal.savingsAmount = parseFloat(amount);
  savingsGoal.plaidToken = processorToken;
  savingsGoal.schedule = {
    interval, 
    startDate: startTime,
    dayOfMonth,
    dayOfWeek
  }
  savingsGoal.bank = {
    bankName: 'Unit Bank',
    bankLastFour: '****',
    bankAccountType: 'Unknown',
  }
  await savingsGoal.save();

  console.log(`Savings plan updated for goal ${savingsGoalId}`);

  res.json({ success: true });
});

router.get('/transaction-history/:savingsGoalId', ensureAuthenticated, async (req, res) => {
  const { savingsGoalId } = req.params;
  try {
    const savingsGoal = await SavingsGoal.findById(savingsGoalId);
    if (!savingsGoal) return res.status(404).json({ error: 'Savings goal not found' });
    const transactions = savingsGoal.transfers.map(transfer => ({
      date: transfer.date.getTime() / 1000,
      amount: transfer.amount,
      status: transfer.status,
      type: transfer.type
    }));
    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/payout', ensureAuthenticated, async (req, res) => {
  const { savingsGoalId } = req.body;
  try {
    const savingsGoal = await SavingsGoal.findById(savingsGoalId);
    if (!savingsGoal || savingsGoal.userId.toString() !== req.user._id || user.status !== 'approved') {
      return res.status(403).json({ error: 'Unauthorized or not approved' });
    }

    const pendingDebits = savingsGoal.transfers.filter(t => t.type === 'debit' && t.status === 'pending');
    const completedDebits = savingsGoal.transfers.filter(t => t.type === 'debit' && t.status === 'completed');
    const refundAmount = completedDebits.reduce((sum, t) => sum + t.amount, 0);
    let canceledAmount = 0;

    for (const transfer of pendingDebits) {
      await unit.transfers.cancel({ transferId: transfer.transferId });
      transfer.status = 'cancelled';
      canceledAmount += transfer.amount;
    }
    await savingsGoal.save();

    let transferId = null;
    if (refundAmount > 0) {
      const transfer = await unit.transfers.create({
        sourceAccountId: process.env.UNIT_FUNDING_SOURCE_ID,
        destinationAccountId: savingsGoal.fundingSourceId,
        amount: refundAmount,
        metadata: { savingsGoalId }
      });
      transferId = transfer.data.id;
      savingsGoal.transfers.push({
        transferId,
        amount: -refundAmount,
        date: new Date(),
        status: 'pending',
        type: 'credit'
      });
      completedDebits.forEach(transfer => { transfer.status = 'refunded'; });
      savingsGoal.currentAmount -= (refundAmount + canceledAmount);
    } else {
      savingsGoal.currentAmount -= canceledAmount;
    }
    await savingsGoal.save();

    res.json({ success: true, transferId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
