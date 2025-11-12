const UnitService = require('./unitService');
const Payment = require('../models/Payment');
const PaymentAccount = require('../models/PaymentAccount');
const User = require('../models/User');
const ShopifyMerchant = require('../models/ShopifyMerchant');

class PaymentService {
  constructor() {
    this.unitService = new UnitService();
  }

  /**
   * Create a payment and record it in the database
   * @param {Object} options
   * @param {String} options.savingsGoalId - The savings goal ID
   * @param {String} options.userId - The user ID
   * @param {String} options.direction - 'Debit' or 'Credit'
   * @param {Number} options.amount - Amount in dollars
   * @param {String} options.paymentType - 'manual_installment' | 'shopify_installment' | 'refund' | 'transfer_back' | 'transfer_back_batch'
   * @param {String} options.paymentAccountId - PaymentAccount ID (from account - user's bank)
   * @param {String} options.unitAccountId - Unit account ID (to account - user's or merchant's Unit account)
   * @param {String} options.description - Payment description
   * @param {Object} options.tags - Additional tags/metadata
   * @param {String} options.batchId - Optional batch ID for batch transfers
   * @returns {Promise<Object>} Created payment record
   */
  async createPayment(options) {
    const {
      savingsGoalId,
      userId,
      direction,
      amount,
      paymentType,
      paymentAccountId,
      unitAccountId,
      description,
      tags = {},
      batchId
    } = options;

    // Validate required fields
    if (!savingsGoalId || !direction || !amount || !paymentType || !paymentAccountId || !unitAccountId) {
      throw new Error('Missing required payment fields');
    }

    // Fetch PaymentAccount to get plaidProcessorToken
    const paymentAccount = await PaymentAccount.findById(paymentAccountId);
    if (!paymentAccount) {
      throw new Error(`PaymentAccount not found: ${paymentAccountId}`);
    }

    // Create payment via Unit API
    const unitPaymentData = {
      type: 'achPayment',
      attributes: {
        amount: Math.round(amount * 100), // Convert to cents
        direction: direction,
        description: description || 'Payment',
        plaidProcessorToken: paymentAccount.plaidProcessorToken,
        tags: {
          savingsGoalId: savingsGoalId.toString(),
          ...tags
        }
      },
      relationships: {
        account: { data: { type: 'account', id: unitAccountId } }
      }
    };

    const unitResponse = await this.unitService.createPayment(unitPaymentData);
    const paymentId = unitResponse.data.id;

    // Create Payment record
    const payment = new Payment({
      paymentId,
      savingsGoalId,
      userId,
      paymentAccountId,
      direction,
      amount,
      paymentType,
      description,
      tags: unitPaymentData.attributes.tags,
      batchId,
      status: 'pending',
      date: new Date()
    });

    await payment.save();

    // Note: Linking to goal.transfers is handled by SavingsGoalService
    // PaymentService only handles payment operations

    return payment;
  }

  /**
   * Update payment status (called by webhooks)
   * @param {String} paymentId - Unit payment ID
   * @param {String} status - New status
   * @param {String} transactionId - Optional transaction ID
   * @returns {Promise<Object>} Updated payment record
   */
  async updatePaymentStatus(paymentId, status, transactionId = null) {
    const payment = await Payment.findOne({ paymentId });
    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    payment.status = status;
    if (transactionId) {
      payment.transactionId = transactionId;
    }
    await payment.save();

    // Note: Goal state updates are handled by SavingsGoalService
    // PaymentService only handles payment status updates

    return payment;
  }

  /**
   * Get payments for a savings goal
   * @param {String} goalId - Savings goal ID
   * @returns {Promise<Array>} Array of payment records
   */
  async getPaymentsForGoal(goalId) {
    return Payment.find({ savingsGoalId: goalId }).sort({ date: -1 });
  }

  /**
   * Get payments for a user
   * @param {String} userId - User ID
   * @returns {Promise<Array>} Array of payment records
   */
  async getPaymentsForUser(userId) {
    return Payment.find({ userId }).sort({ date: -1 });
  }

  /**
   * Get payment by Unit payment ID
   * @param {String} paymentId - Unit payment ID
   * @returns {Promise<Object>} Payment record
   */
  async getPaymentByPaymentId(paymentId) {
    return Payment.findOne({ paymentId });
  }

  /**
   * Get payments by batch ID
   * @param {String} batchId - Batch ID
   * @returns {Promise<Array>} Array of payment records
   */
  async getPaymentsByBatchId(batchId) {
    return Payment.find({ batchId });
  }
}

module.exports = PaymentService;

