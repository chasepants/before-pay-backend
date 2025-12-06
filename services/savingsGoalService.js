const PaymentService = require('./paymentService');
const Payment = require('../models/Payment');
const PaymentAccount = require('../models/PaymentAccount');
const SavingsGoal = require('../models/SavingsGoal');
const { ShopifySavingsGoal } = require('../models/SavingsGoal');
const CheckoutCart = require('../models/CheckoutCart');
const User = require('../models/User');
const ShopifyMerchant = require('../models/ShopifyMerchant');
const { shopifyApi, ApiVersion } = require('@shopify/shopify-api');
const emailService = require('./emailService');

class SavingsGoalService {
  constructor() {
    this.paymentService = new PaymentService();
  }

  /**
   * Find or create a PaymentAccount for a goal
   * @param {Object} goal - SavingsGoal instance
   * @param {String} plaidProcessorToken - Plaid processor token
   * @param {Object} bankAccountDetails - Optional bank account details (bankName, bankAccountName, bankLastFour, bankAccountType)
   * @returns {Promise<Object>} PaymentAccount instance
   */
  async findOrCreatePaymentAccount(goal, plaidProcessorToken, bankAccountDetails = null) {
    const userId = goal.userId;
    if (!userId) {
      throw new Error('Goal must have a userId to create PaymentAccount');
    }

    // Try to find existing PaymentAccount
    const query = {
      userId,
      plaidProcessorToken,
      isActive: true
    };

    let paymentAccount = await PaymentAccount.findOne(query);

    if (!paymentAccount) {
      // Map bankAccountType to PaymentAccount.accountType enum
      let accountType = 'checking'; // default
      if (bankAccountDetails?.bankAccountType) {
        const bankType = bankAccountDetails.bankAccountType;
        if (bankType === 'savings') {
          accountType = 'savings';
        } else if (bankType === 'depository') {
          // depository is a Plaid type, default to checking
          accountType = 'checking';
        } else {
          // Try to map other types
          accountType = bankType.toLowerCase() === 'savings' ? 'savings' : 'checking';
        }
      }
      
      paymentAccount = new PaymentAccount({
        userId,
        bankName: bankAccountDetails?.bankName || 'Unknown Bank',
        bankAccountName: bankAccountDetails?.bankAccountName || 'Bank Account',
        bankLastFour: bankAccountDetails?.bankLastFour || '****',
        accountType,
        plaidProcessorToken,
        isActive: true
      });
      await paymentAccount.save();
    }

    return paymentAccount;
  }

  /**
   * Get Unit account ID for a goal
   * For Shopify goals: Goal -> shopDomain -> ShopifyMerchant -> unitAccountId
   * For Manual goals: User -> unitAccountId
   * @param {Object} goal - SavingsGoal instance
   * @returns {Promise<String>} Unit account ID
   */
  async getUnitAccountIdForGoal(goal) {
    const userId = goal.userId;
    if (!userId) {
      throw new Error('Goal must have a userId to get Unit account ID');
    }

    if (goal instanceof ShopifySavingsGoal) {
      // Shopify goal - get merchant's Unit account via goal's shopDomain
      // Note: Guest users don't have shopifyMerchantId, so we use shopDomain instead
      if (!goal.shopDomain) {
        throw new Error(`ShopifySavingsGoal missing shopDomain`);
      }

      const merchant = await ShopifyMerchant.findOne({ shopDomain: goal.shopDomain });
      if (!merchant) {
        throw new Error(`Merchant not found for shopDomain: ${goal.shopDomain}`);
      }
      
      if (!merchant.unitAccountId) {
        throw new Error(`Merchant unitAccountId missing for shopDomain: ${merchant.shopDomain}`);
      }

      return merchant.unitAccountId;
    } else {
      // Manual goal - get user's Unit account
      const user = await User.findById(userId);
      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }
      
      if (!user.unitAccountId) {
        throw new Error(`User ${userId} does not have a unitAccountId`);
      }

      return user.unitAccountId;
    }
  }

  /**
   * Create a payment for a savings goal
   * This is the main entry point for creating payments - it handles linking to goals
   * As the conductor, this method determines both:
   * - PaymentAccount (from account - user's bank)
   * - Unit account ID (to account - user's or merchant's Unit account)
   * @param {Object} goal - SavingsGoal instance
   * @param {Object} paymentData - Payment creation data
   * @param {String} paymentData.direction - 'Debit' or 'Credit'
   * @param {Number} paymentData.amount - Amount in dollars
   * @param {String} paymentData.paymentType - 'manual_installment' | 'shopify_installment' | 'refund' | 'transfer_back' | 'transfer_back_batch'
   * @param {String} paymentData.plaidProcessorToken - Plaid processor token
   * @param {String} paymentData.description - Payment description
   * @param {Object} paymentData.tags - Additional tags
   * @param {String} paymentData.batchId - Optional batch ID
   * @returns {Promise<Object>} Created payment record
   */
  async createPaymentForGoal(goal, paymentData) {
    // Find or create PaymentAccount (from account - user's bank)
    const paymentAccount = await this.findOrCreatePaymentAccount(
      goal,
      paymentData.plaidProcessorToken
    );

    // Get Unit account ID (to account - user's or merchant's Unit account)
    const unitAccountId = await this.getUnitAccountIdForGoal(goal);

    // Determine direction from payment type if not provided
    const direction = paymentData.direction ||
      (paymentData.paymentType?.includes('refund') ||
      paymentData.paymentType?.includes('transfer_back') ? 'Credit' : 'Debit');

    const payment = await this.paymentService.createPayment({
      savingsGoalId: goal._id.toString(),
      userId: goal.userId?.toString(),
      direction,
      amount: paymentData.amount,
      paymentType: paymentData.paymentType,
      paymentAccountId: paymentAccount._id.toString(),
      unitAccountId,
      description: paymentData.description,
      tags: paymentData.tags || {},
      batchId: paymentData.batchId
    });

    // Link payment to goal's transfers array (for backward compatibility)
    await this.linkPaymentToGoal(goal, payment);

    return payment;
  }

  /**
   * Link a payment to a goal's transfers array (for backward compatibility)
   * @param {Object} goal - SavingsGoal instance
   * @param {Object} payment - Payment record
   */
  async linkPaymentToGoal(goal, payment) {
    // Check if transfer already exists
    const existingTransfer = goal.transfers.find(t => t.transferId === payment.paymentId);
    if (!existingTransfer) {
      // Determine type from direction for backward compatibility
      const type = payment.direction === 'Debit' ? 'debit' : 'credit';
      goal.transfers.push({
        transferId: payment.paymentId,
        transactionId: payment.transactionId || null,
        batchId: payment.batchId || null,
        amount: payment.amount,
        date: payment.date,
        status: payment.status,
        type
      });
      await goal.save();
    }
  }

  /**
   * Handle payment state change - this is the main conductor method
   * Called by WebhookService when payment status changes
   * @param {String} paymentId - Unit payment ID
   * @param {String} newStatus - New payment status
   * @param {String} transactionId - Optional transaction ID
   */
  async handlePaymentStateChange(paymentId, newStatus, transactionId = null) {
    // Get payment first to check current status
    const existingPayment = await this.paymentService.getPaymentByPaymentId(paymentId);
    if (!existingPayment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    // If payment is already in the target status, skip processing
    // This prevents duplicate processing of already completed payments
    if (existingPayment.status === newStatus && newStatus === 'completed') {
      console.log(`Payment ${paymentId} is already ${newStatus}, skipping state change`);
      return;
    }

    // Update payment status via PaymentService
    const payment = await this.paymentService.updatePaymentStatus(paymentId, newStatus, transactionId);

    // Get the goal
    const goal = await SavingsGoal.findById(payment.savingsGoalId);
    if (!goal) {
      console.warn(`Goal not found for payment ${paymentId}`);
      return;
    }

    // Update goal.transfers array
    const transferIdx = goal.transfers.findIndex(t => t.transferId === paymentId);
    if (transferIdx !== -1) {
      goal.transfers[transferIdx].status = newStatus;
      if (transactionId) {
        goal.transfers[transferIdx].transactionId = transactionId;
      }
    }

    // Apply business rules based on status
    switch (newStatus) {
      case 'completed':
        await this.handlePaymentCompleted(goal, payment);
        break;
      case 'failed':
      case 'rejected':
        await this.handlePaymentFailed(goal, payment);
        break;
      case 'canceled':
        // No change to goal state
        break;
      default:
        // pending, processing - no change to goal state yet
        break;
    }

    await goal.save();
  }

  /**
   * Handle payment completed - applies business rules for how completed payments affect goals
   * @param {Object} goal - SavingsGoal instance
   * @param {Object} payment - Payment record
   */
  async handlePaymentCompleted(goal, payment) {
    const tags = payment.tags || {};

    // Special handling for Shopify refunds
    if (tags.type === 'shopifyRefund' && payment.direction === 'Credit') {
      goal.currentAmount = 0;
      goal.isPaused = true;
      goal.savingsAmount = 0;
      console.log(`Shopify refund completed for goal ${goal._id}: currentAmount set to 0, goal paused`);
      return;
    }

    // Regular payment effects (use direction instead of type)
    if (payment.direction === 'Debit') {
      // Debit increases goal amount
      goal.currentAmount = (goal.currentAmount || 0) + payment.amount;
    } else if (payment.direction === 'Credit') {
      // Credit decreases goal amount
      goal.currentAmount = Math.max(0, (goal.currentAmount || 0) - payment.amount);
    }

    // Check if Shopify goal is complete
    if ((goal instanceof ShopifySavingsGoal) && goal.currentAmount >= goal.targetAmount) {
      console.log(`Goal ${goal.goalName} has reached its target amount`);
      goal.isPaused = true;
      goal.savingsAmount = 0;
      
      // Create order when goal is complete
      try {
        await this.createOrder(goal);
      } catch (error) {
        console.error('Error creating order:', error);
        // Don't throw - goal state is already updated, order creation failure shouldn't block
      }
    }

    // Send email notification to user (savings or guest)
    try {
      let userEmail = null;
      
      // Try to get email from User model if userId exists
      if (goal.userId) {
        const user = await User.findById(goal.userId);
        if (user && user.email) {
          userEmail = user.email;
        }
      }
      
      // Fall back to guestEmail if no user email found
      if (!userEmail && goal.guestEmail) {
        userEmail = goal.guestEmail;
      }
      
      // Send email if we have an email address
      if (userEmail) {
        await emailService.sendPaymentCompletedEmail(userEmail, payment);
      } else {
        console.warn(`No email found for goal ${goal._id} - cannot send payment completed email`);
      }
    } catch (error) {
      console.error('Error sending payment completed email:', error);
      // Don't throw - email failure shouldn't block payment processing
    }    
  }

  /**
   * Handle payment failed - no change to goal amount
   * @param {Object} goal - SavingsGoal instance
   * @param {Object} payment - Payment record
   */
  async handlePaymentFailed(goal, payment) {
    // Failed payments don't affect goal amounts
    // Could add logging or notification here in the future
    console.log(`Payment ${payment.paymentId} failed for goal ${goal._id} - no change to goal amount`);
  }

  /**
   * Handle batch transfer completion
   * @param {String} batchId - Batch ID
   * @param {String} transactionId - Transaction ID
   */
  async handleBatchTransferCompleted(batchId, transactionId) {
    const payments = await this.paymentService.getPaymentsByBatchId(batchId);
    console.log(`Found ${payments.length} payments for batch ${batchId}`);

    for (const payment of payments) {
      if (payment.status !== 'completed') {
        // Update each payment status
        await this.paymentService.updatePaymentStatus(payment.paymentId, 'completed', transactionId);
        
        // Update goal amount for each payment
        const goal = await SavingsGoal.findById(payment.savingsGoalId);
        if (goal) {
          // Batch transfers are credits, so decrease amount
          goal.currentAmount = Math.max(0, (goal.currentAmount || 0) - payment.amount);
          
          // Update transfer in goal.transfers array
          const transferIdx = goal.transfers.findIndex(t => t.transferId === payment.paymentId);
          if (transferIdx !== -1) {
            goal.transfers[transferIdx].status = 'completed';
            goal.transfers[transferIdx].transactionId = transactionId;
          }
          
          await goal.save();
        }
      }
    }

    console.log(`transaction.created → completed batch ${batchId}, transactionId: ${transactionId}`);
  }

  /**
   * Get payment by payment ID (for reading payment data)
   * @param {String} paymentId - Unit payment ID
   * @returns {Promise<Object>} Payment record
   */
  async getPaymentByPaymentId(paymentId) {
    return this.paymentService.getPaymentByPaymentId(paymentId);
  }

  /**
   * Create Shopify order when goal is complete
   * @param {Object} goal - ShopifySavingsGoal instance
   */
  async createOrder(goal) {
    if (!(goal instanceof ShopifySavingsGoal)) {
      throw new Error('createOrder can only be called on ShopifySavingsGoal');
    }
    
    if (!goal.checkoutCartId) {
      throw new Error('Missing checkoutCartId on ShopifySavingsGoal');
    }
    
    const cart = await CheckoutCart.findById(goal.checkoutCartId);

    if (!cart) {
      throw new Error('Checkout cart not found');
    }

    if (!cart.customerId) {
      throw new Error(`CheckoutCart has no customerId - this might be a guest checkout`);
    }

    const shopify = shopifyApi({
      apiKey: process.env.SHOPIFY_CLIENT_ID,
      apiSecretKey: process.env.SHOPIFY_CLIENT_SECRET,
      scopes: ['write_orders', 'read_customers'],
      hostName: 'ngrok-tunnel-address',
      apiVersion: ApiVersion.July25,
      isTesting: true
    });

    const { session } = await shopify.auth.clientCredentials({shop: goal.shopDomain});

    const client = new shopify.clients.Graphql({ session, apiVersion: ApiVersion.July25});

    // TODO: Add shipping address to the order
    const mutation = `#graphql
      mutation orderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
        orderCreate(order: $order, options: $options) {
          userErrors {
            field
            message
          }
          order {
            id
            displayFinancialStatus
            customer {
              id
            }
          }
        }
      }
    `;

    const lineItems = cart.lineItems.map(item => ({
      variantId: `gid://shopify/ProductVariant/${item.variantId}`,
      quantity: item.quantity
    }));

    const variables = {
      order: {
        lineItems: lineItems,
        customer: {
          toAssociate: {
            id: `gid://shopify/Customer/${cart.customerId}`
          }
        },
        financialStatus: "PAID"
      }
    };
    console.log(JSON.stringify(variables, null, 2));
    
    const response = await client.request(mutation, { variables });

    console.log('Order creation response:', JSON.stringify(response, null, 2));

    if (response.data?.orderCreate?.userErrors?.length > 0) {
      console.error('Order creation errors:', response.data.orderCreate.userErrors);
      throw new Error(`Order creation failed: ${response.data.orderCreate.userErrors.map(e => e.message).join(', ')}`);
    }
    
    const orderId = response.data?.orderCreate?.order?.id;
    console.log('Order created successfully:', orderId);
    
    // Extract numeric order ID from GraphQL ID format (gid://shopify/Order/123456)
    let numericOrderId = null;
    if (orderId) {
      const match = orderId.match(/\/Order\/(\d+)$/);
      if (match) {
        numericOrderId = match[1];
      } else {
        // If it's already numeric, use it as is
        numericOrderId = orderId;
      }
    }
    
    // Update CheckoutCart with order ID and mark as completed
    if (numericOrderId) {
      cart.orderId = numericOrderId.toString();
      cart.status = 'completed';
      await cart.save();
      console.log(`CheckoutCart updated with orderId: ${numericOrderId}`);
    } else {
      console.warn('Could not extract order ID from response:', orderId);
    }
  }

  /**
   * Find destination Plaid token from goals
   * @param {Array} goals - Array of SavingsGoal instances
   * @returns {Promise<String|null>} Plaid processor token or null if not found
   */
  async findDestinationPlaidToken(goals) {
    // Find first goal with a paymentAccountId
    const goalWithAccount = goals.find(g => !!g.paymentAccountId);
    if (!goalWithAccount) {
      return null;
    }
    
    // Fetch PaymentAccount to get plaidProcessorToken
    const paymentAccount = await PaymentAccount.findById(goalWithAccount.paymentAccountId);
    if (!paymentAccount || !paymentAccount.plaidProcessorToken) {
      return null;
    }
    
    return paymentAccount.plaidProcessorToken;
  }

  /**
   * Create a batch transfer back payment
   * This handles the complex logic of creating one Unit payment but multiple Payment records
   * @param {Object} params - Batch transfer parameters
   * @param {Number} params.totalAmount - Total amount for the Unit payment
   * @param {Array} params.allocations - Array of { savingsGoalId, amount }
   * @param {Array} params.goals - Array of SavingsGoal instances
   * @param {Map} params.goalsById - Map of goal ID to goal instance
   * @param {String} params.batchId - Batch ID
   * @returns {Promise<Object>} Result with paymentId, batchId, and processed count
   */
  async createBatchTransfer({ totalAmount, allocations, goals, goalsById, batchId }) {
    // Find destination Plaid token from goals via PaymentAccount
    const destPlaidToken = await this.findDestinationPlaidToken(goals);
    if (!destPlaidToken) {
      throw new Error('No destination bank found for transfer back');
    }

    // Create the actual Unit payment (one payment for total amount) for the first goal
    const firstAllocation = allocations[0];
    const firstGoal = goalsById.get(firstAllocation.savingsGoalId);
    
    const payment = await this.createPaymentForGoal(firstGoal, {
      direction: 'Credit',
      amount: totalAmount, // Total amount for the single Unit payment
      paymentType: 'transfer_back_batch',
      plaidProcessorToken: destPlaidToken,
      description: 'Transfer Back',
      tags: {
        kind: 'transferBackBatch',
        batchId
      },
      batchId
    });

    // Update the first goal's payment record to have the correct amount
    const firstPayment = await Payment.findOne({ paymentId: payment.paymentId, savingsGoalId: firstGoal._id });
    if (firstPayment) {
      firstPayment.amount = Number(firstAllocation.amount);
      await firstPayment.save();
    }
    
    // Update the first goal's transfer to have the correct amount
    const firstTransferIdx = firstGoal.transfers.findIndex(t => t.transferId === payment.paymentId);
    if (firstTransferIdx !== -1) {
      firstGoal.transfers[firstTransferIdx].amount = Number(firstAllocation.amount);
      await firstGoal.save();
    }

    // Get PaymentAccount and Unit account ID for remaining payments (use first goal's account)
    const paymentAccount = await this.findOrCreatePaymentAccount(firstGoal, destPlaidToken);
    const unitAccountId = await this.getUnitAccountIdForGoal(firstGoal);

    // Create Payment records for remaining goals (same paymentId, different amounts)
    for (let i = 1; i < allocations.length; i++) {
      const a = allocations[i];
      const g = goalsById.get(a.savingsGoalId);
      
      const batchPayment = new Payment({
        paymentId: payment.paymentId, // Same payment ID for all
        transactionId: null,
        savingsGoalId: g._id,
        userId: g.userId,
        paymentAccountId: paymentAccount._id,
        direction: 'Credit',
        amount: Number(a.amount),
        status: 'pending',
        paymentType: 'transfer_back_batch',
        batchId,
        description: 'Transfer Back',
        tags: {
          kind: 'transferBackBatch',
          batchId
        },
        date: new Date()
      });
      await batchPayment.save();
      
      // Link payment to goal's transfers array
      await this.linkPaymentToGoal(g, batchPayment);
    }

    return { paymentId: payment.paymentId, batchId, processed: allocations.length };
  }
}

module.exports = SavingsGoalService;

