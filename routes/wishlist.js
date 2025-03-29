const router = require('express').Router();
const WishlistItem = require('../models/WishlistItem');
const axios = require('axios');

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
      const response = await axios.get('https://customsearch.googleapis.com/customsearch/v1', {
        params: {
          key: process.env.GOOGLE_SHOPPING_API_KEY,
          cx: process.env.GOOGLE_CX,
          // q: `${q} site:*.com | site:*.co | site:*.shop -inurl:(login | signup)`, // Focus on product pages
          q: q,
          num: 10, // Max results per call
        },
      });
      const products = response.data.items.map(item => ({
        name: item.title,
        price: extractPrice(item.snippet) || 0, // Simple price extraction; improve as needed
        url: item.link,
        imageUrl: item.pagemap?.cse_image?.[0]?.src || '',
      }));
      res.json(products);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Search failed' });
    }
});
  
// Basic price extraction from snippet (improve with regex or external API later)
function extractPrice(snippet) {
    const match = snippet.match(/\$[\d,]+\.?\d{0,2}/);
    return match ? parseFloat(match[0].replace(/[^0-9.]/g, '')) : null;
}

module.exports = router;