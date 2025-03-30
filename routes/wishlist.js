const express = require('express');
const axios = require('axios');
const router = express.Router();

const ensureAuthenticated = (req, res, next) => req.isAuthenticated() ? next() : res.status(401).json({ error: 'Unauthorized' });

router.get('/', ensureAuthenticated, async (req, res) => {
  const items = await WishlistItem.find({ userId: req.user._id });
  res.json(items);
});

router.post('/', ensureAuthenticated, async (req, res) => {
  const { name, price, url, imageUrl, savingsGoal } = req.body;
  const item = new WishlistItem({ userId: req.user._id, name, price, url, imageUrl, savingsGoal });
  await item.save();
  res.status(201).json(item);
});

router.get('/search', ensureAuthenticated, async (req, res) => {
  const { q } = req.query;
  try {
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        api_key: process.env.SERPAPI_KEY,
        engine: 'google_shopping',
        q,
        num: 10 // Max results per request (adjustable)
      }
    });
    // Check if shopping_results exists, fallback to empty array
    const shoppingResults = response.data.shopping_results || [];
    const products = shoppingResults.map(item => ({
      name: item.title,
      price: parseFloat(item.price?.replace(/[^0-9.]/g, '') || '0') || 0,
      url: item.link,
      imageUrl: item.thumbnail || '',
      ...item
    }));
    res.json(products);
  } catch (error) {
    console.error('SerpApi Search Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Assuming WishlistItem model is imported
const WishlistItem = require('../models/WishlistItem');

module.exports = router;