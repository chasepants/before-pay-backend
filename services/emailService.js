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
        dynamic_template_data: {
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

  async sendPaymentCompletedEmail(email, payment) {
    try {
      // Format payment amount as currency
      const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(payment.amount);
      
      // Format payment date
      const formattedDate = payment.date 
        ? new Date(payment.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        : new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });

      const msg = {
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@gostashpay.com',
        templateId: 'd-32df5e583d744879bc365fb044e8cbe7',
        dynamic_template_data: {
          PAYMENT_ID: payment.paymentId || 'N/A',
          AMOUNT: formattedAmount,
          DATE: formattedDate
        }
      };

      const result = await sgMail.send(msg);
      console.log(result);
      console.log(`Payment completed email sent successfully to ${email}`);
      return { success: true };
      
    } catch (error) {
      console.error('Error sending payment completed email:', error);
      if (error.response && error.response.body && error.response.body.errors) {
        console.error('SendGrid error details:', JSON.stringify(error.response.body.errors, null, 2));
      }
      // Include more details in the error message for debugging
      const errorMessage = error.response?.body?.errors?.[0]?.message || error.message;
      return { success: false, error: errorMessage };
    }
  }

  async sendPaymentReminderEmail(email, amount, date) {
    try {
      const msg = {
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@gostashpay.com',
        templateId: 'd-8f8278d638c640a4aa9555cc899e4197',
        dynamic_template_data: {
          AMOUNT: amount,
          DATE: date
        }
      };

      const result = await sgMail.send(msg);
      console.log(`Payment reminder email sent successfully to ${email}`);
      return { success: true };
      
    } catch (error) {
      console.error('Error sending payment reminder email:', error);
      if (error.response && error.response.body && error.response.body.errors) {
        console.error('SendGrid error details:', JSON.stringify(error.response.body.errors, null, 2));
      }
      const errorMessage = error.response?.body?.errors?.[0]?.message || error.message;
      return { success: false, error: errorMessage };
    }
  }

  async sendOrderCompletedEmailCustomer(email, orderId, shopDomain, totalAmount) {
    try {
      // Format order total as currency
      const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(parseFloat(totalAmount) || 0);

      const msg = {
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@gostashpay.com',
        templateId: 'd-397fc28d7d55461cb7cacaa751b20627', // TODO: Replace with actual template ID
        dynamic_template_data: {
          ORDER_ID: orderId || 'N/A',
          SHOP_DOMAIN: shopDomain || 'N/A',
          TOTAL_AMOUNT: formattedAmount
        }
      };

      const result = await sgMail.send(msg);
      console.log(`Order completed email sent successfully to customer ${email}`);
      return { success: true };
      
    } catch (error) {
      console.error('Error sending order completed email to customer:', error);
      if (error.response && error.response.body && error.response.body.errors) {
        console.error('SendGrid error details:', JSON.stringify(error.response.body.errors, null, 2));
      }
      const errorMessage = error.response?.body?.errors?.[0]?.message || error.message;
      return { success: false, error: errorMessage };
    }
  }

  async sendOrderCompletedEmailMerchant(email, orderId, shopDomain, totalAmount, customerEmail) {
    try {
      // Format order total as currency
      const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(parseFloat(totalAmount) || 0);

      const msg = {
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@gostashpay.com',
        templateId: 'd-ORDER_COMPLETED_MERCHANT_TEMPLATE_ID', // TODO: Replace with actual template ID
        dynamic_template_data: {
          ORDER_ID: orderId || 'N/A',
          SHOP_DOMAIN: shopDomain || 'N/A',
          TOTAL_AMOUNT: formattedAmount,
          CUSTOMER_EMAIL: customerEmail || 'N/A'
        }
      };

      const result = await sgMail.send(msg);
      console.log(`Order completed email sent successfully to merchant ${email}`);
      return { success: true };
      
    } catch (error) {
      console.error('Error sending order completed email to merchant:', error);
      if (error.response && error.response.body && error.response.body.errors) {
        console.error('SendGrid error details:', JSON.stringify(error.response.body.errors, null, 2));
      }
      const errorMessage = error.response?.body?.errors?.[0]?.message || error.message;
      return { success: false, error: errorMessage };
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
      if (error.response && error.response.body && error.response.body.errors) {
        console.error('SendGrid error details:', JSON.stringify(error.response.body.errors, null, 2));
      }
      const errorMessage = error.response?.body?.errors?.[0]?.message || error.message;
      return { success: false, error: errorMessage };
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
}

// Export a singleton instance
module.exports = new EmailService();
