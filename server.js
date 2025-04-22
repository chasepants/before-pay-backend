const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();
require('./config/passport');

const authRoutes = require('./routes/auth');
const wishlistRoutes = require('./routes/wishlist');
const bankRoutes = require('./routes/bank');
const User = require('./models/User');
const WishlistItem = require('./models/WishlistItem');

const app = express();

// Webhook endpoint (no auth, raw body)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('Webhook event received:', event.type);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'invoice.payment_succeeded') {
    const subscriptionId = event.data.object.subscription;
    const amount = event.data.object.amount_paid / 100;
    console.log('Processing invoice.payment_succeeded:', { subscriptionId, amount });
    try {
      const wishlistItem = await WishlistItem.findOne({ subscriptionId });
      if (wishlistItem) {
        wishlistItem.savings_progress += amount;
        const user = await User.findById(wishlistItem.userId);
        user.totalSavings += amount;
        await wishlistItem.save();
        await user.save();
        console.log('Savings updated for wishlist item:', wishlistItem._id);
      } else {
        console.log('No wishlist item found for subscription:', subscriptionId);
      }
    } catch (error) {
      console.error('Error updating savings:', error);
    }
  }

  res.json({ received: true });
});

// Apply middleware for other routes
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
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