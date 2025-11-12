const express = require('express');
const router = express.Router();
const CheckoutCart = require('../models/CheckoutCart');

// Get checkout cart by checkout ID
router.get('/:checkoutId', async (req, res) => {
  try {
    const { checkoutId } = req.params;
    
    const checkout = await CheckoutCart.findOne({ checkoutId });
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout not found' });
    }
    
    res.json(checkout);
  } catch (error) {
    console.error('Error fetching checkout cart:', error);
    res.status(500).json({ error: 'Failed to fetch checkout data' });
  }
});

module.exports = router;

