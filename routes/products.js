const express = require('express');
const router = express.Router();
const axios = require('axios');
const { requireSavingsAccountUser } = require('../middleware/auth');

/**
 * Search for products using SerpAPI
 * GET /api/products/search?q=query
 */
router.get('/search', requireSavingsAccountUser, async (req, res) => {
  const { q } = req.query;
  
  if (!q || q.trim() === '') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const response = await axios.get('https://serpapi.com/search', {
      params: { 
        api_key: process.env.SERPAPI_KEY, 
        engine: 'google_shopping', 
        q, 
        num: 10 
      }
    });
    
    const products = response.data.shopping_results.map(item => ({
      price: parseFloat(item.price?.replace(/[^0-9.]/g, '') || '0') || 0,
      ...item
    }));
    
    res.json(products);
  } catch (error) {
    console.error('Product search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;

