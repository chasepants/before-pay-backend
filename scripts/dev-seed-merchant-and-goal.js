#!/usr/bin/env node
/*
 Dev seeding script to create a fresh Shopify merchant (with new Unit application),
 a merchant user, a guest user, and a Shopify SavingsGoal tied to a checkout cart.

 Usage (env-driven; provide values inline or via .env):
   NODE_ENV=development \
   MONGO_URI="mongodb://localhost:27017/beforepay" \
   UNIT_API_KEY="<unit-sandbox-api-key>" \
   SHOPIFY_SHOP_ID="stashpay-DEV-" \
   SHOP_DOMAIN="stashpay-dev.myshopify.com" \
   MERCHANT_EMAIL="merchant+dev@example.com" \
   MERCHANT_FIRST="Dev" \
   MERCHANT_LAST="Merchant" \
   CUSTOMER_EMAIL="customer+dev@example.com" \
   CUSTOMER_FIRST="Dev" \
   CUSTOMER_LAST="Customer" \
   GOAL_TOTAL="300.00" \
   GOAL_SAVINGS_PER_INSTALLMENT="75" \
   GOAL_CHECKOUT_ID="dev-checkout-id" \
   GOAL_PRODUCT_ID="prod-123" \
   GOAL_VARIANT_ID="var-123" \
   GOAL_PRODUCT_TITLE="Dev Product" \
   GOAL_VENDOR="Dev Vendor" \
   GOAL_PRICE="300.00" \
   GOAL_QUANTITY="1" \
   BANK_NAME="Test Bank" \
   BANK_ACCOUNT_NAME="Plaid Checking" \
   BANK_LAST_FOUR="1234" \
   PLAID_TOKEN="processor-sandbox-xxxx" \
   node scripts/dev-seed-merchant-and-goal.js

 Notes:
 - This creates a NEW ShopifyMerchant each run by appending a timestamp suffix to SHOPIFY_SHOP_ID by default.
 - It starts a Unit application form and prints the URL; complete the form in the browser to trigger webhooks
   that create the Unit customer and deposit account. Daily limit resets with the new account.
 - Safe for development/sandbox only.
*/

require('dotenv').config();
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ShopifyMerchant = require('../models/ShopifyMerchant');
const User = require('../models/User');
const SavingsGoal = require('../models/SavingsGoal');
const { ShopifySavingsGoal } = require('../models/SavingsGoal');
const unitMerchantService = require('../services/unitMerchantService');
const firebaseService = require('../services/firebaseService');
const CheckoutCart = require('../models/CheckoutCart');

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('This script is for development only. Aborting in production.');
  }

  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/beforepay';
  await mongoose.connect(mongoUri, { dbName: undefined });

  const ts = Date.now();

  // Inputs with sensible dev defaults
  const baseShopId = process.env.SHOPIFY_SHOP_ID || 'stashpay-dev';
  const shopifyShopId = `${baseShopId}-${ts}`; // ensure uniqueness to reset Unit limits
  const shopDomain = process.env.SHOP_DOMAIN || `${shopifyShopId}.myshopify.com`;

  const merchantEmail = process.env.MERCHANT_EMAIL || `merchant+${ts}@example.com`;
  const merchantPassword = process.env.MERCHANT_PASSWORD || 'Password123!';
  const merchantFirst = process.env.MERCHANT_FIRST || 'Dev';
  const merchantLast = process.env.MERCHANT_LAST || 'Merchant';

  const customerEmail = process.env.CUSTOMER_EMAIL || `customer+${ts}@example.com`;
  const customerPassword = process.env.CUSTOMER_PASSWORD || 'Password123!';
  const customerFirst = process.env.CUSTOMER_FIRST || 'Dev';
  const customerLast = process.env.CUSTOMER_LAST || 'Customer';

  const totalPrice = process.env.GOAL_TOTAL || '300.00';
  const savingsPerInstallment = Number(process.env.GOAL_SAVINGS_PER_INSTALLMENT || '75');
  const checkoutId = process.env.GOAL_CHECKOUT_ID || uuidv4();
  const productId = process.env.GOAL_PRODUCT_ID || 'prod-123';
  const variantId = process.env.GOAL_VARIANT_ID || 'var-123';
  const productTitle = process.env.GOAL_PRODUCT_TITLE || 'Dev Product';
  const vendor = process.env.GOAL_VENDOR || 'Dev Vendor';
  const price = process.env.GOAL_PRICE || totalPrice;
  const quantity = Number(process.env.GOAL_QUANTITY || '1');

  const bankName = process.env.BANK_NAME || 'Test Bank';
  const bankAccountName = process.env.BANK_ACCOUNT_NAME || 'Plaid Checking';
  const bankLastFour = process.env.BANK_LAST_FOUR || '1234';
  const plaidToken = process.env.PLAID_TOKEN || '';

  console.log('Seeding new dev merchant & goal...');

  // Danger zone: wipe prior dev data to ensure clean environment
  console.log('Cleaning existing dev data (ShopifyMerchants, Users, SavingsGoals, CheckoutCarts)...');
  await SavingsGoal.deleteMany({});
  await User.deleteMany({});
  await ShopifyMerchant.deleteMany({});
  await CheckoutCart.deleteMany({});

  // 1) Create fresh ShopifyMerchant
  const merchant = new ShopifyMerchant({
    shopifyShopId,
    shopDomain,
    onboardingStatus: 'in_progress'
  });
  await merchant.save();
  console.log('Created ShopifyMerchant:', merchant._id.toString(), merchant.shopifyShopId);

  // 2) Start a new Unit application form (fresh Unit application each run)
  let applicationForm;
  try {
    application = await unitMerchantService.createApplication({
      merchantId: merchant._id,
      shopifyShopId: merchant.shopifyShopId
    });
  } catch (e) {
    console.error('Failed to create Unit application:', e.message);
    throw e;
  }

  merchant.onboardingStatus = 'in_progress';
  merchant.unitApplicationFormId = "1234";
  merchant.unitApplicationFormUrl = "https://application-form.sh/view/ZXlKaGJHY2lPaUpTVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnlaWE52ZFhKalpVbGtJam9pTVRreU1Ua3pJaXdpZEhsd1pTSTZJbUZ3Y0d4cFkyRjBhVzl1Um05eWJTSXNJbVY0Y0NJNk1UYzJNakk0T1RNME9Dd2lZV04wYVc5dUlqcDdJbVJoZEdGRGIyeHNaV04wYVc5dUlqcDdmWDE5LkRuUjN5ZnJVNmpTaXlZT2MyVHJESUNyT1hscGpvMXJDN3d2VF9peEZKdFRUSEFFQnE4c0hHcnVCNFBwZ3FwWmd0cE9VVGJ2OEE5cDNSODQ5STFDSVFDZFhsRHV3VFhzdmtjMWVOMGx4OWRmRi04SEFwMV81UTJkc0pGX2VwOWtaTWRvY2VrWmdJX25rYzBFZFF0MHF2R2R5NlJERVdXQlFaRnhadVI0R0JxT2VJZHpjeVFGUjRUclZMWWVBcW9LN1V5aWNUWXFHZENFNjBkS3F4WnVzaXRLcFhhWnZUbFRYVGY3OXBCV3dnY3ExTUMwWUtRX1B1MEwyX1RhaVdMRk5kQVc2SG9uZGtrYmNwYlM3enVGdWhVU2JENzdxOXIwN25pLUctUkt6N0hzSE1QSDN0RWdZTzJMXzNKdDNpOTlJUnJyTUdtUEVwOFNNV2pZTE40LUl3UQ";
  merchant.unitApplicationFormToken = "ZXlKaGJHY2lPaUpTVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnlaWE52ZFhKalpVbGtJam9pTVRreU1Ua3pJaXdpZEhsd1pTSTZJbUZ3Y0d4cFkyRjBhVzl1Um05eWJTSXNJbVY0Y0NJNk1UYzJNakk0T1RNME9Dd2lZV04wYVc5dUlqcDdJbVJoZEdGRGIyeHNaV04wYVc5dUlqcDdmWDE5LkRuUjN5ZnJVNmpTaXlZT2MyVHJESUNyT1hscGpvMXJDN3d2VF9peEZKdFRUSEFFQnE4c0hHcnVCNFBwZ3FwWmd0cE9VVGJ2OEE5cDNSODQ5STFDSVFDZFhsRHV3VFhzdmtjMWVOMGx4OWRmRi04SEFwMV81UTJkc0pGX2VwOWtaTWRvY2VrWmdJX25rYzBFZFF0MHF2R2R5NlJERVdXQlFaRnhadVI0R0JxT2VJZHpjeVFGUjRUclZMWWVBcW9LN1V5aWNUWXFHZENFNjBkS3F4WnVzaXRLcFhhWnZUbFRYVGY3OXBCV3dnY3ExTUMwWUtRX1B1MEwyX1RhaVdMRk5kQVc2SG9uZGtrYmNwYlM3enVGdWhVU2JENzdxOXIwN25pLUctUkt6N0hzSE1QSDN0RWdZTzJMXzNKdDNpOTlJUnJyTUdtUEVwOFNNV2pZTE40LUl3UQ";
  await merchant.save();
  console.log('Unit application form created:', merchant.unitApplicationFormUrl);

  // 3) Create merchant user (status pending; will be updated by webhooks upon Unit events)
  // Create merchant Firebase user to enable login in dev
  // Delete pre-existing Firebase merchant user (if present) so we always have a clean login
  try {
    if (firebaseService.getUserByEmail) {
      const existing = await firebaseService.getUserByEmail(merchantEmail);
      if (existing?.uid && firebaseService.deleteUser) {
        await firebaseService.deleteUser(existing.uid);
      }
    }
  } catch (e) {
    // ok if not found
  }

  let merchantFirebase;
  try {
    merchantFirebase = await firebaseService.createUserWithEmailAndPassword(
      merchantEmail,
      merchantPassword,
      merchantFirst,
      merchantLast
    );
  } catch (e) {
    if (e?.errorInfo?.code === 'auth/email-already-exists') {
      console.warn('Merchant Firebase user already exists, reusing account');
      try {
        if (firebaseService.getUserByEmail) {
          merchantFirebase = await firebaseService.getUserByEmail(merchantEmail);
        }
      } catch (e2) {
        console.warn('Failed to fetch existing merchant Firebase user:', e2.message);
      }
    } else {
      console.warn('Merchant Firebase create failed (continuing):', e.message);
    }
  }

  const merchantUser = new User({
    email: merchantEmail,
    firstName: merchantFirst,
    lastName: merchantLast,
    userType: 'merchant',
    shopifyMerchantId: merchant._id,
    firebaseUid: merchantFirebase?.uid,
    status: 'pending'
  });
  await merchantUser.save();
  console.log('Created merchant User:', merchantUser._id.toString());

  // 4) Create guest/customer user
  // Create guest Firebase user so you can log in
  // Delete pre-existing Firebase customer user (if present)
  try {
    if (firebaseService.getUserByEmail) {
      const existing = await firebaseService.getUserByEmail(customerEmail);
      if (existing?.uid && firebaseService.deleteUser) {
        await firebaseService.deleteUser(existing.uid);
      }
    }
  } catch (e) {
    // ok if not found
  }

  let customerFirebase;
  try {
    customerFirebase = await firebaseService.createUserWithEmailAndPassword(
      customerEmail,
      customerPassword,
      customerFirst,
      customerLast
    );
  } catch (e) {
    if (e?.errorInfo?.code === 'auth/email-already-exists') {
      console.warn('Customer Firebase user already exists, reusing account');
      try {
        if (firebaseService.getUserByEmail) {
          customerFirebase = await firebaseService.getUserByEmail(customerEmail);
        }
      } catch (e2) {
        console.warn('Failed to fetch existing customer Firebase user:', e2.message);
      }
    } else {
      console.warn('Customer Firebase create failed (continuing):', e.message);
    }
  }

  const customerUser = new User({
    email: customerEmail,
    firstName: customerFirst,
    lastName: customerLast,
    userType: 'guest',
    firebaseUid: customerFirebase?.uid,
    status: 'pending'
  });
  await customerUser.save();
  console.log('Created customer User:', customerUser._id.toString());

  // 5) Create CheckoutCart first (required for ShopifySavingsGoal)
  const cart = new CheckoutCart({
    checkoutId,
    email: customerEmail,
    shopDomain,
    totalPrice,
    customerFirstName: customerFirst,
    customerLastName: customerLast,
    customerId: 7736055464033,
    lineItems: [
      {
        productId,
        variantId,
        quantity,
        presentmentTitle: productTitle,
        vendor,
        price
      }
    ],
    status: 'active'
  });
  await cart.save();
  console.log('Created CheckoutCart:', cart.checkoutId);

  // 6) Create a Shopify SavingsGoal linked to the customer's userId and CheckoutCart
  const goal = new ShopifySavingsGoal({
    userId: customerUser._id,
    goalName: `Cart from ${shopifyShopId}`,
    description: 'Save for these items',
    targetAmount: Number(totalPrice),
    currentAmount: 0,
    savingsAmount: savingsPerInstallment,
    checkoutCartId: cart._id,
    shopDomain,
    schedule: {
      startDate: new Date(),
      interval: 'Monthly',
      dayOfMonth: new Date().getUTCDate()
    },
    bank: {
      bankName,
      bankAccountName,
      bankLastFour,
      bankAccountType: 'depository',
      plaidToken
    },
    isPaused: false
  });
  await goal.save();
  console.log('Created SavingsGoal:', goal._id.toString());

  console.log('\n=== Seed Complete ===');
  console.log('Merchant:', {
    id: merchant._id.toString(),
    shopifyShopId: merchant.shopifyShopId,
    shopDomain: merchant.shopDomain,
    applicationFormUrl: merchant.unitApplicationFormUrl
  });
  console.log('Merchant User:', { id: merchantUser._id.toString(), email: merchantUser.email });
  console.log('Customer User:', { id: customerUser._id.toString(), email: customerUser.email });
  console.log('SavingsGoal:', { id: goal._id.toString(), userId: goal.userId.toString() });
  console.log('\nNext step: Open the Unit application form URL above, submit in sandbox.');
  console.log('Webhooks will auto-approve and create the deposit account, resetting daily limits.');
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error('Seed failed:', err.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  });


