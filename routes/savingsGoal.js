const express = require('express');
const router = express.Router();
const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
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

const verificationCodeSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
}, { timestamps: true });

const guestSessionSchema = new mongoose.Schema({
  email: { type: String, required: true },
  guestToken: { type: String, required: true, unique: true },
  plaidToken: { type: String },
  plaidAccountId: { type: String },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
}, { timestamps: true });

const VerificationCode = mongoose.model('VerificationCode', verificationCodeSchema);
const GuestSession = mongoose.model('GuestSession', guestSessionSchema);

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
    res.json(goals);
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
    
    // Find the merchant record to verify shop access
    const User = require('../models/User');
    const ShopifyMerchant = require('../models/ShopifyMerchant');
    
    const user = await User.findById(req.user._id).populate('shopifyMerchantId');
    if (!user || !user.shopifyMerchantId) {
      return res.status(404).json({ error: 'Merchant account not found' });
    }
    
    const merchant = await ShopifyMerchant.findById(user.shopifyMerchantId);
    if (!merchant || merchant.shopDomain !== shopDomain) {
      return res.status(403).json({ error: 'Access denied. You do not have access to this shop.' });
    }
    
    // Find all savings goals for this shop
    const goals = await SavingsGoal.find({ shopDomain }).populate('userId', 'firstName lastName email');
    
    // Calculate status for each goal
    const goalsWithStatus = goals.map(goal => {
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

router.get('/search', requireSavingsAccountUser, async (req, res) => {
  const { q } = req.query;
  try {
    const response = await axios.get('https://serpapi.com/search', {
      params: { api_key: process.env.SERPAPI_KEY, engine: 'google_shopping', q, num: 10 }
    });
    const products = response.data.shopping_results.map(item => ({
      price: parseFloat(item.price?.replace(/[^0-9.]/g, '') || '0') || 0,
      ...item
    }));
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/:id', ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });
    res.json(goal);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch savings goal' });
  }
});

router.post('/shopify', verifyShopifySessionToken, async (req, res) => {
  try {
    const { goalName, description, targetAmount, product } = req.body;

    if (!goalName || !targetAmount) {
      return res.status(400).json({ error: 'Goal name and target amount are required' });
    }

    const savingsGoal = new SavingsGoal({
      goalName,
      description: description || '',
      targetAmount: parseFloat(targetAmount),
      product: product || {},
      source: 'shopify'
    });

    await savingsGoal.save();
    res.status(201).json(savingsGoal);
  } catch (error) {
    console.error('Error creating Shopify savings goal:', error);
    res.status(500).json({ error: 'Failed to create savings goal' });
  }
});

router.post('/send-verification', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await VerificationCode.deleteMany({ email });

    await new VerificationCode({
      email,
      code: verificationCode,
      expiresAt
    }).save();

    const emailResult = await emailService.sendVerificationCode(email, verificationCode);
    
    if (!emailResult.success) {
      console.error('Failed to send verification email:', emailResult.error);
    } else {
      console.log('Verification email sent successfully:', emailResult.messageId);
    }
    
    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email'
    });
  } catch (error) {
    console.error('Error sending verification code:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

router.post('/verify-code', async (req, res) => {
  try {
    const { email, verificationCode } = req.body;
    
    if (!email || !verificationCode) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }
    
    const storedCode = await VerificationCode.findOne({ email, code: verificationCode });
    if (!storedCode) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }
    
    await VerificationCode.deleteOne({ _id: storedCode._id });
    
    const guestToken = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    
    await new GuestSession({
      email,
      guestToken,
      expiresAt
    }).save();
    
    res.status(200).json({
      success: true,
      guestToken,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

router.post('/connect-plaid', async (req, res) => {
  try {
    const { guestToken, emailToken, publicToken, accountId } = req.body;
    console.log(publicToken);
    
    if (!guestToken && !emailToken) {
      return res.status(400).json({ error: 'Either guest token or email token is required' });
    }

    let guestSession;

    const EmailToken = require('../models/EmailToken');
    const emailTokenDoc = await EmailToken.findOne({ 
      token: emailToken, 
      expiresAt: { $gt: new Date() }
    });
    
    if (!emailTokenDoc) {
      return res.status(401).json({ error: 'Invalid or expired email token' });
    }

    guestSession = await GuestSession.findOne({ email: emailTokenDoc.email });
    if (!guestSession) {
      guestSession = new GuestSession({
        email: emailTokenDoc.email,
        guestToken: require('crypto').randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });
      await guestSession.save();
    }

    if (publicToken) {
      console.log('publicToken!!!!!!!!!!!!!');
      try {
        console.log('calling plaidService.exchangePublicToken!!!!!!!!!!!!!');
        const plaidService = new PlaidService();
        const exchangeResp = await plaidService.exchangePublicToken(publicToken);
        console.log('exchangeResp!!!!!!!!!!!!!');
        console.log(exchangeResp.data);
        guestSession.plaidToken = exchangeResp.data.access_token;
        if (accountId) guestSession.plaidAccountId = accountId;
      } catch (ex) {
        console.error('Plaid exchange failed:', ex.message);
        return res.status(500).json({ error: 'Failed to exchange Plaid token' });
      }
    } else {
      return res.status(400).json({ error: 'Plaid token is required' });
    }
    await guestSession.save();
    
    res.status(200).json({
      success: true,
      accessToken: guestSession.plaidToken,
      message: 'Plaid account connected successfully'
    });
  } catch (error) {
    console.error('Error connecting Plaid:', error);
    res.status(500).json({ error: 'Failed to connect Plaid account' });
  }
});

router.post('/plaid/create-link-token', async (req, res) => {
  try {
    const { guestToken, emailToken } = req.body;
    
    if (!guestToken && !emailToken) {
      return res.status(400).json({ error: 'Either guest token or email token is required' });
    }

    let userId;
    let clientName = 'StashPay';

    if (guestToken) {
      const guestSession = await GuestSession.findOne({ guestToken });
      if (!guestSession) {
        return res.status(401).json({ error: 'Invalid or expired guest session' });
      }
      if (new Date() > guestSession.expiresAt) {
        await GuestSession.deleteOne({ _id: guestSession._id });
        return res.status(401).json({ error: 'Guest session expired' });
      }
      userId = guestSession._id;
      clientName = 'StashPay Guest Checkout';
    } else if (emailToken) {
      const EmailToken = require('../models/EmailToken');
      const emailTokenDoc = await EmailToken.findOne({ 
        token: emailToken,
        expiresAt: { $gt: new Date() }
      });
      
      if (!emailTokenDoc) {
        return res.status(401).json({ error: 'Invalid or expired email token' });
      }
      
      userId = emailToken;
      clientName = 'StashPay Savings Plan';
    }

    try {
      const plaidService = new PlaidService();
      const linkTokenResponse = await plaidService.createLinkToken(userId, clientName);
      
      return res.status(200).json({
        success: true,
        linkToken: linkTokenResponse.data.link_token,
        expiration: linkTokenResponse.data.expiration
      });
    } catch (e) {
      console.error('Plaid link token creation error:', e.message);
      console.error('Plaid error details:', e.response?.data || e);
      return res.status(500).json({ 
        error: `Failed to create Plaid link token: ${e.message}`,
        details: e.response?.data || 'No additional details available'
      });
    }
  } catch (e) {
    console.error('Plaid link token error:', e.message);
    return res.status(500).json({ error: 'Failed to create Plaid link token' });
  }
});

router.post('/create-guest-goal', async (req, res) => {
  /** TODO: Adding shipping address section */
  try {
    const { guestToken, emailToken, goalName, description, targetAmount, product, bankDetails } = req.body;
    
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
    let finalProduct = product || {};

    if (emailToken && checkoutData) {
      const shopName = checkoutData.shopDomain?.replace('.myshopify.com', '') || 'Store';
      finalGoalName = `Cart from ${shopName}`;
      finalDescription = 'Save for these items';
  
      finalProduct = {
        type: 'Shopify',
        checkoutId: checkoutData.checkoutId,
        shopDomain: checkoutData.shopDomain,
        currency: checkoutData.currency,
        totalPrice: checkoutData.totalPrice,
        customerId: checkoutData.customerId,
        lineItems: checkoutData.lineItems
      };
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

    const savingsGoal = new SavingsGoal({
      goalName: finalGoalName,
      description: finalDescription,
      targetAmount: parseFloat(targetAmount),
      savingsAmount: savingsAmount,
      product: finalProduct,
      userId: user._id,
      plaidToken: processorToken,
      source: 'guest-checkout',
      bank: bankDetails ? {
        bankName: bankDetails.bankName,
        bankAccountName: bankDetails.bankAccountName,
        bankLastFour: bankDetails.bankLastFour,
        bankAccountType: bankDetails.bankAccountType
      } : undefined,
      schedule: {
        startDate,
        interval: 'Monthly',
        dayOfMonth: startDate.getDate()
      }
    });

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

    const goal = new SavingsGoal({
      userId: req.user._id,
      goalName: goalName || title,
      targetAmount: targetAmount? parseFloat(targetAmount) : price,
      currentAmount: 0,
      product: {
        description,
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
        delivery
      }
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
      goal.product = {
        ...goal.product,
        description
      };
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

router.post('/:id/ai-insights', requireSavingsAccountUser, async (req, res) => {
  try {
    const { type, prompt } = req.body;
    
    if (!type || !prompt) {
      return res.status(400).json({ error: 'Type and prompt are required' });
    }

    const goal = await SavingsGoal.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });

    if (!goal) {
      return res.status(404).json({ error: 'Savings goal not found' });
    }

    if (type === 'description-enhancement') {
      const enhancedDescription = await enhanceDescription(prompt);
      goal.description = enhancedDescription;
      await goal.save();
      
      res.json({ 
        message: 'Description enhanced successfully', 
        enhancedDescription,
        goal 
      });
    } else {
      res.status(400).json({ error: 'Invalid insight type' });
    }
  } catch (error) {
    console.error('xAI API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate AI insights' });
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

    if (!goal.product || Object.keys(goal.product).length === 0) {
      return res.status(400).json({ 
        error: 'Web search is only available for product-type savings goals' 
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

    goal.product = {
      ...goal.product,
      title: productData.title,
      price: productData.price,
      old_price: productData.old_price,
      thumbnail: productData.thumbnail,
      source: productData.source,
      productLink: productData.productLink,
      rating: productData.rating,
      reviews: productData.reviews_count
    };

    await goal.save();
    res.json({ goal, message: 'Product saved successfully' });
  } catch (error) {
    console.error('Save product error:', error);
    res.status(500).json({ error: 'Failed to save product' });
  }
});

module.exports = router;
