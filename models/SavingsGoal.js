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
  description: { type: String }
});

const scheduleSchema = new Schema({
  startDate: Date,
  interval: String,
  dayOfMonth: Number,
  dayOfWeek: String
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
  product: { type: googleProductSchema, required: false },
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
  timestamps: true
});

module.exports = mongoose.model('SavingsGoal', savingsGoalSchema);