require('dotenv').config();

const express = require('express');
const axios = require('axios');
const router = express.Router();
const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const UnitService = require('../services/unitService');
const PlaidService = require('../services/plaidService');
const { ensureAuthenticated } = require('../middleware/auth');

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

// Plaid routes for guest users
const GuestSession = require('../models/GuestSession');

/**
 * Connect Plaid account for guest users
 * POST /api/bank/plaid/connect
 */
router.post('/plaid/connect', async (req, res) => {
  try {
    const { guestToken, emailToken, publicToken, accountId } = req.body;
    
    if (!guestToken && !emailToken) {
      return res.status(400).json({ error: 'Either guest token or email token is required' });
    }

    let guestSession;

    const EmailToken = require('../models/EmailToken');
    const emailTokenDoc = await EmailToken.findOne({ 
      token: emailToken, 
      expiresAt: { $gt: new Date() }
    });
    
    if (!emailTokenDoc) {
      return res.status(401).json({ error: 'Invalid or expired email token' });
    }

    guestSession = await GuestSession.findOne({ email: emailTokenDoc.email });
    if (!guestSession) {
      guestSession = new GuestSession({
        email: emailTokenDoc.email,
        guestToken: require('crypto').randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });
      await guestSession.save();
    }

    if (publicToken) {
      try {
        const plaidService = new PlaidService();
        const exchangeResp = await plaidService.exchangePublicToken(publicToken);
        guestSession.plaidToken = exchangeResp.data.access_token;

        if (accountId) guestSession.plaidAccountId = accountId;
      } catch (ex) {
        console.error('Plaid exchange failed:', ex.message);
        return res.status(500).json({ error: 'Failed to exchange Plaid token' });
      }
    } else {
      return res.status(400).json({ error: 'Plaid token is required' });
    }
    await guestSession.save();
    
    res.status(200).json({
      success: true,
      accessToken: guestSession.plaidToken,
      message: 'Plaid account connected successfully'
    });
  } catch (error) {
    console.error('Error connecting Plaid:', error);
    res.status(500).json({ error: 'Failed to connect Plaid account' });
  }
});

/**
 * Create Plaid link token for guest users
 * POST /api/bank/plaid/link-token
 */
router.post('/plaid/link-token', async (req, res) => {
  try {
    const { guestToken, emailToken } = req.body;
    
    if (!guestToken && !emailToken) {
      return res.status(400).json({ error: 'Either guest token or email token is required' });
    }

    let userId;
    let clientName = 'StashPay';

    if (guestToken) {
      const guestSession = await GuestSession.findOne({ guestToken });
      if (!guestSession) {
        return res.status(401).json({ error: 'Invalid or expired guest session' });
      }
      if (new Date() > guestSession.expiresAt) {
        await GuestSession.deleteOne({ _id: guestSession._id });
        return res.status(401).json({ error: 'Guest session expired' });
      }
      userId = guestSession._id;
      clientName = 'StashPay Guest Checkout';
    } else if (emailToken) {
      const EmailToken = require('../models/EmailToken');
      const emailTokenDoc = await EmailToken.findOne({ 
        token: emailToken,
        expiresAt: { $gt: new Date() }
      });
      
      if (!emailTokenDoc) {
        return res.status(401).json({ error: 'Invalid or expired email token' });
      }
      
      userId = emailToken;
      clientName = 'StashPay Savings Plan';
    }

    try {
      const plaidService = new PlaidService();
      const linkTokenResponse = await plaidService.createLinkToken(userId, clientName);
      
      return res.status(200).json({
        success: true,
        linkToken: linkTokenResponse.data.link_token,
        expiration: linkTokenResponse.data.expiration
      });
    } catch (e) {
      console.error('Plaid link token creation error:', e.message);
      console.error('Plaid error details:', e.response?.data || e);
      return res.status(500).json({ 
        error: `Failed to create Plaid link token: ${e.message}`,
        details: e.response?.data || 'No additional details available'
      });
    }
  } catch (e) {
    console.error('Plaid link token error:', e.message);
    return res.status(500).json({ error: 'Failed to create Plaid link token' });
  }
});

router.post('/setup-savings', ensureAuthenticated, async (req, res) => {
  const { savingsGoalId, plaidAccessToken, plaidAccountId, amount, schedule } = req.body;
  console.log('Request body:', req.body);

  // Need to make sure user in tokne is allowed ot update this savings goal
  if (!savingsGoalId || !plaidAccountId || !amount || !schedule) {
    return res.status(400).json({ error: 'savingsGoalId, plaidAccountId, amount, and schedule are required' });
  }

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

  const plaidService = new PlaidService();

  try {
    var tokenResponse = await plaidService.exchangePublicToken(plaidAccessToken);
    console.log('Plaid token exchange response:', tokenResponse.data);
  } catch (error) {
    console.error('Setup savings error:', error.response?.data || error.message, error.stack);
    res.status(500).json({ error: 'Failed to set up savings plan: ' + (error.response?.data?.message || error.message) });
    return;
  }

  const accessToken = tokenResponse.data.access_token;
  console.log('Plaid access token:', accessToken);

  try {
    var processorTokenResponse = await plaidService.createProcessorToken(accessToken, plaidAccountId);
    console.log('Plaid processor token response:', processorTokenResponse.data);
  } catch (error) {
    console.error('Setup savings error:', error.response?.data || error.message, error.stack);
    res.status(500).json({ error: 'Failed to set up savings plan: ' + (error.response?.data?.message || error.message) });
    return;
  }

  let processorToken = processorTokenResponse.data.processor_token;
  console.log('Plaid processor token:', processorToken);

  savingsGoal.savingsAmount = parseFloat(amount);

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
    plaidToken: processorToken
  }
  await savingsGoal.save();

  console.log(`Savings plan updated for goal ${savingsGoalId}`);

  res.json({ success: true });
});

router.get('/transaction-history/:savingsGoalId', ensureAuthenticated, async (req, res) => {
  const { savingsGoalId } = req.params;
  // TODO:  need to make sure user in token is allowed to see this information.
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

router.post('/transfer-back-batch', ensureAuthenticated, async (req, res) => {
  try {
    const { totalAmount, allocations } = req.body; // allocations: [{ savingsGoalId, amount }]
    const total = Math.round(Number(totalAmount || 0));
    
    if (!total || total <= 0) return res.status(400).json({ error: 'Invalid totalAmount' });
    
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return res.status(400).json({ error: 'No allocations provided' });
    }

    const goals = await SavingsGoal.find({ _id: { $in: allocations.map(a => a.savingsGoalId) }, userId: req.user._id });
    
    const goalsById = new Map(goals.map(g => [String(g._id), g]));
    
    const sumAlloc = allocations.reduce((s, a) => s + Math.round(Number(a.amount || 0)), 0);
    
    if (sumAlloc !== total) return res.status(400).json({ error: 'Allocations must sum to totalAmount' });

    // Validate per-goal limits
    for (const a of allocations) {

      const g = goalsById.get(a.savingsGoalId);
      if (!g) return res.status(400).json({ error: 'Goal not found: ' + a.savingsGoalId });
      const amt = Math.round(Number(a.amount || 0));
      if (amt < 0 || amt > Math.round(Number(g.currentAmount || 0))) {
        return res.status(400).json({ error: `Invalid allocation for goal ${a.savingsGoalId}` });
      }
    }

    // Choose destination bank (plaid token) – use first goal that has one, or require client param
    const destPlaidToken = goals.find(g => !!g.bank?.plaidToken)?.bank?.plaidToken;
    if (!destPlaidToken) return res.status(400).json({ error: 'No destination bank found for transfer back' });
    if (!req.user.unitAccountId) return res.status(400).json({ error: 'No Unit account on user' });

    const batchId = uuid();

    const unitService = new UnitService();
    const ach = await unitService.createPayment({
      type: 'achPayment',
      attributes: {
        amount: total * 100,
        direction: 'Credit',
        description: 'Transfer Back',
        plaidProcessorToken: destPlaidToken,
        tags: { kind: 'transferBackBatch', batchId }
      },
      relationships: {
        account: { data: { type: 'account', id: req.user.unitAccountId } }
      }
    });

    // Record pending allocation entries across goals (link by batchId + same paymentId)
    const now = new Date();
    for (const a of allocations) {
      const g = goalsById.get(a.savingsGoalId);
      g.transfers.push({
        transferId: ach.data.id,
        batchId,
        amount: Number(a.amount),
        date: now,
        status: 'pending',
        type: 'credit'
      });
      await g.save();
    }

    return res.json({ paymentId: ach.data.id, batchId, processed: allocations.length });
  } catch (e) {
    console.error('transfer-back-batch error:', e);
    return res.status(500).json({ error: 'Failed to process transfer back' });
  }
});

module.exports = router;
