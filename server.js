const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const cors = require('cors');
require('dotenv').config();
require('./config/passport');
const authRoutes = require('./routes/auth');
const savingsGoalRoutes = require('./routes/savingsGoal');
const bankRoutes = require('./routes/bank');
const webhook = require('./webhooks/index');

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Unit Webhook
app.post('/webhook', async (req, res) => {
  try {
    await webhook(req, res);
  } catch (error) {
    console.error('Webhook invocation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Middleware
app.use(cors({
  origin: process.env.REACT_APP_URL,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'beforepay-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    ttl: 14 * 24 * 60 * 60,
    autoRemove: 'native',
    touchAfter: 24 * 60 * 60
  }),
  cookie: { 
    secure: process.env.NODE_ENV === 'production' ? true : false,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 14 * 24 * 60 * 60 * 1000,
    domain: process.env.COOKIE_DOMAIN
  }
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', authRoutes);
app.use('/api/savings-goal', savingsGoalRoutes);
app.use('/api/bank', bankRoutes);

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

module.exports = app;