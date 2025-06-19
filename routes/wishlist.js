const express = require('express');
const axios = require('axios');
const router = express.Router();
const WishlistItem = require('../models/WishlistItem');
const dwolla = require('dwolla-v2'); // Ensure dwolla-v2 is installed
require('dotenv').config();

const ensureAuthenticated = (req, res, next) => req.isAuthenticated() ? next() : res.status(401).json({ error: 'Unauthorized' });

const dwollaClient = new dwolla.Client({
  key: process.env.DWOLLA_KEY,
  secret: process.env.DWOLLA_SECRET,
  environment: process.env.DWOLLA_ENVIRONMENT
});

router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const items = await WishlistItem.find({ userId: req.user._id });
    res.json(items);
  } catch (error) {
    console.error('Wishlist fetch error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch wishlist' });
  }
});

router.get('/:id', ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    console.log('Fetching wishlist item:', id, 'for user:', req.user._id);
    const item = await WishlistItem.findOne({ _id: id, userId: req.user._id });
    if (!item) {
      console.error('Wishlist item not found:', id);
      return res.status(404).json({ error: 'Wishlist item not found' });
    }
    console.log('Wishlist item found:', id);
    res.json(item);
  } catch (error) {
    console.error('Wishlist item fetch error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch wishlist item' });
  }
});

router.post('/', ensureAuthenticated, async (req, res) => {
  try {
    const item = new WishlistItem({
      userId: req.user._id,
      ...req.body
    });
    await item.save();
    res.status(201).json(item);
  } catch (error) {
    console.error('Wishlist creation error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to create wishlist item' });
  }
});

router.delete('/:id', ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    console.log('Deleting wishlist item:', id);
    const wishlistItem = await WishlistItem.findOne({ _id: id, userId: req.user._id });
    if (!wishlistItem) {
      console.error('Wishlist item not found or not authorized:', id);
      return res.status(404).json({ error: 'Wishlist item not found or not authorized' });
    }

    // Condition 1: No savings plan (no fundingSourceId)
    if (!wishlistItem.fundingSourceId) {
      console.log('No savings plan, deleting item:', id);
      await WishlistItem.deleteOne({ _id: id, userId: req.user._id });
      return res.json({ success: true });
    }

    // Condition 2: Savings plan exists but no completed or pending debit transfers
    const pendingDebits = wishlistItem.transfers.filter(t => t.type === 'debit' && t.status === 'pending');
    const completedDebits = wishlistItem.transfers.filter(t => t.type === 'debit' && t.status === 'completed');
    if (pendingDebits.length === 0 && completedDebits.length === 0) {
      console.log('Savings plan exists but no transfers, deleting item:', id);
      await WishlistItem.deleteOne({ _id: id, userId: req.user._id });
      return res.json({ success: true });
    }

    // Condition 3: Savings plan with pending or completed debit transfers
    const user = await User.findById(req.user._id);
    if (!user.dwollaCustomerId) {
      return res.status(400).json({ error: 'User not set up for refunds or cancellations' });
    }

    // Cancel pending debit transfers
    for (const transfer of pendingDebits) {
      try {
        await dwollaClient.put(`transfers/${transfer.transferId}`, { status: 'cancelled' });
        console.log(`Cancelled pending transfer ${transfer.transferId} for item ${id}`);
        // Update local transfer status
        transfer.status = 'cancelled';
        await wishlistItem.save();
      } catch (error) {
        console.error(`Failed to cancel transfer ${transfer.transferId}:`, error.message);
      }
    }

    // Calculate refund amount from completed debits only
    const refundAmount = completedDebits.reduce((sum, t) => sum + t.amount, 0);
    if (refundAmount > 0) {
      console.log('Initiating refund of $' + refundAmount + ' for item:', id);
      const refundResponse = await dwollaClient.post('transfers', {
        _links: {
          source: { href: `https://api-${process.env.DWOLLA_ENVIRONMENT}.dwolla.com/funding-sources/${process.env.DWOLLA_FUNDING_SOURCE_ID}` },
          destination: { href: `https://api-${process.env.DWOLLA_ENVIRONMENT}.dwolla.com/funding-sources/${wishlistItem.fundingSourceId}` }
        },
        amount: {
          currency: 'USD',
          value: refundAmount.toString()
        },
        clearing: {
          source: 'next-available'
        },
        metadata: {
          wishlistItemId: id,
          type: 'refund'
        }
      });

      const refundTransferId = refundResponse.headers.get('location').split('/').pop();
      console.log('Refund initiated:', refundTransferId);

      // Record the refund in transfers
      wishlistItem.transfers.push({
        transferId: refundTransferId,
        amount: refundAmount,
        date: new Date(),
        status: 'pending',
        type: 'credit'
      });
      wishlistItem.savings_progress = 0; // Reset after refund
      await wishlistItem.save();
    } else {
      console.log('No completed debits to refund for item:', id);
    }

    // Delete the wishlist item after handling transfers
    await WishlistItem.deleteOne({ _id: id, userId: req.user._id });
    res.json({ success: true, refundTransferId: refundAmount > 0 ? refundTransferId : null });
  } catch (error) {
    console.error('Wishlist deletion error:', error.message, error.stack);
    if (error.message.includes('NotFound')) {
      return res.status(404).json({ error: 'Funding source or transfer not found for refund' });
    }
    res.status(500).json({ error: 'Failed to delete wishlist item: ' + error.message });
  }
});

router.get('/search', ensureAuthenticated, async (req, res) => {
  const { q } = req.query;
  try {
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        api_key: process.env.SERPAPI_KEY,
        engine: 'google_shopping',
        q,
        num: 10
      }
    });
    const shoppingResults = response.data.shopping_results || [];
    const products = shoppingResults.map(item => ({
      price: parseFloat(item.price?.replace(/[^0-9.]/g, '') || '0') || 0,
      ...item
    }));
    res.json(products);
  } catch (error) {
    console.error('SerpApi Search Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;