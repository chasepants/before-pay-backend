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
        dynamicTemplateData: {
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
});
