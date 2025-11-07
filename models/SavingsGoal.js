const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const transferSchema = new Schema({
  transferId: { type: String },
  transactionId: { type: String },
  batchId: { type: String },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  status: { type: String, required: true },
  type: { type: String, required: true },
});

const scheduleSchema = new Schema({
  startDate: Date,
  interval: String,
  dayOfMonth: Number,
  dayOfWeek: String,
  installments: { type: Number },
});

const bankSchema = new Schema({
  bankName: String,
  bankAccountName: String,
  bankLastFour: String,
  bankAccountType: String,
  plaidToken: String
});

// Google Shopping enrichment data schema (optional for ManualSavingsGoal)
const googleShoppingDataSchema = new Schema({
  productLink: String,
  title: String,
  price: String,
  old_price: String,
  extracted_price: Number,
  extracted_old_price: Number,
  product_id: String,
  serpapi_product_api: String,
  thumbnail: String,
  source: String,
  source_icon: String,
  rating: Number,
  reviews: Number,
  badge: String,
  tag: String,
  delivery: String,
  description: String,
  shopifyProductId: String,
  shopifyVariantId: String,
  handle: String,
  image: String
}, { _id: false });

const savingsGoalBaseSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: false
  },
  goalName: { type: String, required: true },
  description: { type: String },
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  savingsAmount: Number,
  schedule: scheduleSchema,
  bank: bankSchema,
  transfers: [transferSchema],
  isPaused: { type: Boolean, default: false },
  guestEmail: { type: String },
}, {
  timestamps: true,
  minimize: false,
  discriminatorKey: '__t'
});

const manualSavingsGoalSchema = new Schema({
  category: { 
    type: String, 
    enum: ['product', 'trip', 'donation', 'education', 'home', 'other'], 
    default: 'other' 
  },
  aiGeneratedImage: String,
  googleShoppingData: [googleShoppingDataSchema],
  manualProductLink: String,
  manualTitle: String,
  manualPrice: String
});

const shopifySavingsGoalSchema = new Schema({
  checkoutCartId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'CheckoutCart', 
    required: true 
  },
  shopDomain: { 
    type: String, 
    required: true 
  } // why do we need this if it's on the checkout cart model?
});

const SavingsGoal = mongoose.model('SavingsGoal', savingsGoalBaseSchema);

const ManualSavingsGoal = SavingsGoal.discriminator('ManualSavingsGoal', manualSavingsGoalSchema);
const ShopifySavingsGoal = SavingsGoal.discriminator('ShopifySavingsGoal', shopifySavingsGoalSchema);

module.exports = SavingsGoal;
module.exports.ManualSavingsGoal = ManualSavingsGoal;
module.exports.ShopifySavingsGoal = ShopifySavingsGoal;
