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

const googleProductSchema = new Schema({
  type: { type: String, default: 'Google' },
  productLink: { type: String },
  title: { type: String },
  price: { type: String },
  old_price: { type: String },
  extracted_price: { type: Number },
  extracted_old_price: { type: Number },
  product_id: { type: String },
  serpapi_product_api: { type: String },
  thumbnail: { type: String },
  source: { type: String },
  source_icon: { type: String },
  rating: { type: Number },
  reviews: { type: Number },
  badge: { type: String },
  tag: { type: String },
  delivery: { type: String },
  description: { type: String },
  // Shopify-specific identifiers for guest checkout purchases
  shopifyProductId: { type: String },
  shopifyVariantId: { type: String },
  handle: { type: String },
  image: { type: String }
});

const shopifyCartSchema = new Schema({
  type: { type: String, default: 'Shopify' },
  checkoutId: { type: String },
  shopDomain: { type: String },
  currency: { type: String },
  totalPrice: { type: String },
  customerId: { type: String },
  lineItems: [{
    productId: { type: String },
    presentmentTitle: { type: String },
    vendor: { type: String },
    price: { type: String }
  }]
});

const scheduleSchema = new Schema({
  startDate: Date,
  interval: String,
  dayOfMonth: Number,
  dayOfWeek: String,
  // Additional fields to capture installment plan
  frequency: { type: String },
  installments: { type: Number },
  amountPerInstallment: { type: Number }
})

const bankSchema = new Schema({
  bankName: String,
  bankAccountName: String,
  bankLastFour: String,
  bankAccountType: String
})

const savingsGoalSchema = new mongoose.Schema({
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
  category: { type: String, enum: ['product', 'trip', 'donation', 'education', 'home', 'other'], default: 'other' },
  product: { type: Schema.Types.Mixed, required: false }, // Can be googleProductSchema or shopifyCartSchema
  schedule: scheduleSchema,
  bank: bankSchema,
  plaidToken: String,
  transfers: [transferSchema],
  isPaused: { type: Boolean, default: false },
  aiGeneratedImage: String,
  source: { type: String, default: 'web' },
  guestEmail: { type: String },
  aiInsights: [{
    type: String,
    content: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  minimize: false
});

savingsGoalSchema.pre('save', function(next) {
  if (this.product && this.product.price !== undefined) {
    this.product.price = String(this.product.price);
  }
  if (this.product && this.product.old_price !== undefined) {
    this.product.old_price = String(this.product.old_price);
  }
  next();
});

module.exports = mongoose.model('SavingsGoal', savingsGoalSchema);