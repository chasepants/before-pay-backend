require('dotenv').config();

const express = require('express');
const axios = require('axios');
const router = express.Router();
const SavingsGoal = require('../models/SavingsGoal');
const { v4: uuid } = require('uuid');
const PlaidService = require('../services/plaidService');
const { ensureAuthenticated } = require('../middleware/auth');
const GuestSession = require('../models/GuestSession');
const EmailToken = require('../models/EmailToken');
const SavingsGoalService = require('../services/savingsGoalService');

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

/**
 * Batch transfer back to bank accounts
 * POST /api/bank/transfers/batch
 */
router.post('/transfers/batch', ensureAuthenticated, async (req, res) => {
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

    const batchId = uuid();
    const savingsGoalService = new SavingsGoalService();

    // Delegate batch transfer logic to SavingsGoalService (including finding destPlaidToken and unitAccountId)
    const result = await savingsGoalService.createBatchTransfer({
      totalAmount: total,
      allocations,
      goals,
      goalsById,
      batchId
    });

    return res.json(result);
  } catch (e) {
    console.error('transfer-back-batch error:', e);
    return res.status(500).json({ error: 'Failed to process transfer back' });
  }
});

module.exports = router;
