# Transfers Array Refactor Plan

## Current State

Currently, `goal.transfers` is an array of embedded documents with full transfer data:
```javascript
transfers: [{
  transferId: String,      // Payment ID
  transactionId: String,
  batchId: String,
  amount: Number,
  date: Date,
  status: String,
  type: String
}]
```

This duplicates data that exists in the `Payment` model.

## Proposed Simplification

### Option 1: Just Payment IDs (Recommended)
```javascript
transfers: [String]  // Array of payment IDs
```

**Benefits:**
- No data duplication
- Single source of truth (Payment model)
- Simpler schema

**Challenges:**
- Frontend currently reads from `goal.transfers` directly
- Need to populate transfers from Payment model when needed
- Breaking change for frontend

### Option 2: Keep Current Structure (Current Approach)

**Benefits:**
- Backward compatible
- Frontend doesn't need changes
- Fast reads (no joins needed)

**Drawbacks:**
- Data duplication
- Need to keep in sync

## Recommendation

**Phase 1 (Current)**: Keep full structure for backward compatibility
- Payment model is source of truth
- `goal.transfers` is kept in sync for frontend compatibility
- Document that Payment model is authoritative

**Phase 2 (Future)**: Simplify to just payment IDs
- Update frontend to fetch transfers from Payment model
- Change schema to `transfers: [String]`
- Add helper method to populate transfers from Payment model when needed

## Implementation for Phase 2

```javascript
// In SavingsGoalService
async getTransfersForGoal(goalId) {
  return this.paymentService.getPaymentsForGoal(goalId);
}

// In routes, populate transfers when needed
const goal = await SavingsGoal.findById(goalId);
const transfers = await savingsGoalService.getTransfersForGoal(goalId);
goal.transfers = transfers; // For backward compatibility
```

## Current Usage

Frontend reads from `goal.transfers`:
- `MerchantDashboard.js` - displays transfer history
- `ViewOrder.js` - may display transfers

Backend uses `goal.transfers`:
- `routes/savingsGoal.js` - checks for pending transfers
- `cron/process-scheduled-payments.js` - checks if installment processed
- `routes/bank.js` - batch transfer logic

All of these could be updated to use Payment model queries instead.

