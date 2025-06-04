const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const WishlistItem = require('../models/WishlistItem');

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

// Create Setup Intent for subscription bank account
router.post('/setup-intent', ensureAuthenticated, async (req, res) => {
  const { wishlistItemId } = req.body;
  try {
    if (!wishlistItemId) {
      console.error('No wishlistItemId provided');
      return res.status(400).json({ error: 'Wishlist item ID required' });
    }
    console.log('Setup intent requested for user:', req.user._id, 'wishlistItemId:', wishlistItemId);
    const user = await User.findById(req.user._id);
    if (!user) {
      console.error('User not found for ID:', req.user._id);
      return res.status(404).json({ error: 'User not found' });
    }
    const wishlistItem = await WishlistItem.findById(wishlistItemId);
    if (!wishlistItem) {
      console.error('Wishlist item not found:', wishlistItemId);
      return res.status(404).json({ error: 'Wishlist item not found' });
    }
    let customerId = wishlistItem.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email });
      customerId = customer.id;
      wishlistItem.stripeCustomerId = customerId;
      await wishlistItem.save();
      console.log('Created new customer:', customerId);
    }
    const setupIntent = await stripe.setupIntents.create({
      payment_method_types: ['us_bank_account'],
      customer: customerId,
      usage: 'off_session',
      metadata: { wishlistItemId }
    });
    
    if (!setupIntent) {
      console.log('Failed to created setup intent', wishlistItemId);
      res.status(500).json({ error: 'Could not connect to secure account linking'});
    }

    wishlistItem.setupIntentId = setupIntent.id;
    wishlistItem.save();

    res.json({ client_secret: setupIntent.client_secret });
  } catch (error) {
    console.error('Setup intent error:', error.message, error.stack);
    res.status(500).json({ error: error.message || 'Failed to create setup intent' });
  }
});

// Set up subscription
router.post('/transfer', ensureAuthenticated, async (req, res) => {
  const { wishlistItemId, payment_method_id, amount, frequency, start_date } = req.body;
  try {
    if (!wishlistItemId) {
      console.error('No wishlistItemId provided');
      return res.status(400).json({ error: 'Wishlist item ID required' });
    }
    if (!payment_method_id) {
      console.error('No payment_method_id provided');
      return res.status(400).json({ error: 'Payment method ID required' });
    }
    if (!amount || !frequency || !start_date) {
      console.error('Missing required fields:', { amount, frequency, start_date });
      return res.status(400).json({ error: 'Amount, frequency, and start date are required' });
    }
    console.log('Setting up transfer for wishlist item:', wishlistItemId, 'with:', { amount, frequency, start_date });
    const wishlistItem = await WishlistItem.findById(wishlistItemId);
    if (!wishlistItem) {
      console.error('Wishlist item not found:', wishlistItemId);
      return res.status(404).json({ error: 'Wishlist item not found' });
    }
    wishlistItem.paymentMethodId = payment_method_id;
    await wishlistItem.save();
    console.log('Payment method saved for wishlist item:', wishlistItemId);

    const customerId = wishlistItem.stripeCustomerId;
    if (!customerId) {
      console.error('No customer linked for wishlist item:', wishlistItemId);
      return res.status(400).json({ error: 'No customer linked' });
    }
    console.log('Customer ID:', customerId, 'Payment Method ID:', payment_method_id);

    const startTimestamp = Math.floor(new Date(start_date).getTime() / 1000);
    const nowTimestamp = Math.floor(Date.now() / 1000);
    if (startTimestamp <= nowTimestamp) {
      console.error('Start date must be in the future:', start_date);
      return res.status(400).json({ error: 'Start date must be in the future' });
    }

    const product = await stripe.products.create({ name: 'Beforepay Savings' });
    const price = await stripe.prices.create({
      unit_amount: amount * 100,
      currency: 'usd',
      recurring: { interval: frequency === 'month' ? 'month' : 'week', interval_count: frequency === 'biweek' ? 2 : 1 },
      product: product.id
    });
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      default_payment_method: payment_method_id,
      billing_cycle_anchor: startTimestamp,
      proration_behavior: 'none'
    });
    wishlistItem.subscriptionId = subscription.id;
    await wishlistItem.save();
    console.log('Transfer set up for wishlist item:', wishlistItemId, 'subscription:', subscription.id);
    res.json({ success: true, subscriptionId: subscription.id });
  } catch (error) {
    console.error('Transfer setup error:', error.message, error.stack);
    res.status(400).json({ error: error.message || 'Failed to set up transfer' });
  }
});

// Fetch subscription transaction history
router.get('/subscription-history/:subscriptionId', async (req, res) => {
  const { subscriptionId } = req.params;
  try {
    if (!subscriptionId) {
      console.error('No subscriptionId provided');
      return res.status(400).json({ error: 'Subscription ID required' });
    }
    console.log('Fetching transaction history for subscription:', subscriptionId);
    
    const invoices = await stripe.invoices.list({
      subscription: subscriptionId,
      status: 'paid'
    });

    const transactions = invoices.data.map(invoice => ({
      date: invoice.created,
      amount: invoice.amount_paid,
      status: invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)
    }));

    console.log('Transactions retrieved:', transactions);
    res.json({ transactions });
  } catch (error) {
    console.error('Subscription history error:', error.message, error.stack);
    res.status(500).json({ error: error.message || 'Failed to fetch transaction history' });
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

    if (!wishlistItem.paymentMethodId) {
      console.error('No payment method id linked for wishlist item:', wishlistItemId);
      return res.status(400).json({ error: 'Please set up your payout account via Setup Payout' });
    }
    console.log('Wishlist item found:', { savings_progress: wishlistItem.savings_progress, savings_goal: wishlistItem.savings_goal });

    // Retrieve the PaymentMethod using paymentMethodId
    const paymentMethod = await stripe.paymentMethods.retrieve(wishlistItem.paymentMethodId);
    console.log('Retrieved PaymentMethod:', {
      id: paymentMethod.id,
      type: paymentMethod.type,
      us_bank_account: paymentMethod.us_bank_account
    });

    // Find the associated Financial Connections Account
    if (!paymentMethod.us_bank_account?.financial_connections_account) {
      console.error('No financial connections account linked for payment method:', wishlistItem.paymentMethodId);
      return res.status(400).json({ error: 'No financial account linked to this payment method. Please set up a savings plan with a valid bank account.' });
    }

    const financialAccountId = paymentMethod.us_bank_account.financial_connections_account;
    console.log('Found Financial Connections Account ID:', financialAccountId);
    console.log(paymentMethod);
    // Create a payout to the user's bank account using the financial account ID
    const payout = await stripe.treasury.outboundPayments.create({
      amount: wishlistItem.savings_progress * 100,
      currency: 'usd',
      financial_account: financialAccountId,
      customer: wishlistItem.stripeCustomerId,
      destination_payment_method: wishlistItem.paymentMethodId,
      description: `Payout for wishlist item ${wishlistItemId}`
    });

    wishlistItem.savings_progress = 0;
    await wishlistItem.save();
    console.log('Payout successful:', payout.id, 'Amount:', wishlistItem.savings_progress * 100);
    res.json({ success: true, payoutId: payout.id });
  } catch (error) {
    console.error('Payout error:', error.message, error.stack);
    res.status(500).json({ error: error.message || 'Failed to payout' });
  }
});

// Create Financial Connections session for payout bank account
router.post('/setup-payout', ensureAuthenticated, async (req, res) => {
  const { wishlistItemId } = req.body;
  try {
    if (!wishlistItemId) {
      console.error('No wishlistItemId provided');
      return res.status(400).json({ error: 'Wishlist item ID required' });
    }
    console.log('Setup payout requested for user:', req.user._id, 'wishlistItemId:', wishlistItemId);
    const user = await User.findById(req.user._id);
    if (!user) {
      console.error('User not found for ID:', req.user._id);
      return res.status(404).json({ error: 'User not found' });
    }
    const wishlistItem = await WishlistItem.findById(wishlistItemId);
    if (!wishlistItem) {
      console.error('Wishlist item not found:', wishlistItemId);
      return res.status(404).json({ error: 'Wishlist item not found' });
    }
    if (!wishlistItem.stripeCustomerId) {
      console.error('No customer linked for wishlist item:', wishlistItemId);
      return res.status(400).json({ error: 'No customer linked' });
    }
    const session = await stripe.financialConnections.sessions.create({
      account_holder: {
        type: 'customer',
        customer: wishlistItem.stripeCustomerId
      },
      permissions: ['balances', 'ownership', 'payment_method'],
      filters: {
        countries: ['US']
      }
    });
    res.json({ client_secret: session.client_secret });
  } catch (error) {
    console.error('Setup payout error:', error.message, error.stack);
    res.status(500).json({ error: error.message || 'Failed to create payout setup session' });
  }
});

module.exports = router;