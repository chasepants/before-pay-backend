const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const cors = require('cors');
require('dotenv').config();
require('./config/passport');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const savingsGoalRoutes = require('./routes/savingsGoal');
const bankRoutes = require('./routes/bank');
const launchRoutes = require('./routes/launch');
const shopifyMerchantRoutes = require('./routes/shopifyMerchant');
const webhookRoutes = require('./routes/webhooks');
const testRoutes = require('./routes/test');
const cronRoutes = require('./routes/cron');
const checkoutCartRoutes = require('./routes/checkoutCart');
const emailTokenRoutes = require('./routes/emailToken');
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

// ============================================================================
// CORS Configuration & Middleware
// ============================================================================
app.use(cors(corsOptions));

// CORS preflight handlers
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

// CORS response headers middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  next();
});

// ============================================================================
// Body Parsing Middleware
// ============================================================================
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// ============================================================================
// Logging Middleware
// ============================================================================
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

// ============================================================================
// Authentication Middleware
// ============================================================================
app.use(passport.initialize());

// ============================================================================
// API Routes
// ============================================================================
app.use('/api/webhooks', webhookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/savings-goal', savingsGoalRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/products', require('./routes/products'));
app.use('/api/launch', launchRoutes);
app.use('/api/shopify-merchant', shopifyMerchantRoutes);
app.use('/api/checkout-cart', checkoutCartRoutes);
app.use('/api/email-token', emailTokenRoutes);
app.use('/api/validate-email-token', emailTokenRoutes); // Backward compatibility

// ============================================================================
// Test & Cron Routes
// ============================================================================
// All test routes under /api/test
app.use('/api/test', testRoutes);
// Production cron routes (called by Vercel)
app.use('/api/cron', cronRoutes);

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

module.exports = app;