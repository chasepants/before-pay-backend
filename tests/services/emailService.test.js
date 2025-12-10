const emailService = require('../../services/emailService');
const sgMail = require('@sendgrid/mail');

// Mock SendGrid
jest.mock('@sendgrid/mail');

// Mock environment variables
process.env.FROM_EMAIL = 'noreply@gostashpay.com';

describe('EmailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock successful SendGrid response
    sgMail.send.mockResolvedValue([{
      statusCode: 202,
      headers: { 'x-message-id': 'test-message-id' }
    }]);
  });

  describe('sendVerificationCode', () => {
    it('should send verification code email successfully', async () => {
      const email = 'test@example.com';
      const verificationCode = '123456';

      const result = await emailService.sendVerificationCode(email, verificationCode);

      expect(result.success).toBe(true);
      expect(sgMail.send).toHaveBeenCalledWith({
        to: email,
        from: 'noreply@gostashpay.com',
        templateId: 'd-336f5143505f407f95d87ded5c2f19ab',
        dynamic_template_data: {
          VERIFICATION_CODE: verificationCode
        }
      });
    });

    it('should use custom from email when set in environment', async () => {
      const originalFromEmail = process.env.FROM_EMAIL;
      process.env.FROM_EMAIL = 'custom@example.com';
      
      const email = 'test@example.com';
      const verificationCode = '123456';

      const result = await emailService.sendVerificationCode(email, verificationCode);

      expect(result.success).toBe(true);
      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com'
        })
      );

      // Restore original value
      process.env.FROM_EMAIL = originalFromEmail;
    });

    it('should handle SendGrid errors', async () => {
      const error = new Error('SendGrid API error');
      error.code = 400;
      sgMail.send.mockRejectedValue(error);

      const result = await emailService.sendVerificationCode('test@example.com', '123456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('SendGrid API error');
    });

    it('should handle missing API key error', async () => {
      const error = new Error('Unauthorized');
      error.code = 401;
      sgMail.send.mockRejectedValue(error);

      const result = await emailService.sendVerificationCode('test@example.com', '123456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized');
    });
  });

  describe('testEmail', () => {
    it('should send test email successfully', async () => {
      const email = 'test@example.com';

      const result = await emailService.testEmail(email);

      expect(result.success).toBe(true);
      expect(sgMail.send).toHaveBeenCalledWith({
        to: email,
        from: 'noreply@gostashpay.com',
        subject: 'Test Email from StashPay',
        html: '<h1>Test Email</h1><p>This is a test email from StashPay.</p>',
        text: 'This is a test email from StashPay.'
      });
    });

    it('should handle test email errors', async () => {
      const error = new Error('Test email failed');
      sgMail.send.mockRejectedValue(error);

      const result = await emailService.testEmail('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test email failed');
    });
  });

  describe('sendPaymentCompletedEmail', () => {
    it('should send payment completed email successfully', async () => {
      const email = 'test@example.com';
      const payment = {
        paymentId: 'payment-123',
        amount: 50.00,
        date: new Date('2024-01-15T12:00:00')
      };

      const result = await emailService.sendPaymentCompletedEmail(email, payment);

      expect(result.success).toBe(true);
      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: email,
          from: 'noreply@gostashpay.com',
          templateId: 'd-32df5e583d744879bc365fb044e8cbe7',
          dynamic_template_data: expect.objectContaining({
            PAYMENT_ID: 'payment-123',
            AMOUNT: '$50.00',
            DATE: expect.stringMatching(/^January \d{1,2}, 2024$/)
          })
        })
      );
    });

    it('should format payment amount as currency correctly', async () => {
      const email = 'test@example.com';
      const payment = {
        paymentId: 'payment-456',
        amount: 1234.56,
        date: new Date('2024-01-15T12:00:00')
      };

      await emailService.sendPaymentCompletedEmail(email, payment);

      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          dynamic_template_data: expect.objectContaining({
            AMOUNT: '$1,234.56'
          })
        })
      );
    });

    it('should format payment date correctly', async () => {
      const email = 'test@example.com';
      const payment = {
        paymentId: 'payment-789',
        amount: 100.00,
        date: new Date('2024-12-25T12:00:00')
      };

      await emailService.sendPaymentCompletedEmail(email, payment);

      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          dynamic_template_data: expect.objectContaining({
            DATE: expect.stringMatching(/^December \d{1,2}, 2024$/)
          })
        })
      );
    });

    it('should use current date when payment date is missing', async () => {
      const email = 'test@example.com';
      const payment = {
        paymentId: 'payment-999',
        amount: 75.00
        // date is missing
      };

      const beforeCall = new Date();
      await emailService.sendPaymentCompletedEmail(email, payment);
      const afterCall = new Date();

      expect(sgMail.send).toHaveBeenCalled();
      const callArgs = sgMail.send.mock.calls[0][0];
      const formattedDate = callArgs.dynamic_template_data.DATE;
      
      // Should be a formatted date string
      expect(formattedDate).toMatch(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$/);
    });

    it('should handle missing payment ID', async () => {
      const email = 'test@example.com';
      const payment = {
        amount: 50.00,
        date: new Date('2024-01-15T12:00:00')
        // paymentId is missing
      };

      const result = await emailService.sendPaymentCompletedEmail(email, payment);

      expect(result.success).toBe(true);
      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          dynamic_template_data: expect.objectContaining({
            PAYMENT_ID: 'N/A'
          })
        })
      );
    });

    it('should use custom from email when set in environment', async () => {
      const originalFromEmail = process.env.FROM_EMAIL;
      process.env.FROM_EMAIL = 'custom@example.com';
      
      const email = 'test@example.com';
      const payment = {
        paymentId: 'payment-123',
        amount: 50.00,
        date: new Date('2024-01-15T12:00:00')
      };

      const result = await emailService.sendPaymentCompletedEmail(email, payment);

      expect(result.success).toBe(true);
      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com'
        })
      );

      // Restore original value
      process.env.FROM_EMAIL = originalFromEmail;
    });

    it('should handle SendGrid errors', async () => {
      const error = new Error('SendGrid API error');
      error.code = 400;
      sgMail.send.mockRejectedValue(error);

      const payment = {
        paymentId: 'payment-123',
        amount: 50.00,
        date: new Date('2024-01-15T12:00:00')
      };

      const result = await emailService.sendPaymentCompletedEmail('test@example.com', payment);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SendGrid API error');
    });

    it('should handle missing API key error', async () => {
      const error = new Error('Unauthorized');
      error.code = 401;
      sgMail.send.mockRejectedValue(error);

      const payment = {
        paymentId: 'payment-123',
        amount: 50.00,
        date: new Date('2024-01-15T12:00:00')
      };

      const result = await emailService.sendPaymentCompletedEmail('test@example.com', payment);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized');
    });
  });
});
