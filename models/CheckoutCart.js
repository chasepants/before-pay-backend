const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  productId: String,
  variantId: String,
  quantity: Number,
  presentmentTitle: String,
  vendor: String,
  price: String
});

const checkoutCartSchema = new mongoose.Schema({
  checkoutId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    index: true
  },
  shopDomain: {
    type: String,
    required: true
  },
  totalPrice: String,
  customerFirstName: String,
  customerLastName: String,
  customerId: String,
  lineItems: [lineItemSchema],
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'active'
  },
  orderId: {
    type: String,
    default: null
  },
  abandonedAt: {
    type: Date,
    default: null
  },
  emailSent: {
    type: Boolean,
    default: false
  },
  emailSentAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

checkoutCartSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('CheckoutCart', checkoutCartSchema);
