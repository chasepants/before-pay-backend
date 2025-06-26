// backend/routes/bank.js (partial update)
const express = require('express');
const axios = require('axios');
const { Unit } = require('@unit-finance/unit-node-sdk');
const router = express.Router();
const User = require('../models/User');
const SavingsGoal = require('../models/SavingsGoal');
const {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  ProcessorTokenCreateRequest,
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

router.get('/counterparties/:userId', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const counterparties = await unit.counterparties.list({ customerId: user.unitCustomerId });
    res.json({ counterparties: counterparties.data.map(cp => ({
      id: cp.id,
      name: cp.attributes.name,
      mask: cp.attributes.accountNumber ? `****${cp.attributes.accountNumber.slice(-4)}` : '****'
    })) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch counterparties' });
  }
});

// backend/routes/bank.js (partial update)
router.post('/setup-savings', ensureAuthenticated, async (req, res) => {
  const { savingsGoalId, plaidAccessToken, plaidAccountId, amount, schedule } = req.body;
  console.log('Request body:', req.body);
  try {
    // Validate required fields
    if (!savingsGoalId || !plaidAccountId || !amount || !schedule) {
      return res.status(400).json({ error: 'savingsGoalId, plaidAccountId, amount, and schedule are required' });
    }

    const savingsGoal = await SavingsGoal.findById(savingsGoalId);
    console.log('SavingsGoal userId:', savingsGoal.userId.toString());
    console.log('Request userId:', req.user._id);
    console.log('SavingsGoal:', savingsGoal);
    if (!savingsGoal || savingsGoal.userId.toString() !== req.user._id.toString()) {
      return res.status(404).json({ error: 'Savings goal not found or unauthorized' });
    }

    let counterparty;
    if (plaidAccessToken) {
      // New account linking
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

      // Exchange the public_token from Plaid Link for an access token
      const tokenResponse = await plaidClient.itemPublicTokenExchange({
        public_token: plaidAccessToken,
      });
      console.log('Plaid token exchange response:', tokenResponse.data);

      const accessToken = tokenResponse.data.access_token;
      console.log('Plaid access token:', accessToken);

      // Create a processor token for a specific account id
      const request = {
        access_token: accessToken,
        account_id: plaidAccountId,
        processor: 'unit',
      };

      const processorTokenResponse = await plaidClient.processorTokenCreate(request);
      console.log('Plaid processor token response:', processorTokenResponse.data);

      const processorToken = processorTokenResponse.data.processor_token;
      console.log('Plaid processor token:', processorToken);

      counterparty = await unit.counterparties.create({
        type: 'achCounterparty',
        attributes: {
          name: `${req.user.firstName} ${req.user.lastName}`,
          plaidProcessorToken: processorToken,
          type: 'Person',
          permissions: 'DebitOnly'
        },
        relationships: {
          customer: {
            data: {
              type: 'customer',
              id: req.user.unitCustomerId
            }
          }
        }
      });
      console.log(`Counterparty created:`, counterparty.data.id);
    } else {
      // Use existing account (plaidAccountId is assumed to be the counterparty ID for existing accounts)
      console.log(`Searching for counterparty using id ${plaidAccountId}`);
      counterparty = await unit.counterparties.get(plaidAccountId);
      if (!counterparty.data || counterparty.data.relationships.customer.data.id !== req.user.unitCustomerId) {
        console.log(`Did not find counterparty using id ${plaidAccountId}`);
        return res.status(400).json({ error: 'Invalid or unauthorized existing account' });
      }
      console.log(`Using existing counterparty:`, counterparty.data.id);
    }

    // Validate schedule
    const { startTime, endTime, interval, dayOfMonth, dayOfWeek, totalNumberOfPayments } = schedule;
    if (!startTime || !interval) {
      return res.status(400).json({ error: 'startTime and interval are required' });
    }
    if (interval !== 'Weekly' && interval !== 'Monthly') {
      return res.status(400).json({ error: 'interval must be Weekly or Monthly' });
    }
    if (interval === 'Monthly' && !dayOfMonth) {
      return res.status(400).json({ error: 'dayOfMonth is required for Monthly interval' });
    }
    if (interval === 'Weekly' && !dayOfWeek) {
      return res.status(400).json({ error: 'dayOfWeek is required for Weekly interval' });
    }
    if (dayOfMonth && (isNaN(parseInt(dayOfMonth)) || parseInt(dayOfMonth) < -5 || parseInt(dayOfMonth) > 28 || (parseInt(dayOfMonth) > 0 && parseInt(dayOfMonth) < 1))) {
      return res.status(400).json({ error: 'dayOfMonth must be between 1-28 or -5 to -1' });
    }
    if (dayOfWeek && !['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(dayOfWeek)) {
      return res.status(400).json({ error: 'dayOfWeek must be a valid day (e.g., Monday)' });
    }
    if (totalNumberOfPayments && (isNaN(parseInt(totalNumberOfPayments)) || parseInt(totalNumberOfPayments) <= 0)) {
      return res.status(400).json({ error: 'totalNumberOfPayments must be a positive integer' });
    }

    const user = await User.findById(req.user._id);
    const unitAccountId = user.unitAccountId;
    if (!unitAccountId) {
      console.log('Could not find unitAccountId');
      return res.status(500).json({ error: 'Failed to set up savings plan: Unit account ID not found' });
    }

    // Construct dynamic recurring payment request
    const recurringPaymentRequest = {
      type: 'recurringDebitAchPayment',
      attributes: {
        amount: parseFloat(amount) * 100, // Convert to cents
        description: `BeforePay`,
        schedule: {
          startTime,
          endTime: endTime || undefined,
          interval,
          ...(interval === 'Monthly' && { dayOfMonth: parseInt(dayOfMonth) }),
          ...(interval === 'Weekly' && { dayOfWeek }),
          totalNumberOfPayments: totalNumberOfPayments ? parseInt(totalNumberOfPayments) : undefined
        },
        verifyCounterpartyBalance: true,
        idempotencyKey: `${req.user.email}-recurring-${Date.now()}`
      },
      relationships: {
        account: {
          data: {
            type: 'depositAccount',
            id: unitAccountId
          }
        },
        counterparty: {
          data: {
            type: 'counterparty',
            id: counterparty.data.id
          }
        }
      }
    };

    console.log('Recurring payment request:', recurringPaymentRequest);
    const recurringPayment = await unit.recurringPayments.create(recurringPaymentRequest);
    console.log('Recurring ACH payment created:', recurringPayment.data.id);

    // Update SavingsGoal with savings plan details
    savingsGoal.savingsAmount = parseFloat(amount);
    savingsGoal.savingsFrequency = interval; // Updated to reflect new interval
    savingsGoal.savingsStartDate = startTime; // Updated to reflect new startTime
    savingsGoal.externalAccountId = counterparty.data.id;
    savingsGoal.bankName = counterparty.data.attributes.bank || 'Unit Bank';
    savingsGoal.bankLastFour = counterparty.data.attributes.accountNumber ? `****${counterparty.data.attributes.accountNumber.slice(-4)}` : '****';
    savingsGoal.bankAccountType = counterparty.data.attributes.accountType || 'Unknown';
    savingsGoal.nextRunnable = recurringPayment.data.attributes.schedule.nextScheduledAction;
    await savingsGoal.save();
    console.log(`Savings plan updated for goal ${savingsGoalId}`);

    res.json({ success: true, recurringPaymentId: recurringPayment.data.id });
  } catch (error) {
    console.error('Setup savings error:', error.response?.data || error.message, error.stack);
    res.status(500).json({ error: 'Failed to set up savings plan: ' + (error.response?.data?.message || error.message) });
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

module.exports = router;
