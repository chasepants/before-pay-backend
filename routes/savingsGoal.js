const express = require('express');
const router = express.Router();
const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { OpenAI } = require('openai');
require('dotenv').config();
const { generateImage, enhanceDescription } = require('../services/xaiService');

const ensureAuthenticated = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized: User not found' });
    req.user = user;
    next();
  } catch (err) {
    console.error('Token verification error:', err);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const goals = await SavingsGoal.find({ userId: req.user._id });
    res.json(goals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch savings goals' });
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

// Fix the ai-insights endpoint with better debugging and error handling
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
    const { id } = req.params;
    const { searchQuery } = req.body;
    
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });

    // Only allow web search for product-type goals
    if (goal.category !== 'product') {
      return res.status(400).json({ error: 'Web search is only available for product-type savings goals' });
    }

    // Use SerpAPI to search for products
    const response = await axios.get('https://serpapi.com/search', {
      params: { 
        api_key: process.env.SERPAPI_KEY, 
        engine: 'google_shopping', 
        q: searchQuery || goal.goalName, 
        num: 10 
      }
    });
    response.data.shopping_results.forEach(item => {
      console.log(item);
    });
    const products = response.data.shopping_results?.map(item => ({
      title: item.title,
      price: parseFloat(item.price?.replace(/[^0-9.]/g, '') || '0') || 0,
      old_price: item.old_price,
      thumbnail: item.thumbnail,
      source: item.source,
      productLink: item.product_link,
      rating: item.rating,
      reviews: item.reviews_count
    })) || [];

    res.json({ products, searchQuery: searchQuery || goal.goalName });
  } catch (error) {
    console.error('Web search error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to search for products' });
  }
});

router.post('/:id/save-product', ensureAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const { productData } = req.body;
    
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });

    // Update the goal with the selected product
    goal.product = {
      ...goal.product, // Keep existing product data
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

module.exports = router;
