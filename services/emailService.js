const sgMail = require('@sendgrid/mail');

class EmailService {
  constructor() {
    this.initializeSendGrid();
  }

  initializeSendGrid() {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }

  async sendVerificationCode(email, verificationCode) {
    try {
      const msg = {
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@gostashpay.com',
        templateId: 'd-336f5143505f407f95d87ded5c2f19ab',
        dynamicTemplateData: {
          VERIFICATION_CODE: verificationCode
        }
      };

      const result = await sgMail.send(msg);
      console.log('Verification email sent successfully');
      return { success: true };
      
    } catch (error) {
      console.error('Error sending verification email:', error);
      return { success: false, error: error.message };
    }
  }

  // Test email sending (for development)
  async testEmail(toEmail) {
    try {
      const msg = {
        to: toEmail,
        from: process.env.FROM_EMAIL || 'noreply@gostashpay.com',
        subject: 'Test Email from StashPay',
        html: '<h1>Test Email</h1><p>This is a test email from StashPay.</p>',
        text: 'This is a test email from StashPay.'
      };

      const result = await sgMail.send(msg);
      console.log('Test email sent successfully');
      return { success: true };
      
    } catch (error) {
      console.error('Error sending test email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendEmail({ to, subject, html, text }) {
    try {
      const msg = {
        to: to,
        from: process.env.FROM_EMAIL || 'noreply@gostashpay.com',
        subject: subject,
        html: html,
        text: text
      };

      const result = await sgMail.send(msg);
      console.log('Email sent successfully');
      return { success: true };
      
    } catch (error) {
      console.error('Error sending email:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export a singleton instance
module.exports = new EmailService();
