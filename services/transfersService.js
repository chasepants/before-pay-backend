// backend/services/transfersService.js
const processTransfersForDate = async (targetDate, savingsGoalService, unitService) => {
  // Find wishlist items ready for transfer
  const wishlistItems = await savingsGoalService.findByDate(targetDate);

  if (wishlistItems.length === 0) {
    return; // No logging needed per updated test
  }

  for (const item of wishlistItems) {
    const user = await savingsGoalService.findUserById(item.userId);
    if (!user || !user.dwollaCustomerId) {
      continue; // No logging needed per updated test
    }

    try {
      const transferResponse = await unitService.initiateTransfer(
        `https://api-${process.env.DWOLLA_ENVIRONMENT}.dwolla.com/funding-sources/${item.fundingSourceId}`,
        `https://api-${process.env.DWOLLA_ENVIRONMENT}.dwolla.com/funding-sources/${process.env.DWOLLA_FUNDING_SOURCE_ID}`,
        item.savingsAmount,
        { wishlistItemId: item._id }
      );

      // Update nextRunnable based on frequency
      const frequencyMap = { week: 7, biweek: 14, month: 30 }; // Days
      const daysToAdd = frequencyMap[item.savingsFrequency] || 7;
      item.nextRunnable = new Date(item.nextRunnable.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      item.savings_progress += item.savingsAmount; // Update savings progress

      const transferId = transferResponse.headers.get('location').split('/').pop();
      const transferDate = new Date();
      item.transfers.push({
        transferId,
        amount: item.savingsAmount,
        date: transferDate,
        status: 'pending', // Initial status, update via webhook
        type: 'debit'
      });

      await savingsGoalService.save(item);
    } catch (error) {
      continue; // No logging needed per updated test
    }
  }
};

module.exports = processTransfersForDate;