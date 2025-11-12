const express = require('express');
const router = express.Router();
const EmailToken = require('../models/EmailToken');
const CheckoutCart = require('../models/CheckoutCart');

// Validate email token and get checkout data
// Support both /api/email-token/validate/:token and /api/validate-email-token/:token
router.get('/validate/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find and validate token
    const emailToken = await EmailToken.findOne({ 
      token, 
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!emailToken) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Get checkout data
    const checkout = await CheckoutCart.findOne({ checkoutId: emailToken.checkoutId });
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout not found' });
    }

    res.json({
      success: true,
      email: emailToken.email,
      checkout: checkout
    });
  } catch (error) {
    console.error('Error validating email token:', error);
    res.status(500).json({ error: 'Failed to validate token' });
  }
});

// Backward compatibility: /api/validate-email-token/:token
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find and validate token
    const emailToken = await EmailToken.findOne({ 
      token, 
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!emailToken) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Get checkout data
    const checkout = await CheckoutCart.findOne({ checkoutId: emailToken.checkoutId });
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout not found' });
    }

    res.json({
      success: true,
      email: emailToken.email,
      checkout: checkout
    });
  } catch (error) {
    console.error('Error validating email token:', error);
    res.status(500).json({ error: 'Failed to validate token' });
  }
});

module.exports = router;

