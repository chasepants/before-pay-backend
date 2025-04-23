const express = require('express');
const axios = require('axios');
const router = express.Router();
const WishlistItem = require('../models/WishlistItem');

const ensureAuthenticated = (req, res, next) => req.isAuthenticated() ? next() : res.status(401).json({ error: 'Unauthorized' });

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
    const result = await WishlistItem.deleteOne({ _id: id, userId: req.user._id });
    if (result.deletedCount === 0) {
      console.error('Wishlist item not found or not authorized:', id);
      return res.status(404).json({ error: 'Wishlist item not found or not authorized' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Wishlist deletion error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to delete wishlist item' });
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