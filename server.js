const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const cors = require('cors');
require('dotenv').config();
require('./config/passport');
const authRoutes = require('./routes/auth');
const savingsGoalRoutes = require('./routes/savingsGoal');
const bankRoutes = require('./routes/bank');
const { webhook } = require('./webhooks/index');
const shopifyPubsub = require('./webhooks/shopifyPubsub');
const { processScheduledPayments } = require('./cron/process-payments');
const { processAbandonedCarts } = require('./cron/abandoned-carts');
const launchRoutes = require('./routes/launch');
const shopifyMerchantRoutes = require('./routes/shopifyMerchant');
const app = express();

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.REACT_APP_URL,
      'https://gostashpay.com',
      'https://sandbox.gostashpay.com',
      'http://localhost:3000',
      'http://localhost:3001',
      'https://extensions.shopifycdn.com',
      'https://admin.shopify.com',
      'https://stashpay-2.myshopify.com',
      /^https:\/\/.*\.myshopify\.com$/,
      /^https:\/\/.*\.shopifypreview\.com$/,
      /^https:\/\/.*\.vercel\.app$/,
      /^https:\/\/.*\.vercel\.com$/,
      /^https:\/\/.*\.trycloudflare\.com$/
    ];
    
    console.log('Checking origin:', origin);
    console.log('Allowed origins:', allowedOrigins.map(o => o.toString()));
    
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return allowedOrigin === origin;
      } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      console.log('CORS allowed origin:', origin);
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      console.log('Allowed origins:', allowedOrigins.map(o => o.toString()));
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE', 'PUT', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} from origin: ${req.headers.origin || 'no-origin'}`);
  console.log('Headers:', {
    'access-control-request-method': req.headers['access-control-request-method'],
    'access-control-request-headers': req.headers['access-control-request-headers'],
    'content-type': req.headers['content-type'],
    'authorization': req.headers['authorization'] ? 'present' : 'missing',
    'user-agent': req.headers['user-agent'],
    'referer': req.headers['referer']
  });
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request detected - CORS preflight');
  }
  
  next();
});

app.options('*', (req, res) => {
  const origin = req.headers.origin;
  console.log('OPTIONS request from origin:', origin);
  
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  next();
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} from origin: ${req.headers.origin || 'no-origin'}`);
  console.log('Headers:', {
    'access-control-request-method': req.headers['access-control-request-method'],
    'access-control-request-headers': req.headers['access-control-request-headers'],
    'content-type': req.headers['content-type'],
    'authorization': req.headers['authorization'] ? 'present' : 'missing',
    'user-agent': req.headers['user-agent'],
    'referer': req.headers['referer']
  });
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request detected - CORS preflight');
  }
  
  next();
});

app.post('/webhook', async (req, res) => {
  try {
    await webhook(req, res);
  } catch (error) {
    console.error('Webhook invocation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/webhooks/shopify-pubsub', async (req, res) => {
  try {
    await shopifyPubsub(req, res);
  } catch (error) {
    console.error('Pub/Sub route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/webhooks/shopify-pubsub', async (req, res) => {
  try {
    await shopifyPubsub(req, res);
  } catch (error) {
    console.error('Pub/Sub route error (alias):', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use(passport.initialize());

app.options('/api/*', (req, res) => {
  const origin = req.headers.origin;
  console.log('API OPTIONS request from origin:', origin);
  
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

app.options('/api/savings-goal', (req, res) => {
  const origin = req.headers.origin;
  console.log('Savings Goal OPTIONS request from origin:', origin);
  
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

app.use('/api/auth', authRoutes);
app.use('/api/savings-goal', savingsGoalRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/launch', launchRoutes);
app.use('/api/shopify-merchant', shopifyMerchantRoutes);

app.get('/test', (req, res) => {
  res.json({ 
    message: 'Server is running',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/cors-test', (req, res) => {
  res.json({ 
    message: 'CORS test successful',
    origin: req.headers.origin,
    method: req.method,
    headers: req.headers
  });
});

app.options('/api/cors-test', (req, res) => {
  const origin = req.headers.origin;
  console.log('CORS Test OPTIONS request from origin:', origin);
  
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.get('/api/savings-goal-test', (req, res) => {
  res.json({ 
    message: 'Savings goal CORS test successful',
    origin: req.headers.origin,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

app.options('/api/savings-goal-test', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.get('/api/cron/process-payments', async (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    if (token !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    console.log('Cron job started at:', new Date().toISOString());
    await processScheduledPayments();
    console.log('Cron job completed at:', new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    console.error('Cron route error:', e);
    res.status(500).json({ error: 'Cron failed' });
  }
});

app.get('/api/cron/abandoned-carts', async (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    if (token !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    console.log('Abandoned carts cron job started at:', new Date().toISOString());
    await processAbandonedCarts();
    console.log('Abandoned carts cron job completed at:', new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    console.error('Abandoned carts cron route error:', e);
    res.status(500).json({ error: 'Abandoned carts cron failed' });
  }
});

app.get('/api/checkout-cart/:checkoutId', async (req, res) => {
  try {
    const { checkoutId } = req.params;
    const CheckoutCart = require('./models/CheckoutCart');
    
    const checkout = await CheckoutCart.findOne({ checkoutId });
    if (!checkout) {
      return res.status(404).json({ error: 'Checkout not found' });
    }
    
    res.json(checkout);
  } catch (error) {
    console.error('Error fetching checkout cart:', error);
    res.status(500).json({ error: 'Failed to fetch checkout data' });
  }
});

// Validate email token and get checkout data
app.get('/api/validate-email-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const EmailToken = require('./models/EmailToken');
    const CheckoutCart = require('./models/CheckoutCart');

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

    // Mark token as used
    emailToken.used = true;
    await emailToken.save();

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

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

module.exports = app;