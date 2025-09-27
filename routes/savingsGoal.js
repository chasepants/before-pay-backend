const express = require('express');
const router = express.Router();
const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { OpenAI } = require('openai');
require('dotenv').config();
const { generateImage, enhanceDescription } = require('../services/xaiService');
const { searchProducts } = require('../services/webSearchService');
const { ensureAuthenticated } = require('../middleware/auth');
const { verifyShopifySessionToken } = require('../middleware/shopifyAuth');

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

router.get('/search', ensureAuthenticated, async (req, res) => {
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

// Shopify endpoint for extensions (uses Shopify session token auth)
router.post('/shopify', verifyShopifySessionToken, async (req, res) => {
  try {
    const { goalName, description, targetAmount, product } = req.body;
    
    // Validate required fields
    if (!goalName || !targetAmount) {
      return res.status(400).json({ error: 'Goal name and target amount are required' });
    }

    // Create savings goal without userId (for Shopify)
    const savingsGoal = new SavingsGoal({
      goalName,
      description: description || '',
      targetAmount: parseFloat(targetAmount),
      product: product || {},
      // No userId for Shopify-created goals
      source: 'shopify'
    });

    await savingsGoal.save();
    res.status(201).json(savingsGoal);
  } catch (error) {
    console.error('Error creating Shopify savings goal:', error);
    res.status(500).json({ error: 'Failed to create savings goal' });
  }
});

router.post('/', ensureAuthenticated, async (req, res) => {
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

router.delete('/:id', ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    const savingsGoal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!savingsGoal) return res.status(404).json({ error: 'Savings goal not found' });
    await SavingsGoal.deleteOne({ _id: id, userId: req.user._id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete savings goal' });
  }
});

router.put('/:id', ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { goalName, description, targetAmount } = req.body;
  console.log(req.body)
  try {
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });
    
    if (goalName !== undefined) goal.goalName = goalName;
    if (description !== undefined) {
      goal.product = {
        description,
        ...goal.product
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

router.post('/:id/generate-image', ensureAuthenticated, async (req, res) => {
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

router.post('/:id/ai-insights', ensureAuthenticated, async (req, res) => {
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

router.post('/:id/web-search', ensureAuthenticated, async (req, res) => {
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

router.post('/:id/save-product', ensureAuthenticated, async (req, res) => {
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
