const mockHandlePaymentStateChange = jest.fn().mockResolvedValue(undefined);
const mockHandleBatchTransferCompleted = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/savingsGoalService', () => {
  return jest.fn().mockImplementation(() => ({
    handlePaymentStateChange: mockHandlePaymentStateChange,
    handleBatchTransferCompleted: mockHandleBatchTransferCompleted
  }));
});

const webhookService = require('../../services/webhookService');

describe('WebhookService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandlePaymentStateChange.mockResolvedValue(undefined);
    mockHandleBatchTransferCompleted.mockResolvedValue(undefined);
  });

  describe('handlePaymentCreated', () => {
    it('should handle payment.created webhook', async () => {
      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await webhookService.handlePaymentCreated(eventData);

      expect(mockHandlePaymentStateChange).toHaveBeenCalledWith('payment-123', 'pending');
      expect(consoleSpy).toHaveBeenCalledWith('payment.created → pending for payment payment-123');

      consoleSpy.mockRestore();
    });

    it('should return early if payment ID is missing', async () => {
      const eventData = {
        relationships: {}
      };

      await webhookService.handlePaymentCreated(eventData);

      expect(mockHandlePaymentStateChange).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentClearing', () => {
    it('should handle payment.clearing webhook', async () => {
      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await webhookService.handlePaymentClearing(eventData);

      expect(mockHandlePaymentStateChange).toHaveBeenCalledWith('payment-123', 'pending');
      expect(consoleSpy).toHaveBeenCalledWith('payment.clearing → pending for payment payment-123');

      consoleSpy.mockRestore();
    });

    it('should return early if payment ID is missing', async () => {
      const eventData = {
        relationships: {}
      };

      await webhookService.handlePaymentClearing(eventData);

      expect(mockHandlePaymentStateChange).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentSent', () => {
    it('should handle payment.sent webhook', async () => {
      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await webhookService.handlePaymentSent(eventData);

      expect(mockHandlePaymentStateChange).toHaveBeenCalledWith('payment-123', 'pending');
      expect(consoleSpy).toHaveBeenCalledWith('payment.sent → pending for payment payment-123');

      consoleSpy.mockRestore();
    });

    it('should return early if payment ID is missing', async () => {
      const eventData = {
        relationships: {}
      };

      await webhookService.handlePaymentSent(eventData);

      expect(mockHandlePaymentStateChange).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentRejected', () => {
    it('should handle payment.rejected webhook', async () => {
      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await webhookService.handlePaymentRejected(eventData);

      expect(mockHandlePaymentStateChange).toHaveBeenCalledWith('payment-123', 'failed');
      expect(consoleSpy).toHaveBeenCalledWith('payment.rejected → failed for payment payment-123');

      consoleSpy.mockRestore();
    });

    it('should return early if payment ID is missing', async () => {
      const eventData = {
        relationships: {}
      };

      await webhookService.handlePaymentRejected(eventData);

      expect(mockHandlePaymentStateChange).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentReturned', () => {
    it('should handle payment.returned webhook', async () => {
      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await webhookService.handlePaymentReturned(eventData);

      expect(mockHandlePaymentStateChange).toHaveBeenCalledWith('payment-123', 'failed');
      expect(consoleSpy).toHaveBeenCalledWith('payment.returned → failed for payment payment-123');

      consoleSpy.mockRestore();
    });

    it('should return early if payment ID is missing', async () => {
      const eventData = {
        relationships: {}
      };

      await webhookService.handlePaymentReturned(eventData);

      expect(mockHandlePaymentStateChange).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentCanceled', () => {
    it('should handle payment.canceled webhook', async () => {
      const eventData = {
        relationships: {
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await webhookService.handlePaymentCanceled(eventData);

      expect(mockHandlePaymentStateChange).toHaveBeenCalledWith('payment-123', 'canceled');
      expect(consoleSpy).toHaveBeenCalledWith('payment.canceled → canceled for payment payment-123');

      consoleSpy.mockRestore();
    });

    it('should return early if payment ID is missing', async () => {
      const eventData = {
        relationships: {}
      };

      await webhookService.handlePaymentCanceled(eventData);

      expect(mockHandlePaymentStateChange).not.toHaveBeenCalled();
    });
  });

  describe('handleTransactionCreated', () => {
    it('should handle transaction.created webhook for regular payments', async () => {
      const eventData = {
        attributes: {
          tags: {
            kind: 'regular'
          }
        },
        relationships: {
          transaction: {
            data: {
              id: 'transaction-123'
            }
          },
          payment: {
            data: {
              id: 'payment-123'
            }
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await webhookService.handleTransactionCreated(eventData);

      expect(mockHandlePaymentStateChange).toHaveBeenCalledWith(
        'payment-123',
        'completed',
        'transaction-123'
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Transaction created webhook:',
        { kind: 'regular', transactionId: 'transaction-123' }
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'transaction.created → completed for payment payment-123, transactionId: transaction-123'
      );

      consoleSpy.mockRestore();
    });

    it('should handle transaction.created webhook for batch transfers', async () => {
      const eventData = {
        attributes: {
          tags: {
            kind: 'transferBackBatch',
            batchId: 'batch-123'
          }
        },
        relationships: {
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await webhookService.handleTransactionCreated(eventData);

      expect(mockHandleBatchTransferCompleted).toHaveBeenCalledWith('batch-123', 'transaction-123');
      expect(mockHandlePaymentStateChange).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should return early if payment ID is missing for regular payments', async () => {
      const eventData = {
        attributes: {
          tags: {}
        },
        relationships: {
          transaction: {
            data: {
              id: 'transaction-123'
            }
          }
        }
      };

      await webhookService.handleTransactionCreated(eventData);

      expect(mockHandlePaymentStateChange).not.toHaveBeenCalled();
    });
  });

  describe('handleBatchTransferCompleted', () => {
    it('should handle batch transfer completion', async () => {
      const eventData = {
        attributes: {
          tags: {
            batchId: 'batch-123'
          }
        }
      };
      const transactionId = 'transaction-123';

      await webhookService.handleBatchTransferCompleted(eventData, transactionId);

      expect(mockHandleBatchTransferCompleted).toHaveBeenCalledWith('batch-123', transactionId);
    });

    it('should return early if batchId is missing', async () => {
      const eventData = {
        attributes: {
          tags: {}
        }
      };

      await webhookService.handleBatchTransferCompleted(eventData, 'transaction-123');

      expect(mockHandleBatchTransferCompleted).not.toHaveBeenCalled();
    });
  });
});

