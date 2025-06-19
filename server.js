const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const cors = require('cors');
require('dotenv').config();
require('./config/passport');
const WishlistItem = require('./models/WishlistItem');
const authRoutes = require('./routes/auth');
const wishlistRoutes = require('./routes/wishlist');
const bankRoutes = require('./routes/bank');

const app = express();

app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

app.post('/webhook', async (req, res) => {
  console.log('Received webhook raw body:', req.body); // Log raw body for debugging
  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; // Parse if string, use directly if object
  } catch (parseError) {
    console.error('Failed to parse webhook body:', parseError.message);
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }
  console.log('Parsed webhook event:', event);

  if (!(event.topic === 'transfer_completed' || event.topic === 'transfer_failed')) {
    console.log('Unhandled webhook event', event.topic);
    return res.status(200).json({ received: true })
  }

  const wishlistItemId = event._embedded?.transfer?.metadata?.wishlistItemId;
  
  if (!wishlistItemId) {
    console.warn('No wishlistItemId in webhook metadata');
    return res.status(200).json({ received: true })
  }
  
  const wishlistItem = await WishlistItem.findOne({ _id: wishlistItemId });
  
  if (!wishlistItem) {
    console.warn(`Wishlist item ${wishlistItemId} not found for webhook`);
    return res.status(200).json({ received: true })
  }

  const transferId = event._embedded.transfer.id;

  if (!transferId) {
    console.warn('No transferId in webhook metadata');
    return res.status(200).json({ received: true })
  }
  
  const transfer = wishlistItem.transfers.find(t => t.transferId === transferId);

  if (!transfer) {
    console.warn(`Transfer ${transferId} not found in wishlist item ${wishlistItemId}`);
    return res.status(200).json({ received: true })
  }

  const newStatus = event._embedded.transfer.status;
  transfer.status = newStatus;

  if (event.topic === 'transfer_failed' && transfer.type === 'debit') {
    wishlistItem.savings_progress -= transfer.amount; // Decrement on failure
  } else if (event.topic === 'transfer_failed' && transfer.type === 'credit') {
    wishlistItem.savings_progress = transfer.amount; // Replace savings amount
  }

  await wishlistItem.save();
  console.log(`Updated transfer ${transferId} status to ${newStatus} for ${wishlistItemId}, savings_progress: ${wishlistItem.savings_progress}`);

  res.json({ received: true });
});

// Apply middleware for other routes
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
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { secure: false, httpOnly: true, sameSite: 'lax' }
}));
app.use(passport.initialize());
app.use(passport.session());

// Other routes
app.use('/api/auth', authRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/bank', bankRoutes);

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

module.exports = app;