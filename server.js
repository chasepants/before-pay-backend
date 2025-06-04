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

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('Webhook');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('Webhook event received:', event.type, 'ID:', event.id);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'invoice.payment_succeeded') {
    const subscriptionId = event.data.object.subscription;
    const amount = event.data.object.amount_paid / 100;
    console.log('Processing invoice.payment_succeeded:', { subscriptionId, amount, invoiceId: event.data.object.id });
    try {
      const wishlistItem = await WishlistItem.findOne({ subscriptionId });
      if (wishlistItem) {
        wishlistItem.savings_progress += amount;
        const user = await User.findById(wishlistItem.userId);
        user.totalSavings += amount;
        await wishlistItem.save();
        await user.save();
        console.log('Savings updated for wishlist item:', wishlistItem._id, 'New progress:', wishlistItem.savings_progress);
      } else {
        console.log('No wishlist item found for subscription:', subscriptionId);
      }
    } catch (error) {
      console.error('Error updating savings:', error.message, error.stack);
    }
  } else {
    console.log('Unhandled webhook event:', event.type);
  }

  res.json({ received: true });
});

// Apply middleware for other routes
app.use(cors({ 
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
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


// // Webhook endpoint (no auth, raw body)
// app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
//   console.log('Webhook');
//   const sig = req.headers['stripe-signature'];
//   let event;
//   try {
//     event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
//     console.log('Webhook event received:', event.type, 'ID:', event.id);
//   } catch (err) {
//     console.error('Webhook signature verification failed:', err.message);
//     return res.status(400).send(`Webhook Error: ${err.message}`);
//   }

//   if (event.type === 'invoice.payment_succeeded') {
//     const subscriptionId = event.data.object.subscription;
//     const amount = event.data.object.amount_paid / 100;
//     console.log('Processing invoice.payment_succeeded:', { subscriptionId, amount, invoiceId: event.data.object.id });
//     try {
//       const wishlistItem = await WishlistItem.findOne({ subscriptionId });
//       if (wishlistItem) {
//         wishlistItem.savings_progress += amount;
//         const user = await User.findById(wishlistItem.userId);
//         user.totalSavings += amount;
//         await wishlistItem.save();
//         await user.save();
//         console.log('Savings updated for wishlist item:', wishlistItem._id, 'New progress:', wishlistItem.savings_progress);
//       } else {
//         console.log('No wishlist item found for subscription:', subscriptionId);
//       }
//     } catch (error) {
//       console.error('Error updating savings:', error.message, error.stack);
//     }
//   } else if (event.type === 'financial_connections.account.created') {
//     const account = event.data.object;
//     console.log('Processing financial_connections.account.created:', {
//       accountId: account.id,
//       customer: account.account_holder?.customer,
//       last4: account.last4,
//       institution: account.institution_name
//     });
//     if (!account.account_holder?.customer) {
//       console.error('No customer ID in account_holder:', account);
//       return res.json({ received: true, error: 'No customer ID provided' });
//     }
//     const wishlistItem = await WishlistItem.findOne({ stripeCustomerId: account.account_holder.customer });
//     if (wishlistItem) {
//       // Processing financial_connections.account.created: {
//     //   accountId: 'fca_1RVuczHGylTIBPReBXu9PhX2',
//     //   customer: 'cus_SQP9hUquLnApEr',
//     //   last4: '6789',
//     //   institution: 'StripeBank'
//     // }
//       wishlistItem.payoutBankAccountId = account.id;
//       await wishlistItem.save();
//       console.log('Payout bank account linked for wishlist item:', wishlistItem._id, 'Account ID:', account.id);
//     } else {
//       console.error('No wishlist item found for customer:', account.account_holder.customer);
//       return res.json({ received: true, error: 'No wishlist item found for customer' });
//     }
//   } else {
//     console.log('Unhandled webhook event:', event.type);
//   }

//   res.json({ received: true });
// });
