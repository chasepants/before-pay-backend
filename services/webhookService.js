const SavingsGoalService = require('./savingsGoalService');

class WebhookService {
  constructor() {
    this.savingsGoalService = new SavingsGoalService();
  }
  /**
   * Handle payment.created webhook
   * @param {Object} eventData - Unit webhook event data
   */
  async handlePaymentCreated(eventData) {
    const paymentId = eventData.relationships?.payment?.data?.id;
    if (!paymentId) return;

    // Delegate to SavingsGoalService - it handles payment status updates and goal state
    await this.savingsGoalService.handlePaymentStateChange(paymentId, 'pending');
    console.log(`payment.created → pending for payment ${paymentId}`);
  }

  /**
   * Handle payment.clearing webhook
   * @param {Object} eventData - Unit webhook event data
   */
  async handlePaymentClearing(eventData) {
    const paymentId = eventData.relationships?.payment?.data?.id;
    if (!paymentId) return;

    // Delegate to SavingsGoalService
    await this.savingsGoalService.handlePaymentStateChange(paymentId, 'pending');
    console.log(`payment.clearing → pending for payment ${paymentId}`);
  }

  /**
   * Handle payment.sent webhook
   * @param {Object} eventData - Unit webhook event data
   */
  async handlePaymentSent(eventData) {
    const paymentId = eventData.relationships?.payment?.data?.id;
    if (!paymentId) return;

    // Delegate to SavingsGoalService
    await this.savingsGoalService.handlePaymentStateChange(paymentId, 'pending');
    console.log(`payment.sent → pending for payment ${paymentId}`);
  }

  /**
   * Handle payment.rejected webhook
   * @param {Object} eventData - Unit webhook event data
   */
  async handlePaymentRejected(eventData) {
    const paymentId = eventData.relationships?.payment?.data?.id;
    if (!paymentId) return;

    // Delegate to SavingsGoalService
    await this.savingsGoalService.handlePaymentStateChange(paymentId, 'failed');
    console.log(`payment.rejected → failed for payment ${paymentId}`);
  }

  /**
   * Handle payment.returned webhook
   * @param {Object} eventData - Unit webhook event data
   */
  async handlePaymentReturned(eventData) {
    const paymentId = eventData.relationships?.payment?.data?.id;
    if (!paymentId) return;

    // Delegate to SavingsGoalService
    await this.savingsGoalService.handlePaymentStateChange(paymentId, 'failed');
    console.log(`payment.returned → failed for payment ${paymentId}`);
  }

  /**
   * Handle payment.canceled webhook
   * @param {Object} eventData - Unit webhook event data
   */
  async handlePaymentCanceled(eventData) {
    const paymentId = eventData.relationships?.payment?.data?.id;
    if (!paymentId) return;

    // Delegate to SavingsGoalService
    await this.savingsGoalService.handlePaymentStateChange(paymentId, 'canceled');
    console.log(`payment.canceled → canceled for payment ${paymentId}`);
  }

  /**
   * Handle transaction.created webhook
   * This is the main handler that updates payment status and goal amounts
   * @param {Object} eventData - Unit webhook event data
   */
async handleTransactionCreated(eventData) {
    const tags = eventData.attributes?.tags || {};
    const kind = tags.kind;
    const transactionId = eventData.relationships?.transaction?.data?.id;

    console.log('Transaction created webhook:', { kind, transactionId });

    // Handle batch transfers
    if (kind === 'transferBackBatch') {
      await this.handleBatchTransferCompleted(eventData, transactionId);
      return;
    }

    // Handle regular payments
    const paymentId = eventData.relationships?.payment?.data?.id;
    if (!paymentId) return;

    // Delegate to SavingsGoalService - it handles payment status update, goal state update, AND order creation
    await this.savingsGoalService.handlePaymentStateChange(paymentId, 'completed', transactionId);

    console.log(`transaction.created → completed for payment ${paymentId}, transactionId: ${transactionId}`);
  }

  /**
   * Handle batch transfer completion
   * @param {Object} eventData - Unit webhook event data
   * @param {String} transactionId - Transaction ID
   */
  async handleBatchTransferCompleted(eventData, transactionId) {
    const tags = eventData.attributes?.tags || {};
    const batchId = tags.batchId;
    if (!batchId) return;

    // Delegate to SavingsGoalService - it knows how to handle batch transfers
    await this.savingsGoalService.handleBatchTransferCompleted(batchId, transactionId);
  }
}

module.exports = new WebhookService();

