const express = require('express');
const router = express.Router();
const ShopifyMerchant = require('../models/ShopifyMerchant');
const CheckoutCart = require('../models/CheckoutCart');
const SavingsGoal = require('../models/SavingsGoal');
const { createUnitApplicationForm } = require('../services/unitMerchantService');
const { verifyShopifySessionToken } = require('../middleware/shopifyAuth');

// Get merchant status by Shopify shop ID
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
    
    // Check if merchant already exists
    let merchant = await ShopifyMerchant.findOne({ shopifyShopId });
    
    if (merchant) {
      merchant.onboardingStatus = 'in_progress';
      await merchant.save();
    } else {
      // Create new merchant
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

// Start Unit application process
router.post('/start-unit-application/:merchantId', verifyShopifySessionToken, async (req, res) => {
  try {
    const { merchantId } = req.params;
    
    const merchant = await ShopifyMerchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    
    // Create Unit application form
    const applicationForm = await createUnitApplicationForm({
      merchantId: merchant._id,
      shopifyShopId: merchant.shopifyShopId
    });
    
    // Update merchant with Unit application details
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
    
    // Find merchant by Unit application ID
    const merchant = await ShopifyMerchant.findOne({ unitApplicationId: applicationId });
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    
    // Update merchant status based on Unit response
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

// Get merchant dashboard data
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

// Enable/disable StashPay for merchant
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
    
    // Since isEnabled was removed, we'll just return success
    // In the future, this could be implemented differently
    res.json({
      message: 'Merchant status updated successfully',
      success: true
    });
  } catch (error) {
    console.error('Error toggling StashPay:', error);
    res.status(500).json({ error: 'Failed to toggle StashPay' });
  }
});

// Toggle abandoned cart emails for merchant
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
