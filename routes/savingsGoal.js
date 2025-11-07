const express = require('express');
const router = express.Router();
const SavingsGoal = require('../models/SavingsGoal');
const { ManualSavingsGoal, ShopifySavingsGoal } = require('../models/SavingsGoal');
const User = require('../models/User');
const CheckoutCart = require('../models/CheckoutCart');
const ShopifyMerchant = require('../models/ShopifyMerchant');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');
require('dotenv').config();
const { generateImage, enhanceDescription } = require('../services/xaiService');
const { searchProducts } = require('../services/webSearchService');
const { ensureAuthenticated, requireSavingsAccountUser } = require('../middleware/auth');
const { verifyShopifySessionToken } = require('../middleware/shopifyAuth');
const emailService = require('../services/emailService');
const PlaidService = require('../services/plaidService');
const UnitService = require('../services/unitService');

const VerificationCode = require('../models/VerificationCode');
const GuestSession = require('../models/GuestSession');

router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  console.log(`Savings Goal ${req.method} ${req.path} from origin: ${origin || 'no-origin'}`);
  next();
});

router.options('*', (req, res) => {
  const origin = req.headers.origin;
  console.log('Savings Goal OPTIONS request from origin:', origin);
  
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const goals = await SavingsGoal.find({ userId: req.user._id });
    
    // For Shopify goals, fetch and attach checkout cart data
    const goalsWithCarts = await Promise.all(goals.map(async (goal) => {
      if (goal.__t === 'ShopifySavingsGoal' && goal.checkoutCartId) {
        const cart = await CheckoutCart.findById(goal.checkoutCartId);
        if (cart) {
          goal.checkoutCartId = cart; // Replace ObjectId with full cart object
        }
      }
      return goal;
    }));
    
    res.json(goalsWithCarts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch savings goals' });
  }
});

// Get savings goals for a specific merchant (shop)
router.get('/merchant/:shopDomain', ensureAuthenticated, async (req, res) => {
  try {
    const { shopDomain } = req.params;
    
    // Verify the user is a merchant and has access to this shop
    if (req.user.userType !== 'merchant') {
      return res.status(403).json({ error: 'Access denied. Only merchants can access this endpoint.' });
    }

    const user = await User.findById(req.user._id).populate('shopifyMerchantId');
    if (!user || !user.shopifyMerchantId) {
      return res.status(404).json({ error: 'Merchant account not found' });
    }
    
    const merchant = await ShopifyMerchant.findById(user.shopifyMerchantId);
    if (!merchant || merchant.shopDomain !== shopDomain) {
      return res.status(403).json({ error: 'Access denied. You do not have access to this shop.' });
    }
    
    // Find all savings goals for this shop
    const goals = await SavingsGoal.find({ __t: 'ShopifySavingsGoal', shopDomain: shopDomain })
      .populate('userId', 'firstName lastName email');
    
    // Fetch and attach checkout cart data for Shopify goals
    const goalsWithCarts = await Promise.all(goals.map(async (goal) => {
      if (goal.checkoutCartId) {
        const cart = await CheckoutCart.findById(goal.checkoutCartId);
        if (cart) {
          goal.checkoutCartId = cart; // Replace ObjectId with full cart object
        }
      }
      return goal;
    }));
    
    // Calculate status for each goal
    const goalsWithStatus = goalsWithCarts.map(goal => {
      const isCompleted = goal.currentAmount >= goal.targetAmount;
      const isOngoing = goal.currentAmount > 0 && goal.currentAmount < goal.targetAmount;
      const isNotStarted = goal.currentAmount === 0;
      
      return {
        ...goal.toObject(),
        status: isCompleted ? 'completed' : (isOngoing ? 'ongoing' : 'not_started'),
        progressPercentage: Math.round((goal.currentAmount / goal.targetAmount) * 100)
      };
    });
    
    res.json(goalsWithStatus);
  } catch (error) {
    console.error('Error fetching merchant savings goals:', error);
    res.status(500).json({ error: 'Failed to fetch merchant savings goals' });
  }
});

router.get('/:id', ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });
    
    // If it's a Shopify goal, fetch and attach the checkout cart
    if (goal.__t === 'ShopifySavingsGoal' && goal.checkoutCartId) {
      const cart = await CheckoutCart.findById(goal.checkoutCartId);
      if (cart) {
        goal.checkoutCartId = cart; // Replace ObjectId with full cart object
      }
    }
    
    res.json(goal);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch savings goal' });
  }
});

router.get('/:id/transactions', ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    const savingsGoal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!savingsGoal) return res.status(404).json({ error: 'Savings goal not found' });
    
    const transactions = savingsGoal.transfers.map(transfer => ({
      date: transfer.date.getTime() / 1000,
      amount: transfer.amount,
      status: transfer.status,
      type: transfer.type,
      transferId: transfer.transferId,
      batchId: transfer.batchId
    }));
    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/shopify', verifyShopifySessionToken, async (req, res) => {
  try {
    const { goalName, description, targetAmount, checkoutCartId, shopDomain } = req.body;

    if (!goalName || !targetAmount) {
      return res.status(400).json({ error: 'Goal name and target amount are required' });
    }

    if (!checkoutCartId || !shopDomain) {
      return res.status(400).json({ error: 'checkoutCartId and shopDomain are required for Shopify goals' });
    }

    const savingsGoal = new ShopifySavingsGoal({
      goalName,
      description: description || '',
      targetAmount: parseFloat(targetAmount),
      checkoutCartId,
      shopDomain
    });

    await savingsGoal.save();
    res.status(201).json(savingsGoal);
  } catch (error) {
    console.error('Error creating Shopify savings goal:', error);
    res.status(500).json({ error: 'Failed to create savings goal' });
  }
});

router.post('/guest', async (req, res) => {
  /** TODO: Adding shipping address section */
  try {
    const { guestToken, emailToken, goalName, description, targetAmount, bankDetails } = req.body;
    
    if ((!guestToken && !emailToken) || !goalName || !targetAmount) {
      return res.status(400).json({ error: 'Either guest token or email token, goal name, and target amount are required' });
    }

    let guestSession;

    if (guestToken) {
      guestSession = await GuestSession.findOne({ guestToken });
      if (!guestSession) {
        return res.status(401).json({ error: 'Invalid or expired guest session' });
      }
      if (new Date() > guestSession.expiresAt) {
        await GuestSession.deleteOne({ _id: guestSession._id });
        return res.status(401).json({ error: 'Guest session expired' });
      }
      if (!guestSession.plaidToken) {
        return res.status(401).json({ error: 'No Plaid account linked. Please link your bank account first.' });
      }
    } else if (emailToken) {
      const EmailToken = require('../models/EmailToken');
      const CheckoutCart = require('../models/CheckoutCart');
      
      const emailTokenDoc = await EmailToken.findOne({ 
        token: emailToken, 
        expiresAt: { $gt: new Date() }
      });
      
      if (!emailTokenDoc) {
        return res.status(401).json({ error: 'Invalid or expired email token' });
      }
      
      guestSession = await GuestSession.findOne({ email: emailTokenDoc.email });
      if (!guestSession || !guestSession.plaidToken) {
        return res.status(401).json({ error: 'No Plaid account linked. Please link your bank account first.' });
      }
      
      var checkoutData = await CheckoutCart.findOne({ 
        checkoutId: emailTokenDoc.checkoutId,
        email: emailTokenDoc.email 
      });
      
      if (!checkoutData) {
        return res.status(404).json({ error: 'Checkout data not found' });
      }
    }
    
    const savingsAmount = parseFloat(targetAmount) / 4;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1);

    const user = await User.findOne({ email: guestSession.email });
    if (!user) {
      return res.status(400).json({ error: 'User account not found. Please create your account first.' });
    }

    let finalGoalName = goalName;
    let finalDescription = description || '';
    let checkoutCartId = null;
    let shopDomain = null;

    if (emailToken && checkoutData) {
      const shopName = checkoutData.shopDomain?.replace('.myshopify.com', '') || 'Store';
      finalGoalName = `Cart from ${shopName}`;
      finalDescription = 'Save for these items';
      
      // Find or create CheckoutCart
      let cart = await CheckoutCart.findOne({ checkoutId: checkoutData.checkoutId });
      if (!cart) {
        cart = new CheckoutCart({
          checkoutId: checkoutData.checkoutId,
          email: checkoutData.email || emailTokenDoc.email,
          shopDomain: checkoutData.shopDomain,
          totalPrice: checkoutData.totalPrice,
          customerFirstName: checkoutData.customerFirstName,
          customerLastName: checkoutData.customerLastName,
          customerId: checkoutData.customerId,
          lineItems: checkoutData.lineItems || []
        });
        await cart.save();
      }
      checkoutCartId = cart._id;
      shopDomain = checkoutData.shopDomain;
    }

    const plaidService = new PlaidService();
    let processorToken;
    try {
      const processorTokenResponse = await plaidService.createProcessorToken(
        guestSession.plaidToken, 
        guestSession.plaidAccountId
      );
      processorToken = processorTokenResponse.data.processor_token;
    } catch (error) {
      console.error('Failed to create processor token:', error);
      return res.status(500).json({ error: 'Failed to create processor token for bank account' });
    }

    // Create appropriate goal type based on whether it's Shopify or manual
    let savingsGoal;
    if (checkoutCartId && shopDomain) {
      // Shopify goal
      savingsGoal = new ShopifySavingsGoal({
        goalName: finalGoalName,
        description: finalDescription,
        targetAmount: parseFloat(targetAmount),
        savingsAmount: savingsAmount,
        checkoutCartId,
        shopDomain,
        userId: user._id,
        bank: {
          ...(bankDetails ? {
            bankName: bankDetails.bankName,
            bankAccountName: bankDetails.bankAccountName,
            bankLastFour: bankDetails.bankLastFour,
            bankAccountType: bankDetails.bankAccountType
          } : {}),
          plaidToken: processorToken
        },
        schedule: {
          startDate,
          interval: 'Monthly',
          dayOfMonth: startDate.getDate()
        }
      });
    } else {
      // Manual goal
      savingsGoal = new ManualSavingsGoal({
        goalName: finalGoalName,
        description: finalDescription,
        targetAmount: parseFloat(targetAmount),
        savingsAmount: savingsAmount,
        category: 'other',
        userId: user._id,
        bank: {
          ...(bankDetails ? {
            bankName: bankDetails.bankName,
            bankAccountName: bankDetails.bankAccountName,
            bankLastFour: bankDetails.bankLastFour,
            bankAccountType: bankDetails.bankAccountType
          } : {}),
          plaidToken: processorToken
        },
        schedule: {
          startDate,
          interval: 'Monthly',
          dayOfMonth: startDate.getDate()
        }
      });
    }

    await savingsGoal.save();

    // Mark email token as used if it was provided
    if (emailToken) {
      const EmailToken = require('../models/EmailToken');
      await EmailToken.updateOne(
        { token: emailToken },
        { used: true }
      );
    }

    const firstInstallmentDate = new Date();
    firstInstallmentDate.setDate(firstInstallmentDate.getDate() + 1);
    
    res.status(201).json({
      success: true,
      savingsGoal,
      firstInstallmentDate: firstInstallmentDate.toISOString(),
      message: 'Savings goal created successfully'
    });
  } catch (error) {
    console.error('Error creating guest savings goal:', error);
    res.status(500).json({ error: 'Failed to create savings goal' });
  }
});

router.post('/', requireSavingsAccountUser, async (req, res) => {
  try {
    const {
      goalName,
      description,
      targetAmount,
      category,
      productLink,
      title,
      price,
      old_price,
      extracted_price,
      extracted_old_price,
      product_id,
      serpapi_product_api,
      thumbnail,
      source,
      source_icon,
      rating,
      reviews,
      badge,
      tag,
      delivery
    } = req.body;

    // Build Google Shopping data if provided
    const googleShoppingData = (title || price || productLink) ? [{
      productLink,
      title,
      price,
      old_price,
      extracted_price: extracted_price ? parseFloat(extracted_price) : undefined,
      extracted_old_price: extracted_old_price ? parseFloat(extracted_old_price) : undefined,
      product_id,
      serpapi_product_api,
      thumbnail,
      source,
      source_icon,
      rating,
      reviews,
      badge,
      tag,
      delivery,
      description
    }].filter(item => Object.values(item).some(v => v !== undefined && v !== null)) : [];

    const goal = new ManualSavingsGoal({
      userId: req.user._id,
      goalName: goalName || title,
      description: description || '',
      targetAmount: targetAmount ? parseFloat(targetAmount) : (price ? parseFloat(price) : 0),
      currentAmount: 0,
      category: category || 'other',
      googleShoppingData,
      manualProductLink: productLink,
      manualTitle: title,
      manualPrice: price
    });
    await goal.save();
    res.status(201).json(goal);
  } catch (error) {
    console.error('Savings goal creation error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to create savings goal' });
  }
});

router.delete('/:id', requireSavingsAccountUser, async (req, res) => {
  const { id } = req.params;
  try {
    const savingsGoal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!savingsGoal) return res.status(404).json({ error: 'Savings goal not found' });
    await SavingsGoal.deleteOne({ _id: id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete savings goal' });
  }
});

router.put('/:id', requireSavingsAccountUser, async (req, res) => {
  const { id } = req.params;
  const { goalName, description, targetAmount } = req.body;
  console.log(req.body)
  try {
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });
    
    if (goalName !== undefined) goal.goalName = goalName;
    if (description !== undefined) {
      goal.description = description;
    }
    if (targetAmount !== undefined) {
      goal.targetAmount = parseFloat(targetAmount);
    }

    await goal.save();
    res.json(goal);
  } catch (err) {
    console.error('Update goal error:', err);
    res.status(500).json({ error: 'Failed to update savings goal' });
  }
});

router.patch('/:id/pause', ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { isPaused } = req.body;
  console.log(id, isPaused)
  try {
    const updated = await SavingsGoal.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      { $set: { isPaused: !!isPaused } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Savings goal not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pause state' });
  }
});

router.post('/:id/generate-image', requireSavingsAccountUser, async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const goal = await SavingsGoal.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });

    if (!goal) {
      return res.status(404).json({ error: 'Savings goal not found' });
    }

    const imageUrl = await generateImage(prompt);
    
    goal.aiGeneratedImage = imageUrl;
    await goal.save();

    res.json({ imageUrl, goal });
  } catch (error) {
    console.error('xAI API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

router.post('/:id/web-search', requireSavingsAccountUser, async (req, res) => {
  try {
    const { searchQuery } = req.body;
    
    const goal = await SavingsGoal.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });

    if (!goal) {
      return res.status(404).json({ error: 'Savings goal not found' });
    }

    // Web search is only available for manual goals
    if (!(goal instanceof ManualSavingsGoal)) {
      return res.status(400).json({ 
        error: 'Web search is only available for manual savings goals' 
      });
    }

    if (!searchQuery || searchQuery.trim() === '') {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchResults = await searchProducts(searchQuery, goal.category);

    res.json({
      results: searchResults.results,
      query: searchQuery,
      goalId: goal._id,
      goalName: goal.goalName,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      category: goal.category,
      totalResults: searchResults.totalResults,
      success: searchResults.success
    });

  } catch (error) {
    console.error('Web search error:', error.message);
    res.status(500).json({ error: 'Failed to perform web search' });
  }
});

router.post('/:id/save-product', requireSavingsAccountUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { productData } = req.body;
    
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });

    // Only manual goals can save product data
    if (!(goal instanceof ManualSavingsGoal)) {
      return res.status(400).json({ error: 'Product data can only be saved for manual savings goals' });
    }

    // Add or update Google Shopping data
    const newProductData = {
      title: productData.title,
      price: productData.price,
      old_price: productData.old_price,
      thumbnail: productData.thumbnail,
      source: productData.source,
      productLink: productData.productLink,
      rating: productData.rating,
      reviews: productData.reviews_count
    };

    // Replace first item or add new
    if (goal.googleShoppingData && goal.googleShoppingData.length > 0) {
      goal.googleShoppingData[0] = { ...goal.googleShoppingData[0], ...newProductData };
    } else {
      goal.googleShoppingData = [newProductData];
    }

    await goal.save();
    res.json({ goal, message: 'Product saved successfully' });
  } catch (error) {
    console.error('Save product error:', error);
    res.status(500).json({ error: 'Failed to save product' });
  }
});

router.post('/:id/refund', ensureAuthenticated, async (req, res) => {
  try {
    const savingsGoalId = req.params.id;
    
    // Find the savings goal
    const goal = await SavingsGoal.findById(savingsGoalId);
    if (!goal) {
      return res.status(404).json({ error: 'Savings goal not found' });
    }
    
    // Verify user owns the goal
    if (!goal.userId || goal.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized. You do not own this savings goal.' });
    }
    
    // Verify it's a Shopify order
    if (!(goal instanceof ShopifySavingsGoal)) {
      return res.status(400).json({ error: 'Refunds are only available for Shopify orders.' });
    }
    
    // Check all transfers are completed or failed (no pending)
    const hasPendingTransfers = goal.transfers && goal.transfers.some(
      transfer => transfer.status === 'pending'
    );
    
    if (hasPendingTransfers) {
      return res.status(400).json({ 
        error: 'Cannot refund while payments are processing. Please wait for all payments to complete or fail.' 
      });
    }
    
    // Verify there's something to refund
    if (!goal.currentAmount || goal.currentAmount <= 0) {
      return res.status(400).json({ error: 'No amount available for refund.' });
    }
    
    // Verify goal has bank account linked
    if (!goal.bank?.plaidToken) {
      return res.status(400).json({ error: 'No bank account linked to this savings goal.' });
    }
    
    // Find merchant account via shopDomain
    if (!goal.shopDomain) {
      return res.status(400).json({ error: 'Shop domain not found in savings goal.' });
    }
    
    const merchant = await ShopifyMerchant.findOne({ shopDomain: goal.shopDomain });
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found for this shop.' });
    }
    
    if (!merchant.unitAccountId) {
      return res.status(400).json({ error: 'Merchant account not set up. Cannot process refund.' });
    }
    
    // Create ACH credit payment from merchant account to user's bank
    let unitService;
    try {
      unitService = new UnitService();
    } catch (error) {
      console.error('Failed to initialize UnitService:', error.message);
      return res.status(500).json({ 
        error: 'Payment service configuration error. Please contact support.' 
      });
    }
    const refundAmount = goal.currentAmount;
    
    const ach = await unitService.createPayment({
      type: 'achPayment',
      attributes: {
        amount: Math.round(refundAmount * 100), // Convert to cents
        direction: 'Credit',
        description: 'Refund for Shopify Order',
        plaidProcessorToken: goal.bank.plaidToken,
        tags: { 
          savingsGoalId: goal._id.toString(), 
          userId: req.user._id.toString(), 
          type: 'shopifyRefund' 
        }
      },
      relationships: {
        account: { data: { type: 'account', id: merchant.unitAccountId } }
      }
    });
    
    // Add refund transfer to goal
    goal.transfers.push({
      transferId: ach.data.id,
      amount: refundAmount,
      date: new Date(),
      status: 'pending',
      type: 'credit'
    });
    
    // Pause the goal and clear savings amount
    goal.isPaused = true;
    goal.savingsAmount = 0;
    
    await goal.save();
    
    console.log(`Refund initiated for Shopify order ${savingsGoalId}: $${refundAmount}`);
    
    res.json({
      success: true,
      paymentId: ach.data.id,
      amount: refundAmount,
      message: 'Refund initiated successfully. The savings plan has been paused.'
    });
    
  } catch (error) {
    console.error('Refund error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to process refund: ' + (error.message || 'Unknown error') });
  }
});

module.exports = router;
