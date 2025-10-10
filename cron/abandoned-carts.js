const CheckoutCart = require('../models/CheckoutCart');
const emailService = require('../services/emailService');

const ABANDONMENT_THRESHOLD_HOURS = 1;
const MAX_EMAILS_PER_RUN = 50;

async function processAbandonedCarts() {
  try {
    console.log('Starting abandoned cart processing...');
    
    const cutoffTime = new Date(Date.now() - (ABANDONMENT_THRESHOLD_HOURS * 60 * 60 * 1000));
    
    const abandonedCheckouts = await CheckoutCart.find({
      status: 'active',
      email: { $exists: true, $ne: null, $ne: '' },
      emailSent: false,
      createdAt: { $lte: cutoffTime }
    }).limit(MAX_EMAILS_PER_RUN);

    console.log(`Found ${abandonedCheckouts.length} abandoned checkouts to process`);

    let processedCount = 0;
    let errorCount = 0;

    for (const checkout of abandonedCheckouts) {
      try {
        await processAbandonedCheckout(checkout);
        processedCount++;
      } catch (error) {
        console.error(`Error processing checkout ${checkout.checkoutId}:`, error);
        errorCount++;
      }
    }

    console.log(`Abandoned cart processing completed. Processed: ${processedCount}, Errors: ${errorCount}`);

  } catch (error) {
    console.error('Error in abandoned cart processing:', error);
    throw error;
  }
}

async function processAbandonedCheckout(checkout) {
  try {
    checkout.status = 'abandoned';
    checkout.abandonedAt = new Date();
    checkout.emailSent = true;
    checkout.emailSentAt = new Date();
    await checkout.save();

    await sendAbandonedCartEmail(checkout);

    console.log(`Abandoned cart email sent for checkout ${checkout.checkoutId} to ${checkout.email}`);

  } catch (error) {
    console.error(`Error processing abandoned checkout ${checkout.checkoutId}:`, error);
    throw error;
  }
}

async function sendAbandonedCartEmail(checkout) {
  try {
    const emailData = {
      to: checkout.email,
      checkoutId: checkout.checkoutId,
      lineItems: checkout.lineItems,
      shopDomain: checkout.shopDomain
    };

    const subject = `Complete your purchase with StashPay - ${checkout.shopDomain}`;
    
    const htmlContent = generateAbandonedCartEmailHTML(emailData);
    const textContent = generateAbandonedCartEmailText(emailData);

    const result = await emailService.sendEmail({
      to: checkout.email,
      subject: subject,
      html: htmlContent,
      text: textContent
    });

    if (!result.success) {
      throw new Error(`Email send failed: ${result.error}`);
    }

  } catch (error) {
    console.error(`Error sending abandoned cart email for checkout ${checkout.checkoutId}:`, error);
    throw error;
  }
}

function generateAbandonedCartEmailHTML(data) {
  const itemsList = data.lineItems.map(item => 
    `<li><strong>${item.title}</strong> - ${item.price} (Qty: ${item.quantity})</li>`
  ).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Complete Your Purchase</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Don't miss out on your items!</h2>
      
      <p>Hello,</p>
      
      <p>We noticed you left some items in your cart at ${data.shopDomain}. Would you like to create a savings plan for any of these items with StashPay?</p>
      
      <h3>Your Cart Items:</h3>
      <ul>
        ${itemsList}
      </ul>
            
      <div style="margin: 30px 0;">
        <a href="https://${data.shopDomain}/checkout/${data.checkoutId}" 
           style="background-color: #007cba; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Complete Purchase
        </a>
      </div>
      
      <p>Or create a savings plan to pay over time:</p>
      <div style="margin: 20px 0;">
        <a href="https://stashpay.com/save-for-later?checkout=${data.checkoutId}" 
           style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Save for Later with StashPay
        </a>
      </div>
      
      <p>This offer expires in 24 hours.</p>
      
      <hr style="margin: 30px 0;">
      <p style="font-size: 12px; color: #666;">
        This email was sent because you started a checkout at ${data.shopDomain}. 
        If you completed your purchase, please ignore this email.
      </p>
    </body>
    </html>
  `;
}

function generateAbandonedCartEmailText(data) {
  const itemsList = data.lineItems.map(item => 
    `- ${item.title} - ${item.price} (Qty: ${item.quantity})`
  ).join('\n');

  return `
    Don't miss out on your items!

    Hello,

    We noticed you left some items in your cart at ${data.shopDomain}. Would you like to create a savings plan for any of these items with StashPay?

    Your Cart Items:
    ${itemsList}

    Complete your purchase: https://${data.shopDomain}/checkout/${data.checkoutId}

    Or create a savings plan to pay over time: https://stashpay.com/save-for-later?checkout=${data.checkoutId}

    This offer expires in 24 hours.

    ---
    This email was sent because you started a checkout at ${data.shopDomain}. 
    If you completed your purchase, please ignore this email.
  `;
}

module.exports = {
  processAbandonedCarts
};
