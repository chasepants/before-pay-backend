const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const paymentSchema = new Schema({
  // Unit payment identifiers
  // Note: paymentId is NOT unique alone - batch transfers create multiple Payment records
  // with the same paymentId but different savingsGoalIds
  paymentId: { 
    type: String, 
    required: true,
    index: true 
  },
  // Transaction ID gets created after the payment has cleared
  transactionId: { 
    type: String,
    index: true 
  },
  
  // References
  savingsGoalId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'SavingsGoal', 
    required: true,
    index: true 
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    index: true 
  },
  paymentAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentAccount',
    required: true,
    index: true
  },
  
  // Payment details
  direction: { 
    type: String, 
    required: true,
    enum: ['Debit', 'Credit']
  },
  amount: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    required: true,
    enum: ['pending', 'completed', 'failed', 'canceled'],
    default: 'pending',
    index: true
  },
  
  // Payment type classification
  paymentType: {
    type: String,
    enum: ['manual_installment', 'shopify_installment', 'refund', 'transfer_back', 'transfer_back_batch'],
    required: true
  },
  
  // Batch transfers
  batchId: { 
    type: String,
    index: true 
  },

  // Metadata
  description: String,
  tags: Schema.Types.Mixed, // Store Unit tags
  
  // Timestamps
  date: { 
    type: Date, 
    required: true,
    default: Date.now 
  }
}, {
  timestamps: true
});

// Indexes for common queries
paymentSchema.index({ savingsGoalId: 1, status: 1 });
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ batchId: 1, status: 1 });
paymentSchema.index({ paymentType: 1, status: 1 });
paymentSchema.index({ paymentAccountId: 1, status: 1 });
// Compound unique index: paymentId + savingsGoalId (allows same paymentId for different goals in batch transfers)
paymentSchema.index({ paymentId: 1, savingsGoalId: 1 }, { unique: true });

module.exports = mongoose.model('Payment', paymentSchema);
