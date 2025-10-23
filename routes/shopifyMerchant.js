const express = require('express');
const router = express.Router();
const ShopifyMerchant = require('../models/ShopifyMerchant');
const CheckoutCart = require('../models/CheckoutCart');
const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const { createUnitApplicationForm } = require('../services/unitMerchantService');
const { verifyShopifySessionToken } = require('../middleware/shopifyAuth');
const firebaseService = require('../services/firebaseService');

router.get('/status/:shopId', verifyShopifySessionToken, async (req, res) => {
  try {
    const { shopId } = req.params;
    
    const merchant = await ShopifyMerchant.findOne({ shopifyShopId: shopId });
    
    if (!merchant) {
      return res.json({
        exists: false,
        status: 'not_registered',
        message: 'Merchant not found. Please complete onboarding.'
      });
    }
    
    res.json({
      exists: true,
      merchant: {
        id: merchant._id,
        shopifyShopId: merchant.shopifyShopId,
        onboardingStatus: merchant.onboardingStatus,
        unitApplicationId: merchant.unitApplicationId,
        unitCustomerId: merchant.unitCustomerId,
        unitAccountId: merchant.unitAccountId,
        abandonedCartEmailsEnabled: merchant.abandonedCartEmailsEnabled,
        createdAt: merchant.createdAt,
        updatedAt: merchant.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching merchant status:', error);
    res.status(500).json({ error: 'Failed to fetch merchant status' });
  }
});

router.post('/register', verifyShopifySessionToken, async (req, res) => {
  try {
    const { shopifyShopId } = req.body;
    
    if (!shopifyShopId) {
      return res.status(400).json({ error: 'shopifyShopId is required' });
    }
    
    let merchant = await ShopifyMerchant.findOne({ shopifyShopId });
    
    if (merchant) {
      merchant.onboardingStatus = 'in_progress';
      await merchant.save();
    } else {
      merchant = new ShopifyMerchant({
        shopifyShopId,
        onboardingStatus: 'in_progress'
      });
      
      await merchant.save();
    }
    
    res.json({
      message: 'Merchant registered successfully',
      merchant: {
        id: merchant._id,
        shopifyShopId: merchant.shopifyShopId,
        onboardingStatus: merchant.onboardingStatus,
        unitApplicationId: merchant.unitApplicationId,
        unitCustomerId: merchant.unitCustomerId,
        unitAccountId: merchant.unitAccountId,
        createdAt: merchant.createdAt,
        updatedAt: merchant.updatedAt
      }
    });
  } catch (error) {
    console.error('Error registering merchant:', error);
    res.status(500).json({ error: 'Failed to register merchant' });
  }
});

router.post('/register-with-credentials', verifyShopifySessionToken, async (req, res) => {
  try {
    const { shopifyShopId, email, password, firstName, lastName } = req.body;
    
    if (!shopifyShopId || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    let merchant = await ShopifyMerchant.findOne({ shopifyShopId });
    if (!merchant) {
      merchant = new ShopifyMerchant({
        shopifyShopId,
        onboardingStatus: 'in_progress'
      });
      await merchant.save();
    }

    let firebaseUser;
    try {
      firebaseUser = await firebaseService.createUserWithEmailAndPassword(
        email,
        password,
        firstName,
        lastName
      );
    } catch (firebaseError) {
      console.error('Firebase user creation failed:', firebaseError);
      return res.status(400).json({ 
        error: 'Failed to create user account', 
        details: firebaseError.message 
      });
    }

    let user;
    try {
      user = new User({
        email,
        firstName,
        lastName,
        userType: 'merchant',
        shopifyMerchantId: merchant._id,
        firebaseUid: firebaseUser.uid,
        status: 'pending'
      });
      
      await user.save();
    } catch (mongoError) {
      console.error('MongoDB user creation failed:', mongoError);
      try {
        await firebaseService.deleteUser(firebaseUser.uid);
      } catch (cleanupError) {
        console.error('Failed to cleanup Firebase user:', cleanupError);
      }
      return res.status(500).json({ 
        error: 'Failed to create user record', 
        details: mongoError.message 
      });
    }
    
    res.json({
      message: 'Merchant user created successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        shopifyMerchantId: user.shopifyMerchantId
      },
      merchant: {
        id: merchant._id,
        shopifyShopId: merchant.shopifyShopId,
        onboardingStatus: merchant.onboardingStatus
      }
    });
  } catch (error) {
    console.error('Error registering merchant with credentials:', error);
    res.status(500).json({ error: 'Failed to register merchant with credentials' });
  }
});

router.post('/start-unit-application/:merchantId', verifyShopifySessionToken, async (req, res) => {
  try {
    const { merchantId } = req.params;
    
    const merchant = await ShopifyMerchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    
    const applicationForm = await createUnitApplicationForm({
      merchantId: merchant._id,
      shopifyShopId: merchant.shopifyShopId
    });
    
    merchant.onboardingStatus = 'in_progress';
    merchant.unitApplicationFormId = applicationForm.id;
    merchant.unitApplicationFormUrl = applicationForm.links.related.href;
    merchant.unitApplicationFormToken = applicationForm.attributes.applicationFormToken.token;
    
    await merchant.save();
    
    res.json({
      success: true,
      applicationForm: {
        id: applicationForm.id,
        url: applicationForm.links.related.href,
        token: applicationForm.attributes.applicationFormToken.token,
        expiresAt: applicationForm.attributes.applicationFormToken.expiration
      }
    });
  } catch (error) {
    console.error('Error starting Unit application:', error);
    res.status(500).json({ error: 'Failed to start Unit application' });
  }
});

router.post('/webhook/unit-application-update', async (req, res) => {
  try {
    const { applicationId, status, accountId } = req.body;
    
    const merchant = await ShopifyMerchant.findOne({ unitApplicationId: applicationId });
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    
    switch (status) {
      case 'approved':
        merchant.kybStatus = 'approved';
        merchant.onboardingStatus = 'completed';
        merchant.unitAccountId = accountId;
        merchant.isEnabled = true;
        break;
      case 'rejected':
        merchant.kybStatus = 'rejected';
        merchant.onboardingStatus = 'rejected';
        break;
      case 'requires_documents':
        merchant.kybStatus = 'requires_documents';
        break;
      default:
        merchant.kybStatus = 'in_progress';
    }
    
    await merchant.save();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating merchant status:', error);
    res.status(500).json({ error: 'Failed to update merchant status' });
  }
});

router.get('/dashboard/:merchantId', verifyShopifySessionToken, async (req, res) => {
  try {
    const { merchantId } = req.params;
    
    const merchant = await ShopifyMerchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    
    res.json({
      merchant: {
        id: merchant._id,
        shopifyShopId: merchant.shopifyShopId,
        onboardingStatus: merchant.onboardingStatus,
        unitApplicationId: merchant.unitApplicationId,
        unitCustomerId: merchant.unitCustomerId,
        unitAccountId: merchant.unitAccountId,
        createdAt: merchant.createdAt,
        updatedAt: merchant.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching merchant dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch merchant dashboard' });
  }
});

router.put('/toggle/:merchantId', verifyShopifySessionToken, async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { enabled } = req.body;
    
    const merchant = await ShopifyMerchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    
    if (merchant.onboardingStatus !== 'completed') {
      return res.status(400).json({ 
        error: 'Merchant must complete onboarding before enabling StashPay' 
      });
    }
    
    res.json({
      message: 'Merchant status updated successfully',
      success: true
    });
  } catch (error) {
    console.error('Error toggling StashPay:', error);
    res.status(500).json({ error: 'Failed to toggle StashPay' });
  }
});

router.put('/toggle-abandoned-cart-emails/:merchantId', verifyShopifySessionToken, async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { enabled } = req.body;
    
    const merchant = await ShopifyMerchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    
    if (merchant.onboardingStatus !== 'completed') {
      return res.status(400).json({ 
        error: 'Merchant must complete onboarding before configuring settings' 
      });
    }
    
    merchant.abandonedCartEmailsEnabled = enabled;
    await merchant.save();
    
    res.json({
      message: 'Abandoned cart email settings updated successfully',
      success: true,
      abandonedCartEmailsEnabled: merchant.abandonedCartEmailsEnabled
    });
  } catch (error) {
    console.error('Error toggling abandoned cart emails:', error);
    res.status(500).json({ error: 'Failed to update abandoned cart email settings' });
  }
});

router.get('/insights/:merchantId', verifyShopifySessionToken, async (req, res) => {
  try {
    const { merchantId } = req.params;

    const merchant = await ShopifyMerchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    if (merchant.onboardingStatus !== 'completed') {
      return res.status(400).json({
        error: 'Merchant must complete onboarding to view insights'
      });
    }

    const shopDomain = `${merchant.shopifyShopId}.myshopify.com`;

    const activeCheckouts = await CheckoutCart.countDocuments({
      shopDomain,
      status: 'active'
    });

    const abandonedCheckouts = await CheckoutCart.countDocuments({
      shopDomain,
      status: 'abandoned'
    });

    const emailsSent = await CheckoutCart.countDocuments({
      shopDomain,
      emailSent: true
    });

    const ongoingInstallments = await SavingsGoal.countDocuments({
      'product.type': 'Shopify',
      'product.shopDomain': shopDomain,
      isPaused: false
    });

    const totalInstallments = await SavingsGoal.countDocuments({
      'product.type': 'Shopify',
      'product.shopDomain': shopDomain
    });

    const conversionRate = activeCheckouts + abandonedCheckouts > 0 
      ? ((ongoingInstallments / (activeCheckouts + abandonedCheckouts)) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      insights: {
        activeCheckouts,
        abandonedCheckouts,
        emailsSent,
        ongoingInstallments,
        totalInstallments,
        conversionRate: `${conversionRate}%`
      }
    });
  } catch (error) {
    console.error('Error fetching merchant insights:', error);
    res.status(500).json({ error: 'Failed to fetch merchant insights' });
  }
});

module.exports = router;
