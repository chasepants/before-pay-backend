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
  origin: process.env.REACT_APP_URL,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(passport.initialize());

app.use('/api/auth', authRoutes);
app.use('/api/savings-goal', savingsGoalRoutes);
app.use('/api/bank', bankRoutes);

app.get('/test', (req, res) => {
  res.json({ message: 'Server is running' });
});

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

module.exports = app;