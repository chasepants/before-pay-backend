const express = require('express');
const axios = require('axios');
const dwolla = require('dwolla-v2');
const router = express.Router();
const User = require('../models/User');
const WishlistItem = require('../models/WishlistItem');
const {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  ProcessorTokenCreateRequest,
} = require('plaid');

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

const dwollaClient = new dwolla.Client({
  key: process.env.DWOLLA_KEY,
  secret: process.env.DWOLLA_SECRET,
  environment: process.env.DWOLLA_ENVIRONMENT
});

// backend/routes/bank.js (partial update)
router.post('/setup-savings', ensureAuthenticated, async (req, res) => {
  const { wishlistItemId, plaidAccessToken, plaidAccountId, amount, frequency, start_date } = req.body;
  console.log('Request body:', req.body);
  try {
    if (!wishlistItemId || !plaidAccountId || !amount || !frequency || !start_date) {
      return res.status(400).json({ error: 'Wishlist item ID, account ID, amount, frequency, and start date required' });
    }
    const user = await User.findById(req.user._id);
    const wishlistItem = await WishlistItem.findById(wishlistItemId);
    if (!user || !wishlistItem) {
      return res.status(404).json({ error: 'User or wishlist item not found' });
    }

    // Check if the plaidAccountId matches an existing fundingSourceId
    let fundingSourceId = plaidAccountId;
    let isNewAccount = !!plaidAccessToken; // True if a new Plaid token is provided

    if (isNewAccount) {
      // Create Dwolla customer if not exists
      let dwollaCustomerId = user.dwollaCustomerId;
      if (!dwollaCustomerId) {
        if (!user.dateOfBirth) {
          return res.status(400).json({ error: 'Date of birth required for account setup' });
        }
        const stateCode = user.address?.state || 'CA';
        const customerResponse = await dwollaClient.post('customers', {
          firstName: user.name.split(' ')[0] || 'User',
          lastName: user.name.split(' ')[1] || 'Name',
          email: user.email,
          type: 'personal',
          address1: user.address?.line1 || '123 Main St',
          city: user.address?.city || 'San Francisco',
          state: stateCode,
          postalCode: user.address?.postal_code || '94105',
          ssn: user.ssnLast4 || '6789',
          dateOfBirth: user.dateOfBirth
        });
        dwollaCustomerId = customerResponse.headers.get('location').split('/').pop();
        user.dwollaCustomerId = dwollaCustomerId;
        await user.save();
        console.log('Created Dwolla customer:', dwollaCustomerId);
      }

      // GET PLAID PROCESSOR TOKEN
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
        processor: 'dwolla',
      };

      const processorTokenResponse = await plaidClient.processorTokenCreate(request);
      console.log('Plaid processor token response:', processorTokenResponse.data);

      const processorToken = processorTokenResponse.data.processor_token;
      console.log('Plaid processor token:', processorToken);

      // Link bank account as a funding source
      const fundingSourceResponse = await dwollaClient.post(`customers/${dwollaCustomerId}/funding-sources`, {
        plaidToken: processorToken,
        name: 'Savings Account'
      });
      console.log('Dwolla funding source response:', fundingSourceResponse.body);

      fundingSourceId = fundingSourceResponse.headers.get('location').split('/').pop();
    } else {
      console.log('Reusing existing funding source:', fundingSourceId);
      // Verify the funding source exists (optional, for safety)
      const fundingSourceResponse = await dwollaClient.get(`funding-sources/${fundingSourceId}`);
      if (!fundingSourceResponse.body) {
        throw new Error('Existing funding source not found');
      }
    }

    wishlistItem.fundingSourceId = fundingSourceId;
    wishlistItem.savingsAmount = parseFloat(amount);
    wishlistItem.savingsFrequency = frequency;
    wishlistItem.savingsStartDate = start_date;
    wishlistItem.bankName = "Chase Bank";
    wishlistItem.bankAccountName = "My Test Account";
    wishlistItem.nextRunnable = new Date(start_date);

    await wishlistItem.save();
    console.log('Linked funding source:', fundingSourceId);

    res.json({ success: true });
  } catch (error) {
    console.error('Setup savings error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to set up savings plan: ' + (error.response?.data?.message || error.message) });
  }
});

// backend/routes/bank.js (partial update)
router.get('/transaction-history/:wishlistItemId', ensureAuthenticated, async (req, res) => {
  const { wishlistItemId } = req.params;
  try {
    if (!wishlistItemId) {
      console.error('No wishlistItemId provided');
      return res.status(400).json({ error: 'Wishlist item ID required' });
    }
    const wishlistItem = await WishlistItem.findById(wishlistItemId).populate('userId');
    if (!wishlistItem || !wishlistItem.fundingSourceId) {
      return res.status(404).json({ error: 'Wishlist item or funding source not found' });
    }

    console.log(wishlistItem);

    // Use local transfers array as primary source
    let transactions = wishlistItem.transfers.map(transfer => ({
      date: transfer.date.getTime() / 1000,
      amount: transfer.amount,
      status: transfer.status,
      type: transfer.type
    }));

    // Optionally fetch updates from Dwolla API
    // const transfersResponse = await dwollaClient.get(`funding-sources/${wishlistItem.fundingSourceId}/transfers`, {
    //   limit: 10
    // });
    // const dwollaTransactions = transfersResponse.body._embedded.transfers.map(transfer => ({
    //   date: new Date(transfer.created).getTime() / 1000,
    //   amount: parseFloat(transfer.amount.value),
    //   status: transfer.status.charAt(0).toUpperCase() + transfer.status.slice(1),
    //   type: transfer._links.source.href.includes(wishlistItem.fundingSourceId) ? 'Debit' : 'Credit'
    // }));

    // Merge and deduplicate (update local status if different)
    // const transferMap = new Map();
    // transactions.forEach(t => transferMap.set(t.date, t));
    // dwollaTransactions.forEach(t => {
    //   const existing = transferMap.get(t.date);
    //   if (existing) {
    //     if (existing.status !== t.status) {
    //       existing.status = t.status;
    //     }
    //   } else {
    //     transferMap.set(t.date, t);
    //   }
    // });
    // transactions = Array.from(transferMap.values()).sort((a, b) => b.date - a.date);

    console.log('Transactions retrieved:', transactions);
    res.json({ transactions });
  } catch (error) {
    console.error('Transaction history error:', error.message);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

router.post('/payout', ensureAuthenticated, async (req, res) => {
  const { wishlistItemId } = req.body;
  try {
    console.log('Requesting payout for wishlist item:', wishlistItemId);
    const wishlistItem = await WishlistItem.findById(wishlistItemId);

    if (!wishlistItem) {
      console.error('Wishlist item not found:', wishlistItemId);
      return res.status(404).json({ error: 'Wishlist item not found' });
    }

    if (!wishlistItem.fundingSourceId) {
      console.error('No funding source linked for wishlist item:', wishlistItemId);
      return res.status(400).json({ error: 'No bank account linked for payouts' });
    }

    console.log('Wishlist item found:', { savings_progress: wishlistItem.savings_progress, savings_goal: wishlistItem.savings_goal });

    const user = await User.findById(wishlistItem.userId);
    if (!user.dwollaCustomerId) {
      return res.status(400).json({ error: 'User not set up for payouts' });
    }

    // Initiate ACH credit to pay back the user
    const transferResponse = await dwollaClient.post('transfers', {
      _links: {
        source: { href: `https://api-${process.env.DWOLLA_ENVIRONMENT}.dwolla.com/funding-sources/${process.env.DWOLLA_FUNDING_SOURCE_ID}` },
        destination: { href: `https://api-${process.env.DWOLLA_ENVIRONMENT}.dwolla.com/funding-sources/${wishlistItem.fundingSourceId}` }
      },
      amount: {
        currency: 'USD',
        value: wishlistItem.savings_progress.toString()
      },
      metadata: {
        wishlistItemId: wishlistItemId
      }
    });

    const transferId = transferResponse.headers.get('location').split('/').pop();
    const transferDate = new Date();
    wishlistItem.transfers.push({
      transferId,
      amount: wishlistItem.savings_progress * -1,
      date: transferDate,
      status: 'pending',
      type: 'debit'
    });
    wishlistItem.savings_progress = 0
    await wishlistItem.save();

    console.log('Payout successful:', transferResponse.headers.get('location'));
    res.json({ success: true, transferId: transferResponse.headers.get('location').split('/').pop() });
  } catch (error) {
    console.error('Payout error:', error.message);
    res.status(500).json({ error: 'Failed to payout' });
  }
});

router.post('/plaid-link-token', ensureAuthenticated, async (req, res) => {
  try {
    const response = await axios.post(
      `https://${process.env.PLAID_ENVIRONMENT}.plaid.com/link/token/create`,
      {
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        user: { client_user_id: req.user._id.toString() },
        client_name: 'Beforepay',
        products: ['auth'], // For ACH details
        country_codes: ['US'],
        language: 'en',
        webhook: 'https://your-webhook-url', // Optional: Add a webhook for Plaid updates
        access_token: null // Will be set after initial link
      }
    );
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error('Plaid link token error:', error.message);
    res.status(500).json({ error: 'Failed to create Plaid link token' });
  }
});

router.get('/existing-funding-sources', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.dwollaCustomerId) {
      return res.status(404).json({ error: 'User not found or not set up' });
    }

    // Fetch all WishlistItems for the user
    const wishlistItems = await WishlistItem.find({ userId: user._id, fundingSourceId: { $exists: true } });
    const fundingSourceIds = [...new Set(wishlistItems.map(item => item.fundingSourceId))]; // Unique funding sources

    const fundingSources = [];
    for (const fundingSourceId of fundingSourceIds) {
      const response = await dwollaClient.get(`funding-sources/${fundingSourceId}`);
      const data = response.body;
      fundingSources.push({
        id: fundingSourceId,
        name: data.name || 'Linked Account',
        mask: data.bankAccount ? data.bankAccount.mask : '****'
      });
    }

    res.json({ fundingSources });
  } catch (error) {
    console.error('Error fetching existing funding sources:', error.message);
    res.status(500).json({ error: 'Failed to fetch existing funding sources' });
  }
});

// backend/routes/bank.js (add this endpoint)
router.get('/funding-sources/:dwollaCustomerId', ensureAuthenticated, async (req, res) => {
  try {
    const { dwollaCustomerId } = req.params;
    if (!dwollaCustomerId) {
      return res.status(400).json({ error: 'Dwolla Customer ID required' });
    }

    // Fetch funding sources for the customer
    const response = await dwollaClient.get(`customers/${dwollaCustomerId}/funding-sources`);
    const fundingSources = response.body._embedded['funding-sources'].map(source => ({
      id: source.id,
      name: source.name || 'Unnamed Account',
      mask: source.bankAccount ? source.bankAccount.mask : '****',
      bankName: source.bankAccount ? source.bankAccount.bankName : 'Unknown'
    }));

    res.json({ fundingSources });
  } catch (error) {
    console.error('Error fetching funding sources:', error.message);
    res.status(500).json({ error: 'Failed to fetch funding sources' });
  }
});

module.exports = router;