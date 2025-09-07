const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const cors = require('cors');
require('dotenv').config();
require('./config/passport');
const authRoutes = require('./routes/auth');
const savingsGoalRoutes = require('./routes/savingsGoal');
const bankRoutes = require('./routes/bank');
const webhook = require('./webhooks/index');
const { processScheduledPayments } = require('./cron/process-payments');
const launchRoutes = require('./routes/launch');
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

app.use(cors({
  origin: [
    process.env.REACT_APP_URL,
    'https://gostashpay.com',
    'https://sandbox.gostashpay.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(passport.initialize());

app.use('/api/auth', authRoutes);
app.use('/api/savings-goal', savingsGoalRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/launch', launchRoutes);

app.get('/test', (req, res) => {
  res.json({ message: 'Server is running' });
});

app.get('/api/cron/process-payments', async (req, res) => {
  try {
    // Check for token in query parameter (Vercel cron) or Authorization header
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

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

module.exports = app;