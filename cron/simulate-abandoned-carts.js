const mongoose = require('mongoose');
require('dotenv').config();
const { processAbandonedCarts } = require('./abandoned-carts');
const CheckoutCart = require('../models/CheckoutCart');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
}

async function simulateAbandonedCarts(thresholdMinutes) {
  await connectDB();

  console.log(`Simulating abandoned carts cron job`);
  console.log(`Threshold: ${thresholdMinutes ? thresholdMinutes + ' minutes' : 'default (1 hour)'}`);
  console.log('This simulates what the /api/cron/abandoned-carts endpoint would do');
  
  try {
    // Show current state before processing
    const activeCarts = await CheckoutCart.find({
      status: 'active',
      email: { $exists: true, $ne: null, $ne: '' }
    }).sort({ createdAt: -1 });

    const completedCarts = await CheckoutCart.find({
      status: 'completed'
    }).sort({ createdAt: -1 });

    console.log('\n=== CURRENT STATE ===');
    console.log(`Active carts: ${activeCarts.length}`);
    console.log(`Completed carts: ${completedCarts.length}`);
    
    if (activeCarts.length > 0) {
      console.log('\nActive carts:');
      activeCarts.forEach(cart => {
        const ageMinutes = Math.floor((Date.now() - cart.createdAt.getTime()) / (1000 * 60));
        console.log(`  - ${cart.checkoutId} (${cart.email}) - ${ageMinutes} minutes old - Email sent: ${cart.emailSent}`);
      });
    }

    console.log('\n=== PROCESSING ABANDONED CARTS ===');
    console.log('Cron job started at:', new Date().toISOString());
    
    await processAbandonedCarts(thresholdMinutes);
    
    console.log('Cron job completed at:', new Date().toISOString());

    // Show state after processing
    const activeCartsAfter = await CheckoutCart.find({
      status: 'active',
      email: { $exists: true, $ne: null, $ne: '' }
    }).sort({ createdAt: -1 });

    const abandonedCartsAfter = await CheckoutCart.find({
      status: 'abandoned'
    }).sort({ createdAt: -1 });

    console.log('\n=== AFTER PROCESSING ===');
    console.log(`Active carts: ${activeCartsAfter.length}`);
    console.log(`Abandoned carts: ${abandonedCartsAfter.length}`);
    
    if (abandonedCartsAfter.length > 0) {
      console.log('\nNewly abandoned carts:');
      abandonedCartsAfter.forEach(cart => {
        console.log(`  - ${cart.checkoutId} (${cart.email}) - Abandoned at: ${cart.abandonedAt}`);
      });
    }

    console.log('\nSimulation completed successfully');
  } catch (error) {
    console.error('Cron simulation failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

// Parse command line arguments
const thresholdMinutes = process.argv[2] ? parseFloat(process.argv[2]) : null;

if (thresholdMinutes !== null && (isNaN(thresholdMinutes) || thresholdMinutes < 0)) {
  console.error('Error: Threshold must be a positive number (minutes).');
  console.error('Usage: node simulate-abandoned-carts.js [threshold_minutes]');
  console.error('Examples:');
  console.error('  node simulate-abandoned-carts.js 0.5  # 30 seconds');
  console.error('  node simulate-abandoned-carts.js 1    # 1 minute');
  console.error('  node simulate-abandoned-carts.js 2    # 2 minutes');
  console.error('  node simulate-abandoned-carts.js      # default (1 hour)');
  process.exit(1);
}

simulateAbandonedCarts(thresholdMinutes).catch(error => {
  console.error('Simulation failed:', error);
  process.exit(1);
});
