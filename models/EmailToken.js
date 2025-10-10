const mongoose = require('mongoose');
const { Schema } = mongoose;

const emailTokenSchema = new Schema({
  token: {
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
  checkoutId: {
    type: String,
    required: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  used: {
    type: Boolean,
    default: false,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
emailTokenSchema.index({ token: 1, used: 1 });
emailTokenSchema.index({ email: 1, checkoutId: 1 });
emailTokenSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('EmailToken', emailTokenSchema);
