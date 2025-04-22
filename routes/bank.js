const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const WishlistItem = require('../models/WishlistItem');

// Create Setup Intent for ACH Debit
router.post('/setup-intent', async (req, res) => {
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
    console.log('User found:', user);
    let customerId = wishlistItem.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email });
      customerId = customer.id;
      wishlistItem.stripeCustomerId = customerId;
      await wishlistItem.save();
      console.log('Created new customer:', customerId);
    } else {
      console.log('Using existing customer:', customerId);
    }
    const setupIntent = await stripe.setupIntents.create({
      payment_method_types: ['us_bank_account'],
      customer: customerId,
      usage: 'off_session'
    });
    res.json({ client_secret: setupIntent.client_secret });
  } catch (error) {
    console.error('Setup intent error:', error.message, error.stack);
    res.status(500).json({ error: error.message || 'Failed to create setup intent' });
  }
});

// Set up recurring transfer and save payment method
router.post('/transfer', async (req, res) => {
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
    
    // Validate start_date
    const startTimestamp = Math.floor(new Date(start_date).getTime() / 1000);
    const nowTimestamp = Math.floor(Date.now() / 1000);
    console.log('Start timestamp:', startTimestamp, 'Now timestamp:', nowTimestamp);
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
      billing_cycle_anchor: startTimestamp
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

// Manual payout
router.post('/payout', async (req, res) => {
  const { wishlistItemId } = req.body;
  try {
    console.log('Requesting payout for wishlist item:', wishlistItemId);
    const wishlistItem = await WishlistItem.findById(wishlistItemId);
    if (!wishlistItem) {
      console.error('Wishlist item not found:', wishlistItemId);
      return res.status(404).json({ error: 'Wishlist item not found' });
    }
    if (wishlistItem.savings_progress >= wishlistItem.savings_goal) {
      const payout = await stripe.payouts.create({
        amount: wishlistItem.savings_progress * 100,
        currency: 'usd',
        method: 'standard'
      });
      wishlistItem.savings_progress = 0;
      await wishlistItem.save();
      console.log('Payout successful:', payout.id);
      res.json({ success: true, payoutId: payout.id });
    } else {
      console.error('Goal not reached for item:', wishlistItemId);
      return res.status(400).json({ error: 'Goal not reached' });
    }
  } catch (error) {
    console.error('Payout error:', error);
    res.status(500).json({ error: error.message || 'Failed to payout' });
  }
});

module.exports = router;