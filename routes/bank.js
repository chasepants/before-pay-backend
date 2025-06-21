const express = require('express');
const axios = require('axios');
const { Unit } = require('@unit-finance/unit-node-sdk');
const router = express.Router();
const User = require('../models/User');
const SavingsGoal = require('../models/SavingsGoal');
require('dotenv').config();

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

router.post('/setup-savings', ensureAuthenticated, async (req, res) => {
  const { savingsGoalId, plaidAccessToken, plaidAccountId, amount, frequency, start_date } = req.body;
  try {
    if (!savingsGoalId || !plaidAccountId || !amount || !frequency || !start_date) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const user = await User.findById(req.user._id);
    const savingsGoal = await SavingsGoal.findById(savingsGoalId);
    if (!user || !savingsGoal || user.status !== 'approved') {
      return res.status(403).json({ error: 'Not approved or not found' });
    }

    let fundingSourceId = plaidAccountId;
    if (plaidAccessToken) {
      const tokenResponse = await axios.post(`https://${process.env.PLAID_ENVIRONMENT}.plaid.com/item/public_token/exchange`, {
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        public_token: plaidAccessToken
      });
      const accessToken = tokenResponse.data.access_token;

      const fundingSource = await unit.accounts.createFundingSource({
        accountId: user.unitAccountId,
        plaid: { accessToken, accountId: plaidAccountId }
      });
      fundingSourceId = fundingSource.data.id;
    }

    savingsGoal.fundingSourceId = fundingSourceId;
    savingsGoal.savingsAmount = parseFloat(amount);
    savingsGoal.savingsFrequency = frequency;
    savingsGoal.savingsStartDate = new Date(start_date);
    savingsGoal.bankName = "Unit Bank"; // Placeholder
    savingsGoal.bankAccountName = "My Savings Account"; // Placeholder
    await savingsGoal.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

router.post('/plaid-link-token', ensureAuthenticated, async (req, res) => {
  try {
    const response = await axios.post(`https://${process.env.PLAID_ENVIRONMENT}.plaid.com/link/token/create`, {
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      user: { client_user_id: req.user._id.toString() },
      client_name: 'Beforepay',
      products: ['auth'],
      country_codes: ['US'],
      language: 'en',
      webhook: 'https://your-webhook-url'
    });
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create Plaid link token' });
  }
});

router.get('/funding-sources/:dwollaCustomerId', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.dwollaCustomerId !== req.params.dwollaCustomerId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const fundingSources = await unit.accounts.listFundingSources({ accountId: user.unitAccountId });
    res.json({ fundingSources: fundingSources.data.map(fs => ({
      id: fs.id,
      name: fs.name || 'Unnamed Account',
      mask: fs.mask || '****',
      bankName: fs.bankName || 'Unit Bank'
    })) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch funding sources' });
  }
});

module.exports = router;