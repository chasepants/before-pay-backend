const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const CheckoutCart = require('../../models/CheckoutCart');
const ShopifyMerchant = require('../../models/ShopifyMerchant');
const { processAbandonedCarts } = require('../../cron/abandoned-carts');

// Mock the email service
jest.mock('../../services/emailService', () => ({
  sendEmail: jest.fn()
}));

const emailService = require('../../services/emailService');

describe('Abandoned Carts Cron Job', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear the database
    await CheckoutCart.deleteMany({});
    await ShopifyMerchant.deleteMany({});
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock successful email sending
    emailService.sendEmail.mockResolvedValue({ success: true });
  });

  describe('processAbandonedCarts', () => {
    it('should process abandoned checkouts and send emails', async () => {
      // Create merchants with emails enabled
      const merchant1 = new ShopifyMerchant({
        shopifyShopId: 'shop1',
        onboardingStatus: 'completed',
        abandonedCartEmailsEnabled: true
      });
      await merchant1.save();

      const merchant2 = new ShopifyMerchant({
        shopifyShopId: 'shop2',
        onboardingStatus: 'completed',
        abandonedCartEmailsEnabled: true
      });
      await merchant2.save();

      // Create test checkouts - some abandoned, some not
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const abandonedCheckout1 = new CheckoutCart({
        checkoutId: 'checkout-1',
        email: 'test1@example.com',
        shopDomain: 'shop1.myshopify.com',
        lineItems: [
          {
            productId: '67890',
            variantId: '11111',
            presentmentTitle: 'Test Product 1',
            quantity: 1,
            price: '99.99',
            sku: 'TEST-1',
            vendor: 'Test Vendor'
          }
        ],
        status: 'active',
        emailSent: false,
        createdAt: twoHoursAgo
      });

      const abandonedCheckout2 = new CheckoutCart({
        checkoutId: 'checkout-2',
        email: 'test2@example.com',
        shopDomain: 'shop2.myshopify.com',
        lineItems: [
          {
            productId: '11111',
            variantId: '22222',
            presentmentTitle: 'Test Product 2',
            quantity: 2,
            price: '74.99',
            sku: 'TEST-2',
            vendor: 'Test Vendor'
          }
        ],
        status: 'active',
        emailSent: false,
        createdAt: twoHoursAgo
      });

      const recentCheckout = new CheckoutCart({
        checkoutId: 'checkout-3',
        email: 'test3@example.com',
        shopDomain: 'shop3.myshopify.com',
        lineItems: [],
        status: 'active',
        emailSent: false,
        createdAt: thirtyMinutesAgo
      });

      const completedCheckout = new CheckoutCart({
        checkoutId: 'checkout-4',
        email: 'test4@example.com',
        shopDomain: 'shop4.myshopify.com',
        lineItems: [],
        status: 'completed',
        emailSent: false,
        createdAt: twoHoursAgo
      });

    //   const noEmailCheckout = new CheckoutCart({
    //     checkoutId: 'checkout-5',
    //     email: "",
    //     shopDomain: 'shop5.myshopify.com',
    //     lineItems: [],
    //     status: 'active',
    //     emailSent: false,
    //     createdAt: twoHoursAgo
    //   });

      const alreadySentCheckout = new CheckoutCart({
        checkoutId: 'checkout-6',
        email: 'test6@example.com',
        shopDomain: 'shop6.myshopify.com',
        lineItems: [],
        status: 'active',
        emailSent: true,
        createdAt: twoHoursAgo
      });

      await CheckoutCart.insertMany([
        abandonedCheckout1,
        abandonedCheckout2,
        recentCheckout,
        completedCheckout,
        // noEmailCheckout,
        alreadySentCheckout
      ]);

      await processAbandonedCarts();

      const processedCheckouts = await CheckoutCart.find({ status: 'abandoned' });
      expect(processedCheckouts).toHaveLength(2);
      expect(processedCheckouts.map(c => c.checkoutId)).toContain('checkout-1');
      expect(processedCheckouts.map(c => c.checkoutId)).toContain('checkout-2');

      expect(emailService.sendEmail).toHaveBeenCalledTimes(2);

      const firstEmailCall = emailService.sendEmail.mock.calls[0][0];
      expect(firstEmailCall.to).toBe('test1@example.com');
      expect(firstEmailCall.subject).toContain('Complete your purchase with StashPay');
      expect(firstEmailCall.html).toContain('Test Product 1');
      expect(firstEmailCall.html).toContain('checkout-1');

      const secondEmailCall = emailService.sendEmail.mock.calls[1][0];
      expect(secondEmailCall.to).toBe('test2@example.com');
      expect(secondEmailCall.subject).toContain('Complete your purchase with StashPay');
      expect(secondEmailCall.html).toContain('Test Product 2');
      expect(secondEmailCall.html).toContain('checkout-2');

      // Check that other checkouts were not modified
      const recentCheckoutAfter = await CheckoutCart.findOne({ checkoutId: 'checkout-3' });
      expect(recentCheckoutAfter.status).toBe('active');
      expect(recentCheckoutAfter.emailSent).toBe(false);

      const completedCheckoutAfter = await CheckoutCart.findOne({ checkoutId: 'checkout-4' });
      expect(completedCheckoutAfter.status).toBe('completed');

    //   const noEmailCheckoutAfter = await CheckoutCart.findOne({ checkoutId: 'checkout-5' });
    //   expect(noEmailCheckoutAfter.status).toBe('active');
    //   expect(noEmailCheckoutAfter.emailSent).toBe(false);

      const alreadySentCheckoutAfter = await CheckoutCart.findOne({ checkoutId: 'checkout-6' });
      expect(alreadySentCheckoutAfter.status).toBe('active');
      expect(alreadySentCheckoutAfter.emailSent).toBe(true);
    });

    it('should handle email sending errors gracefully', async () => {
      // Create merchant with emails enabled
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'error-shop',
        onboardingStatus: 'completed',
        abandonedCartEmailsEnabled: true
      });
      await merchant.save();

      // Create abandoned checkout
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const abandonedCheckout = new CheckoutCart({
        checkoutId: 'checkout-error',
        email: 'error@example.com',
        shopDomain: 'error-shop.myshopify.com',
        lineItems: [],
        status: 'active',
        emailSent: false,
        createdAt: twoHoursAgo
      });
      await abandonedCheckout.save();

      // Mock email service to throw error
      emailService.sendEmail.mockRejectedValue(new Error('Email service error'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Run the abandoned cart processing
      await processAbandonedCarts();

      // Check that error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error processing checkout checkout-error:',
        expect.any(Error)
      );

      // Check that checkout was still marked as abandoned despite email error
      const processedCheckout = await CheckoutCart.findOne({ checkoutId: 'checkout-error' });
      expect(processedCheckout.status).toBe('abandoned');
      expect(processedCheckout.emailSent).toBe(true);

      consoleErrorSpy.mockRestore();
    });

    it('should respect MAX_EMAILS_PER_RUN limit', async () => {
      // Create merchants with emails enabled for all shops
      for (let i = 0; i < 55; i++) {
        const merchant = new ShopifyMerchant({
          shopifyShopId: `shop${i}`,
          onboardingStatus: 'completed',
          abandonedCartEmailsEnabled: true
        });
        await merchant.save();
      }

      // Create more than MAX_EMAILS_PER_RUN (50) abandoned checkouts
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const checkouts = [];
      
      for (let i = 0; i < 55; i++) {
        checkouts.push({
          checkoutId: `checkout-${i}`,
          email: `test${i}@example.com`,
          shopDomain: `shop${i}.myshopify.com`,
          lineItems: [],
          status: 'active',
          emailSent: false,
          createdAt: twoHoursAgo
        });
      }

      await CheckoutCart.insertMany(checkouts);

      // Run the abandoned cart processing
      await processAbandonedCarts();

      // Check that only 50 emails were sent (MAX_EMAILS_PER_RUN)
      expect(emailService.sendEmail).toHaveBeenCalledTimes(50);

      // Check that 50 checkouts were marked as abandoned
      const abandonedCheckouts = await CheckoutCart.find({ status: 'abandoned' });
      expect(abandonedCheckouts).toHaveLength(50);

      // Check that 5 checkouts remain active
      const activeCheckouts = await CheckoutCart.find({ status: 'active' });
      expect(activeCheckouts).toHaveLength(5);
    });

    it('should handle no abandoned checkouts gracefully', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      // Run the abandoned cart processing with no checkouts
      await processAbandonedCarts();

      // Check that appropriate log message was printed
      expect(consoleLogSpy).toHaveBeenCalledWith('Found 0 abandoned checkouts to process');
      expect(consoleLogSpy).toHaveBeenCalledWith('Abandoned cart processing completed. Processed: 0, Errors: 0');

      // Check that no emails were sent
      expect(emailService.sendEmail).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error by mocking the entire query chain
      const mockQuery = {
        limit: jest.fn().mockRejectedValue(new Error('Database connection error'))
      };
      const findSpy = jest.spyOn(CheckoutCart, 'find').mockReturnValue(mockQuery);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Run the abandoned cart processing
      await expect(processAbandonedCarts()).rejects.toThrow('Database connection error');

      // Check that error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error in abandoned cart processing:',
        expect.any(Error)
      );

      findSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Email Content Generation', () => {
    it('should generate proper HTML email content', async () => {
      // Create merchant with emails enabled
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'completed',
        abandonedCartEmailsEnabled: true
      });
      await merchant.save();

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const checkout = new CheckoutCart({
        checkoutId: 'test-checkout',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        lineItems: [
          {
            productId: '67890',
            variantId: '11111',
            presentmentTitle: 'Test Product',
            quantity: 2,
            price: '99.99',
            sku: 'TEST-SKU',
            vendor: 'Test Vendor'
          }
        ],
        status: 'active',
        emailSent: false,
        createdAt: twoHoursAgo
      });
      await checkout.save();

      await processAbandonedCarts();

      const emailCall = emailService.sendEmail.mock.calls[0][0];

      expect(emailCall.html).toContain('Don\'t miss out on your items!');
      expect(emailCall.html).toContain('test-shop.myshopify.com');
      expect(emailCall.html).toContain('Test Product');
      expect(emailCall.html).toContain('test-checkout');
      expect(emailCall.html).toContain('Save Now, Buy Later with StashPay');
    });

    it('should generate proper text email content', async () => {
      // Create merchant with emails enabled
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'completed',
        abandonedCartEmailsEnabled: true
      });
      await merchant.save();

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const checkout = new CheckoutCart({
        checkoutId: 'test-checkout',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        lineItems: [
          {
            productId: '67890',
            variantId: '11111',
            presentmentTitle: 'Test Product',
            quantity: 1,
            price: '199.99',
            sku: 'TEST-SKU',
            vendor: 'Test Vendor'
          }
        ],
        status: 'active',
        emailSent: false,
        createdAt: twoHoursAgo
      });
      await checkout.save();

      await processAbandonedCarts();

      const emailCall = emailService.sendEmail.mock.calls[0][0];
      
      // Check text content
      expect(emailCall.text).toContain('Don\'t miss out on your items!');
      expect(emailCall.text).toContain('test-shop.myshopify.com');
      expect(emailCall.text).toContain('Test Product');
      expect(emailCall.text).toContain('test-checkout');
      expect(emailCall.text).toContain('Complete your purchase:');
    });

    it('should handle empty line items gracefully', async () => {
      // Create merchant with emails enabled
      const merchant = new ShopifyMerchant({
        shopifyShopId: 'test-shop',
        onboardingStatus: 'completed',
        abandonedCartEmailsEnabled: true
      });
      await merchant.save();

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const checkout = new CheckoutCart({
        checkoutId: 'empty-checkout',
        email: 'test@example.com',
        shopDomain: 'test-shop.myshopify.com',
        lineItems: [],
        status: 'active',
        emailSent: false,
        createdAt: twoHoursAgo
      });
      await checkout.save();

      await processAbandonedCarts();

      const emailCall = emailService.sendEmail.mock.calls[0][0];
      
      // Check that email was still sent even with empty line items
      expect(emailCall.html).toContain('Your Cart Items:');
      expect(emailCall.html).toContain('<ul>');
      expect(emailCall.html).toContain('</ul>');
    });
  });
});
