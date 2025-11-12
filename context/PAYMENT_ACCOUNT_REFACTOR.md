# PaymentAccount Refactor Proposal

## Current Problems

1. **Redundant Fields in Payment Model**:
   - `type` and `direction` both indicate debit/credit (redundant)
   - `plaidProcessorToken` and `accountId` stored on every payment
   - Bank info duplicated between `SavingsGoal.bank` and `Payment`

2. **Data Duplication**:
   - Bank info stored in `SavingsGoal.bank` (bankName, bankLastFour, plaidToken)
   - Same info stored in `Payment` (plaidProcessorToken, accountId)
   - No way to reuse payment accounts across goals

3. **Poor Normalization**:
   - Payment accounts are embedded in goals
   - Can't query "all payments from this bank account"
   - Can't easily update bank info if it changes

## Proposed Architecture

### PaymentAccount Model
```javascript
PaymentAccount {
  userId: ObjectId,
  bankName: String,
  bankAccountName: String,
  bankLastFour: String,
  bankAccountType: String,
  plaidProcessorToken: String,  // Required
  accountType: 'user' | 'merchant',  // Required
  shopDomain: String? (for merchants),
  isActive: Boolean
  
  // Note: unitAccountId is NOT stored here
  // - For 'user': Retrieved from User.unitAccountId
  // - For 'merchant': Retrieved from ShopifyMerchant.unitAccountId (via shopDomain)
}
```

### Updated SavingsGoal Model
```javascript
SavingsGoal {
  // ... existing fields ...
  paymentAccountId: ObjectId (ref: PaymentAccount),  // NEW
  // Remove: bank: { ... }  // OLD
}
```

### Updated Payment Model
```javascript
Payment {
  // ... existing fields ...
  paymentAccountId: ObjectId (ref: PaymentAccount),  // NEW
  direction: 'Debit' | 'Credit',  // Keep direction, remove type
  // Remove: plaidProcessorToken, accountId  // OLD
}
```

## Benefits

1. **No Redundancy**: Bank info stored once in PaymentAccount
2. **Reusability**: Payment accounts can be shared across goals
3. **Better Queries**: "All payments from this account", "All goals using this account"
4. **Easier Updates**: Update bank info in one place
5. **Clearer Model**: PaymentAccount = bank account, Payment = transaction

## Migration Strategy

1. Create PaymentAccount model
2. Migrate existing `SavingsGoal.bank` data to PaymentAccount records
3. Update SavingsGoal to reference PaymentAccount
4. Update Payment to reference PaymentAccount
5. Update all code that reads/writes bank info
6. Remove old `bank` schema from SavingsGoal

## Questions

1. **Should PaymentAccount be per-user or per-goal?**
   - Option A: One PaymentAccount per user (reusable)
   - Option B: One PaymentAccount per goal (simpler migration)
   - **Recommendation**: Option A - allows account reuse

2. **What about merchant accounts?**
   - Merchant accounts are per-shop, not per-user
   - Could have `accountType: 'merchant'` and `shopDomain` field
   - Or separate MerchantPaymentAccount model?

3. **Should we keep `direction` or `type` in Payment?**
   - `direction` matches Unit API terminology (Debit/Credit)
   - `type` is more generic (debit/credit)
   - **Recommendation**: Keep `direction` (matches Unit), remove `type`

