const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
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

    console.log(`[EMAIL_TOKEN] Validating token: ${token}`);

    // Find and validate token
    const emailToken = await EmailToken.findOne({ 
      token, 
      used: false,
      expiresAt: { $gt: new Date() }
    });

    console.log(`[EMAIL_TOKEN] Token lookup result:`, emailToken ? {
      token: emailToken.token,
      email: emailToken.email,
      checkoutId: emailToken.checkoutId,
      used: emailToken.used,
      expiresAt: emailToken.expiresAt
    } : 'NOT FOUND');

    if (!emailToken) {
      // Also check if token exists at all (even if expired or used)
      const anyToken = await EmailToken.findOne({ token });
      if (anyToken) {
        console.log(`[EMAIL_TOKEN] Token exists but is invalid:`, {
          used: anyToken.used,
          expiresAt: anyToken.expiresAt,
          isExpired: anyToken.expiresAt <= new Date(),
          email: anyToken.email
        });
      } else {
        console.log(`[EMAIL_TOKEN] Token does not exist in database at all`);
      }
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Get checkout data
    const checkout = await CheckoutCart.findOne({ checkoutId: emailToken.checkoutId });
    if (!checkout) {
      console.log(`[EMAIL_TOKEN] Checkout not found for checkoutId: ${emailToken.checkoutId}`);
      return res.status(404).json({ error: 'Checkout not found' });
    }

    console.log(`[EMAIL_TOKEN] Returning email: ${emailToken.email} for checkout: ${emailToken.checkoutId}`);

    res.json({
      success: true,
      email: emailToken.email,
      checkout: checkout
    });
  } catch (error) {
    console.error('[EMAIL_TOKEN] Error validating email token:', error);
    res.status(500).json({ error: 'Failed to validate token' });
  }
});

module.exports = router;

