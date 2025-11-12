const express = require('express');
const router = express.Router();
const { processScheduledPayments } = require('../cron/process-scheduled-payments');
const { processAbandonedCarts } = require('../cron/abandoned-carts');

/**
 * Check if current environment is production
 * @returns {boolean}
 */
function isProduction() {
  return process.env.NODE_ENV === 'production' && 
         (process.env.VERCEL_ENV === 'production' || !process.env.VERCEL_ENV);
}

/**
 * Middleware to block test routes in production
 */
function requireTestEnvironment(req, res, next) {
  if (isProduction()) {
    return res.status(403).json({ error: 'This endpoint is only available in test/development environments' });
  }
  next();
}

// Health check endpoint
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Server is running',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

// CORS test endpoint
router.get('/cors-test', (req, res) => {
  res.json({ 
    message: 'CORS test successful',
    origin: req.headers.origin,
    method: req.method,
    headers: req.headers
  });
});

router.options('/cors-test', (req, res) => {
  const origin = req.headers.origin;
  console.log('CORS Test OPTIONS request from origin:', origin);
  
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Savings goal CORS test endpoint
router.get('/savings-goal-test', (req, res) => {
  res.json({ 
    message: 'Savings goal CORS test successful',
    origin: req.headers.origin,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

router.options('/savings-goal-test', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Test-only endpoint for simulating payments
router.post('/simulate-payments', requireTestEnvironment, async (req, res) => {
  try {
    const { date } = req.body;
    
    if (!date) {
      return res.status(400).json({ error: 'Date is required (format: YYYY-MM-DD)' });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    console.log(`[TEST] Simulating payments for date: ${date}`);
    
    await processScheduledPayments(date);
    
    res.json({ 
      success: true,
      message: `Payments simulated successfully for ${date}`,
      date: date
    });
  } catch (error) {
    console.error('[TEST] Payment simulation failed:', error);
    res.status(500).json({ 
      error: 'Failed to simulate payments',
      message: error.message 
    });
  }
});

// Test-only endpoint for transmitting a payment via Unit Finance API
router.post('/transmit-payment', requireTestEnvironment, async (req, res) => {
  try {
    const { paymentId } = req.body;
    
    if (!paymentId) {
      return res.status(400).json({ error: 'paymentId is required' });
    }

    const axios = require('axios');
    const UNIT_API_BASE = process.env.UNIT_API_BASE || 'https://api.s.unit.sh';
    const UNIT_API_KEY = process.env.UNIT_API_KEY;

    if (!UNIT_API_KEY) {
      return res.status(500).json({ error: 'UNIT_API_KEY not configured' });
    }

    console.log(`[TEST] Transmitting payment ${paymentId} via Unit Finance API`);

    const response = await axios.post(
      `${UNIT_API_BASE}/sandbox/ach/transmit`,
      {
        data: {
          type: 'transmitAchPayment',
          relationships: {
            payment: {
              data: {
                type: 'achPayment',
                id: paymentId
              }
            }
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/vnd.api+json',
          'Authorization': `Bearer ${UNIT_API_KEY}`
        }
      }
    );

    res.json({ 
      success: true,
      message: `Payment ${paymentId} transmitted successfully`,
      paymentId: paymentId,
      data: response.data
    });
  } catch (error) {
    console.error('[TEST] Payment transmission failed:', error);
    console.error('[TEST] Error details:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      paymentId: req.body.paymentId
    });
    
    const errorDetail = error.response?.data?.errors?.[0]?.detail || error.response?.data?.errors?.[0]?.title || error.message;
    const errorStatus = error.response?.status || 500;
    
    res.status(500).json({ 
      error: 'Failed to transmit payment',
      message: errorDetail,
      paymentId: req.body.paymentId,
      unitApiStatus: errorStatus,
      unitApiResponse: error.response?.data
    });
  }
});

// Test-only endpoint for clearing a payment via Unit Finance API
router.post('/clear-payment', requireTestEnvironment, async (req, res) => {
  try {
    const { paymentId } = req.body;
    
    if (!paymentId) {
      return res.status(400).json({ error: 'paymentId is required' });
    }

    const axios = require('axios');
    const UNIT_API_BASE = process.env.UNIT_API_BASE || 'https://api.s.unit.sh';
    const UNIT_API_KEY = process.env.UNIT_API_KEY;

    if (!UNIT_API_KEY) {
      return res.status(500).json({ error: 'UNIT_API_KEY not configured' });
    }

    console.log(`[TEST] Clearing payment ${paymentId} via Unit Finance API`);

    const response = await axios.post(
      `${UNIT_API_BASE}/sandbox/ach/clear`,
      {
        data: {
          type: 'clearAchPayment',
          relationships: {
            payment: {
              data: {
                type: 'achPayment',
                id: paymentId
              }
            }
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/vnd.api+json',
          'Authorization': `Bearer ${UNIT_API_KEY}`
        }
      }
    );

    res.json({ 
      success: true,
      message: `Payment ${paymentId} cleared successfully`,
      paymentId: paymentId,
      data: response.data
    });
  } catch (error) {
    console.error('[TEST] Payment clearing failed:', error);
    console.error('[TEST] Error details:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      paymentId: req.body.paymentId
    });
    
    const errorDetail = error.response?.data?.errors?.[0]?.detail || error.response?.data?.errors?.[0]?.title || error.message;
    const errorStatus = error.response?.status || 500;
    
    res.status(500).json({ 
      error: 'Failed to clear payment',
      message: errorDetail,
      paymentId: req.body.paymentId,
      unitApiStatus: errorStatus,
      unitApiResponse: error.response?.data
    });
  }
});

// Test-only endpoint to set up abandoned cart and generate email token
router.post('/setup-abandoned-cart', requireTestEnvironment, async (req, res) => {
  try {
    const CheckoutCart = require('../models/CheckoutCart');
    const ShopifyMerchant = require('../models/ShopifyMerchant');
    const EmailToken = require('../models/EmailToken');
    
    // Ensure merchant exists with abandoned cart emails enabled
    const shopDomain = 'stashpay-2.myshopify.com';
    const shopifyShopId = shopDomain.replace('.myshopify.com', '');
    
    let merchant = await ShopifyMerchant.findOne({ shopifyShopId });
    if (!merchant) {
      merchant = new ShopifyMerchant({
        shopifyShopId,
        shopDomain,
        abandonedCartEmailsEnabled: true
      });
      await merchant.save();
      console.log(`[TEST] Created merchant: ${shopifyShopId}`);
    } else if (!merchant.abandonedCartEmailsEnabled) {
      merchant.abandonedCartEmailsEnabled = true;
      await merchant.save();
      console.log(`[TEST] Enabled abandoned cart emails for merchant: ${shopifyShopId}`);
    }
    
    // Insert the checkout cart document
    const checkoutCartData = {
      checkoutId: '43783022870625',
      email: 'cypress_shopify@test.com',
      shopDomain,
      totalPrice: '600.00',
      customerId: '7736055464033',
      lineItems: [
        {
          productId: '7373544521825',
          variantId: '42457998131297',
          quantity: 1,
          presentmentTitle: 'The Collection Snowboard: Hydrogen',
          vendor: 'Hydrogen Vendor',
          price: '600.00'
        }
      ],
      status: 'active',
      orderId: null,
      abandonedAt: new Date('2025-11-06T15:41:39.227Z'),
      emailSent: false
    };

    // Delete existing cart if it exists
    await CheckoutCart.deleteOne({ checkoutId: checkoutCartData.checkoutId });
    
    // Create new cart with createdAt set to past to trigger abandonment
    const checkoutCart = new CheckoutCart({
      ...checkoutCartData,
      createdAt: new Date(Date.now() - 2 * 60 * 1000) // 2 minutes ago
    });
    await checkoutCart.save();

    console.log(`[TEST] Created checkout cart: ${checkoutCartData.checkoutId}`);

    // Process abandoned carts with very low threshold (0.1 minutes = 6 seconds)
    await processAbandonedCarts(0.1);

    // Find the email token that was created
    const emailToken = await EmailToken.findOne({
      email: checkoutCartData.email,
      checkoutId: checkoutCartData.checkoutId
    }).sort({ createdAt: -1 });

    if (!emailToken) {
      return res.status(500).json({ 
        error: 'Email token was not created',
        checkoutId: checkoutCartData.checkoutId
      });
    }

    res.json({ 
      success: true,
      message: 'Abandoned cart set up successfully',
      checkoutId: checkoutCartData.checkoutId,
      email: checkoutCartData.email,
      token: emailToken.token,
      emailTokenId: emailToken._id
    });
  } catch (error) {
    console.error('[TEST] Setup abandoned cart failed:', error);
    res.status(500).json({ 
      error: 'Failed to set up abandoned cart',
      message: error.message
    });
  }
});

// Test-only endpoint to clean up user data (DB and Firebase)
router.delete('/cleanup-user', requireTestEnvironment, async (req, res) => {
  try {
    const User = require('../models/User');
    const firebaseService = require('../services/firebaseService');
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find user by email
    const user = await User.findOne({ email });
    
    if (user) {
      // Delete from Firebase if uid exists
      if (user.firebaseUid) {
        try {
          await firebaseService.deleteUser(user.firebaseUid);
          console.log(`[TEST] Deleted Firebase user: ${user.firebaseUid}`);
        } catch (firebaseError) {
          console.error(`[TEST] Failed to delete Firebase user ${user.firebaseUid}:`, firebaseError.message);
          // Continue with DB cleanup even if Firebase fails
        }
      }

      // Delete user from database
      await User.deleteOne({ _id: user._id });
      console.log(`[TEST] Deleted user from DB: ${user._id}`);
    } else {
      console.log(`[TEST] User not found in DB: ${email}`);
    }

    res.json({ 
      success: true,
      message: `User data cleaned up for ${email}`,
      deleted: !!user
    });
  } catch (error) {
    console.error('[TEST] Cleanup user failed:', error);
    res.status(500).json({ 
      error: 'Failed to cleanup user',
      message: error.message
    });
  }
});

module.exports = router;

