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
const User = require('./models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');

const app = express();
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Unit Webhook
app.post('/webhook', async (req, res) => {
  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!Array.isArray(event.data)) {
      console.error('Invalid webhook payload: data is not an array');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }
  } catch (parseError) {
    console.error('Failed to parse webhook body:', parseError.message);
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  for (const eventData of event.data) {
    if (eventData.type === 'application.approved') {
      const applicationId = eventData.data.id;
      const user = await User.findOne({ unitApplicationId: applicationId });
      if (user) {
        user.status = 'approved';
        await user.save();
        console.log(`User ${user.email} application approved`);
      }
    } else if (eventData.type === 'customer.created') {
      const applicationId = eventData.relationships.application.data.id;
      const unitCustomerId = eventData.relationships.customer.data.id;
      const user = await User.findOne({ unitApplicationId: applicationId });
      if (user) {
        user.status = 'approved';
        user.unitCustomerId = unitCustomerId;

        // Create deposit account
        const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');
        const depositAccountRequest = {
          type: 'depositAccount',
          attributes: {
            depositProduct: 'checking',
            tags: {
              purpose: 'savings',
            },
            idempotencyKey: `${user.email}-deposit-${Date.now()}`
          },
          relationships: {
            customer: {
              data: {
                type: 'customer',
                id: unitCustomerId
              }
            }
          }
        };
        try {
          const accountResponse = await unit.accounts.create(depositAccountRequest);
          user.unitAccountId = accountResponse.data.id; // Store the created account ID
          await user.save();
          console.log(`Deposit account created for user ${user.email} with accountId: ${user.unitAccountId}`);
        } catch (accountError) {
          console.error('Failed to create deposit account:', accountError.message, accountError.stack);
          // Optionally roll back status change if account creation fails
          user.status = 'pending';
          await user.save();
          return res.status(500).json({ error: 'Failed to create deposit account' });
        }

        console.log(`User ${user.email} customer created with unitCustomerId: ${unitCustomerId}`);
      } else {
        console.warn(`No user found for applicationId: ${applicationId}`);
      }
    }
  }
  res.status(200).json({ received: true }); // Acknowledge receipt
});

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
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
  cookie: { secure: false, httpOnly: true, sameSite: 'lax' }
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', authRoutes);
app.use('/api/savings-goal', savingsGoalRoutes);
app.use('/api/bank', bankRoutes);

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('MongoDB connected');
    mongoose.connection.db.collection('sessions').createIndex({ "expiresAt": 1 }, { expireAfterSeconds: 0 }, (err) => {
      if (err) console.error('Failed to create session index:', err);
      else console.log('Session index created');
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));

module.exports = app;