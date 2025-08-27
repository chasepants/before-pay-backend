const express = require('express');
const router = express.Router();
const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { OpenAI } = require('openai');

// Initialize xAI client
const xai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

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
    const { id } = req.params;
    const { prompt } = req.body;
    
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });

    // Use xAI's image generation with only supported parameters
    const response = await xai.images.generate({
      model: "grok-2-image",
      prompt: prompt || `Create a profile icon for a savings goal: ${goal.goalName}. ${goal.product?.description || ''}`,
      n: 1
      // Removed 'size' parameter as it's not supported by grok-2-image
    });

    const imageUrl = response.data[0].url;
    
    // Save the generated image URL
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
    const { id } = req.params;
    const { insightType, prompt } = req.body;
    
    const goal = await SavingsGoal.findOne({ _id: id, userId: req.user._id });
    if (!goal) return res.status(404).json({ error: 'Savings goal not found' });

    console.log('Current goal aiInsights:', goal.aiInsights);
    console.log('aiInsights type:', typeof goal.aiInsights);
    console.log(`My description for my savings goal ${goal.goalName} is ${goal.product?.description || goal.description || ''}.`);

    // Try a different approach with Grok-4 or fallback to a simpler model
    if (insightType === 'description-enhancement') {
      try {
        // First try with Grok-4 but with different parameters
        let response;
        try {
          response = await xai.chat.completions.create({
            model: "grok-4",
            messages: [
              {
                role: "system",
                content: "You are a helpful assistant. Make the given description 1-2 sentences longer. Only output the elongated description."
              },
              {
                role: "user", 
                content: `My description for my savings goal ${goal.goalName} is ${goal.product?.description || goal.description || ''}.`
              }
            ],
            max_tokens: 1000, // Much higher to ensure we get output
            temperature: 0.3, // Lower temperature for more focused responses
            top_p: 1.0,
            // Remove frequency and presence penalties that might interfere
          });
        } catch (grokError) {
          console.log('Grok-4 failed, trying with different approach:', grokError.message);
          // Fallback: try with a simpler prompt structure
          response = await xai.chat.completions.create({
            model: "grok-4",
            messages: [
              {
                role: "user", 
                content: `Please make this description longer by 1-2 sentences: "${goal.product?.description || goal.description || ''}". This is for a savings goal called "${goal.goalName}". Just give me the longer description, nothing else.`
              }
            ],
            max_tokens: 1000,
            temperature: 0.1, // Very low temperature for consistent output
          });
        }

        console.log('xAI Response:', response);
        console.log('Message object:', response.choices[0]?.message);
        console.log('Content:', response.choices[0]?.message?.content);
        
        const enhancedDescription = response.choices[0]?.message?.content?.trim();
        
        if (!enhancedDescription) {
          // If still no content, try one more approach with minimal tokens
          console.log('Still no content, trying minimal approach...');
          const minimalResponse = await xai.chat.completions.create({
            model: "grok-4",
            messages: [
              {
                role: "user", 
                content: `Extend this description: "${goal.product?.description || goal.description || ''}"`
              }
            ],
            max_tokens: 200,
            temperature: 0.0, // Deterministic output
          });
          
          const minimalContent = minimalResponse.choices[0]?.message?.content?.trim();
          if (minimalContent) {
            console.log('Minimal approach worked:', minimalContent);
            goal.description = minimalContent;
            await goal.save();
            res.json({ insight: minimalContent, type: insightType });
            return;
          }
          
          throw new Error('All xAI approaches failed to generate content');
        }
        
        console.log('Enhanced description from xAI:', enhancedDescription);
        
        // Update the goal description directly
        goal.description = enhancedDescription;
        
        // Save the updated goal
        try {
          await goal.save();
          console.log('Successfully saved goal with enhanced description');
        } catch (saveError) {
          console.error('Save error:', saveError);
          throw saveError;
        }

        res.json({ insight: enhancedDescription, type: insightType });
      } catch (xaiError) {
        console.error('xAI chat API error:', xaiError.response?.data || xaiError.message);
        res.status(500).json({ error: 'Failed to generate enhanced description with AI' });
      }
    } else {
      // For other insight types, keep the existing hardcoded responses
      let insight;
      switch (insightType) {
        case 'web-search':
          insight = `I can search the web for deals on ${goal.goalName}. Would you like me to look for current prices, discounts, or similar products?`;
          break;
        case 'trip-planning':
          insight = `For your ${goal.goalName} trip, I can help with itinerary planning, budget breakdown, and travel tips. What would you like to know?`;
          break;
        case 'savings-tips':
          insight = `Here are some tips to reach your ${goal.goalName} goal faster: 1) Set up automatic transfers, 2) Look for side income opportunities, 3) Cut unnecessary expenses.`;
          break;
        default:
          insight = `I can help you with your ${goal.goalName} goal in several ways. What would you like assistance with?`;
      }

      res.json({ insight, type: insightType });
    }
  } catch (error) {
    console.error('AI insights error:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
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
