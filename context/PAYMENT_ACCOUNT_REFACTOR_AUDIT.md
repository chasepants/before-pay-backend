# PaymentAccount Refactor - Impact Analysis & Audit

## Executive Summary

This document outlines the impact analysis, design critiques, testing requirements, and migration considerations for the PaymentAccount refactor that normalizes bank account information and removes redundant fields from the Payment model.

## Changes Made

### 1. New PaymentAccount Model
- **Purpose**: Normalize bank account information (previously duplicated in `SavingsGoal.bank` and `Payment`)
- **Fields**:
  - `userId` (required) - Links to User
  - `bankName`, `bankAccountName`, `bankLastFour` - Bank account details
  - `accountType` - 'savings' or 'checking' (bank account type, not user/merchant)
  - `plaidProcessorToken` (required) - For ACH payments
  - `isActive` - Soft delete flag
  - **Note**: `shopDomain` was removed - merchant relationships determined via `User.shopifyMerchantId`

### 2. Payment Model Changes
- **Removed**: `type` field (redundant with `direction`)
- **Removed**: `plaidProcessorToken` and `accountId` fields
- **Added**: `paymentAccountId` (required, references PaymentAccount)
- **Kept**: `direction` field ('Debit' or 'Credit')

### 3. Service Layer Changes

#### PaymentService
- **Before**: Derived `unitAccountId` from PaymentAccount's `shopDomain`
- **After**: Accepts `unitAccountId` as parameter (determined by SavingsGoalService)
- **Responsibility**: Pure payment operations - creates Unit payments and Payment records

#### SavingsGoalService (Conductor)
- **New Method**: `findOrCreatePaymentAccount()` - Finds or creates PaymentAccount
- **New Method**: `getUnitAccountIdForGoal()` - Determines Unit account ID:
  - Shopify goals: `User` → `shopifyMerchantId` → `ShopifyMerchant` → `unitAccountId`
  - Manual goals: `User` → `unitAccountId`
- **Updated**: `createPaymentForGoal()` now determines both PaymentAccount and Unit account ID
- **Updated**: `createBatchTransfer()` now finds destPlaidToken internally

### 4. Route Changes
- **bank.js**: Removed destPlaidToken finding logic (moved to SavingsGoalService)
- **savingsGoal.js**: Removed `shopDomain` parameter from payment creation
- **cron/process-scheduled-payments.js**: Removed `accountId` variable, removed `shopDomain` parameter

---

## Design Critique

### ✅ Strengths

1. **Clear Separation of Concerns**
   - `PaymentService`: Pure payment operations
   - `SavingsGoalService`: Business logic conductor (determines accounts, orchestrates payments)
   - Routes: HTTP handling only

2. **Better Normalization**
   - Bank info stored once in PaymentAccount
   - PaymentAccount can be reused across multiple goals
   - Easier to query "all payments from this account"

3. **Removed Redundancy**
   - Eliminated duplicate `type`/`direction` fields
   - Removed duplicated bank info from Payment model
   - Single source of truth for bank account information

4. **Improved Maintainability**
   - Unit account ID logic centralized in `getUnitAccountIdForGoal()`
   - PaymentAccount creation logic centralized in `findOrCreatePaymentAccount()`
   - Easier to update bank info in one place

### ⚠️ Potential Issues & Considerations

1. **PaymentAccount Creation Strategy**
   - **Current**: Auto-creates PaymentAccount on first payment
   - **Risk**: Could create duplicate PaymentAccounts if bank info changes
   - **Mitigation**: Query checks `plaidProcessorToken` uniqueness per user
   - **Future Consideration**: Should PaymentAccounts be created explicitly during bank linking?

2. **Backward Compatibility**
   - **Current**: `SavingsGoal.bank` still exists (used for PaymentAccount creation)
   - **Issue**: No migration path for existing goals
   - **Impact**: Existing goals will create PaymentAccounts on first payment
   - **Recommendation**: Add migration script to create PaymentAccounts for existing goals

3. **Missing PaymentAccount Reference on SavingsGoal**
   - **Current**: SavingsGoal doesn't reference PaymentAccount directly
   - **Issue**: Can't easily query "all goals using this payment account"
   - **Future Enhancement**: Consider adding `paymentAccountId` to SavingsGoal model

4. **Error Handling**
   - **Current**: `getUnitAccountIdForGoal()` throws errors if User/ShopifyMerchant not found
   - **Risk**: Could fail silently in some edge cases
   - **Recommendation**: Add comprehensive error logging and monitoring

5. **Test Coverage**
   - **Current**: Tests reference old `process-payments.js` (deprecated)
   - **Issue**: New unified cron (`process-scheduled-payments.js`) may not be fully tested
   - **Action Required**: Update/consolidate cron tests

---

## Regression Testing Requirements

### Critical Paths to Test

#### 1. Payment Creation Flows

**Manual Savings Goal Installments**
- [ ] Create manual savings goal with bank account
- [ ] Verify PaymentAccount is created
- [ ] Verify payment is created with correct PaymentAccount reference
- [ ] Verify Unit payment uses correct `unitAccountId` (from User)
- [ ] Verify `goal.transfers` array is updated correctly

**Shopify Savings Goal Installments**
- [ ] Create Shopify savings goal
- [ ] Verify PaymentAccount is created
- [ ] Verify payment uses merchant's `unitAccountId` (via User.shopifyMerchantId)
- [ ] Verify `goal.transfers` array is updated correctly

**Shopify Refunds**
- [ ] Initiate refund for Shopify goal
- [ ] Verify PaymentAccount is found/created
- [ ] Verify refund payment is Credit direction
- [ ] Verify goal amount is reset to 0
- [ ] Verify goal is paused

**Transfer Back (Batch)**
- [ ] Transfer back from multiple goals
- [ ] Verify destPlaidToken is found from goals
- [ ] Verify single Unit payment is created
- [ ] Verify multiple Payment records are created (one per goal)
- [ ] Verify all Payment records reference same PaymentAccount
- [ ] Verify goal amounts are decremented correctly

#### 2. Cron Job Execution

**Scheduled Payments**
- [ ] Verify cron processes manual goals on schedule
- [ ] Verify cron processes Shopify goals on schedule
- [ ] Verify cron skips paused goals
- [ ] Verify cron skips goals without plaidToken
- [ ] Verify cron handles missing User/ShopifyMerchant gracefully
- [ ] Verify PaymentAccount is reused if already exists

#### 3. Webhook Processing

**Payment State Changes**
- [ ] Verify `payment.created` webhook updates Payment status
- [ ] Verify `payment.clearing` webhook updates Payment status
- [ ] Verify `payment.completed` webhook updates goal amount
- [ ] Verify `payment.failed` webhook doesn't change goal amount
- [ ] Verify `transaction.created` webhook handles batch transfers

#### 4. Data Integrity

**PaymentAccount Reuse**
- [ ] Create multiple goals with same bank account
- [ ] Verify single PaymentAccount is created and reused
- [ ] Verify all payments reference same PaymentAccount

**Payment Queries**
- [ ] Query payments by savingsGoalId
- [ ] Query payments by userId
- [ ] Query payments by batchId
- [ ] Verify PaymentAccount is populated correctly

---

## Frontend Impact Analysis

### Files That May Need Updates

#### 1. Transaction History Display
**File**: `src/pages/ViewSavings.js` or similar
- **Current**: May display `transfer.type` (removed from Payment)
- **Action**: Update to use `transfer.direction` or derive from PaymentAccount
- **Impact**: Low - `goal.transfers` still has `type` field (backward compatibility)

#### 2. Payment Status Display
**File**: Any component showing payment details
- **Current**: May reference `payment.type`, `payment.plaidProcessorToken`, `payment.accountId`
- **Action**: Update to use `payment.direction` and `payment.paymentAccountId`
- **Impact**: Medium - If frontend queries Payment model directly

#### 3. Bank Account Display
**File**: Components showing bank account info
- **Current**: May read from `SavingsGoal.bank`
- **Action**: Consider reading from PaymentAccount via Payment
- **Impact**: Low - `SavingsGoal.bank` still exists for now

### API Response Changes

**No Breaking Changes Expected**
- Payment creation endpoints return same structure
- Transaction history endpoint (`GET /api/savings-goal/:id/transactions`) still uses `goal.transfers`
- Payment model changes are internal (not exposed in API responses)

---

## Unit Test Impact

### Tests That Need Updates

#### 1. `tests/cron/process-payments.test.js`
**Status**: ⚠️ **BROKEN** - Tests old deprecated cron file
- **Issue**: Tests `process-payments.js` which is deprecated
- **Action**: 
  - Update to test `process-scheduled-payments.js` instead
  - Mock `SavingsGoalService` instead of Unit SDK directly
  - Update expectations to include PaymentAccount creation
  - Verify `getUnitAccountIdForGoal()` is called correctly

**Key Changes Needed**:
```javascript
// OLD: Direct Unit SDK mocking
mockCreatePayment.mockResolvedValue({...});

// NEW: Mock SavingsGoalService
jest.mock('../../services/savingsGoalService');
const SavingsGoalService = require('../../services/savingsGoalService');
SavingsGoalService.prototype.createPaymentForGoal = jest.fn();
```

#### 2. `tests/webhooks/paymentWebhooks.test.js`
**Status**: ⚠️ **NEEDS REVIEW**
- **Issue**: Tests may reference old Payment model structure
- **Action**: 
  - Verify tests use `payment.direction` instead of `payment.type`
  - Ensure PaymentAccount is created in test setup
  - Update Payment creation to include `paymentAccountId`

**Key Changes Needed**:
```javascript
// OLD: Payment with type field
const payment = new Payment({
  type: 'debit',
  direction: 'Debit',
  plaidProcessorToken: 'token',
  accountId: 'account-id'
});

// NEW: Payment with paymentAccountId
const paymentAccount = await PaymentAccount.create({...});
const payment = new Payment({
  direction: 'Debit',
  paymentAccountId: paymentAccount._id
});
```

#### 3. `tests/routes/savingsGoal.test.js`
**Status**: ⚠️ **NEEDS REVIEW**
- **Issue**: May test refund route which now uses PaymentAccount
- **Action**: 
  - Update refund tests to verify PaymentAccount creation
  - Mock `SavingsGoalService.createPaymentForGoal()`
  - Verify `getUnitAccountIdForGoal()` is called for Shopify goals

#### 4. `tests/routes/bank.test.js`
**Status**: ⚠️ **NEEDS REVIEW**
- **Issue**: Tests batch transfer route which now uses PaymentAccount
- **Action**: 
  - Update batch transfer tests to verify PaymentAccount creation
  - Verify `findDestinationPlaidToken()` is called
  - Verify `getUnitAccountIdForGoal()` is called

### New Test Files Needed

#### 1. `tests/services/savingsGoalService.test.js` ⭐ **NEW**
**Purpose**: Test SavingsGoalService as the conductor
**Test Cases**:
- `findOrCreatePaymentAccount()` - creates new PaymentAccount
- `findOrCreatePaymentAccount()` - reuses existing PaymentAccount
- `getUnitAccountIdForGoal()` - returns user's unitAccountId for manual goals
- `getUnitAccountIdForGoal()` - returns merchant's unitAccountId for Shopify goals
- `getUnitAccountIdForGoal()` - throws error if User not found
- `getUnitAccountIdForGoal()` - throws error if ShopifyMerchant not found
- `createPaymentForGoal()` - creates payment with correct PaymentAccount
- `createPaymentForGoal()` - determines correct Unit account ID
- `createBatchTransfer()` - finds destPlaidToken from goals
- `createBatchTransfer()` - creates single Unit payment, multiple Payment records

#### 2. `tests/services/paymentService.test.js` ⭐ **NEW**
**Purpose**: Test PaymentService payment operations
**Test Cases**:
- `createPayment()` - creates Unit payment with correct PaymentAccount
- `createPayment()` - creates Payment record with paymentAccountId
- `createPayment()` - throws error if PaymentAccount not found
- `createPayment()` - throws error if required fields missing
- `updatePaymentStatus()` - updates payment status
- `getPaymentsForGoal()` - returns payments for goal
- `getPaymentsByBatchId()` - returns payments for batch

#### 3. `tests/models/PaymentAccount.test.js` ⭐ **NEW**
**Purpose**: Test PaymentAccount model
**Test Cases**:
- PaymentAccount creation with required fields
- PaymentAccount validation (accountType enum)
- PaymentAccount indexes
- PaymentAccount relationships

#### 4. `tests/cron/process-scheduled-payments.test.js` ⭐ **NEW**
**Purpose**: Test unified cron job
**Test Cases**:
- Processes manual goals on schedule
- Processes Shopify goals on schedule
- Skips paused goals
- Skips goals without plaidToken
- Handles missing User/ShopifyMerchant
- Handles payment creation errors

---

## Migration Considerations

### Database Migration

#### 1. Existing Payment Records
**Issue**: Existing Payment records have `plaidProcessorToken` and `accountId` but no `paymentAccountId`
**Options**:
1. **Lazy Migration**: Create PaymentAccount on first payment (current approach)
2. **Active Migration**: Script to create PaymentAccounts for all existing goals

**Recommendation**: Start with lazy migration, add active migration script later if needed

#### 2. Existing SavingsGoal Records
**Issue**: `SavingsGoal.bank` still exists but PaymentAccount not created until first payment
**Options**:
1. **Keep as-is**: PaymentAccount created on-demand (current approach)
2. **Pre-create**: Script to create PaymentAccounts for all goals with bank info

**Recommendation**: Keep as-is for now, add pre-creation script if needed for reporting

### Backward Compatibility

#### Current State
- ✅ `SavingsGoal.bank` still exists (used for PaymentAccount creation)
- ✅ `goal.transfers` still has `type` field (derived from `direction`)
- ✅ Payment creation endpoints unchanged
- ✅ Transaction history endpoint unchanged

#### Breaking Changes
- ❌ Payment model no longer has `type`, `plaidProcessorToken`, `accountId` fields
- ⚠️ Direct Payment queries will fail if they reference removed fields

**Mitigation**: 
- Update all Payment queries to use `direction` instead of `type`
- Update all Payment queries to use `paymentAccountId` instead of `plaidProcessorToken`/`accountId`

---

## Action Items

### Immediate (Before Deployment)

1. **Update Unit Tests**
   - [ ] Fix `tests/cron/process-payments.test.js` (update to test new cron)
   - [ ] Review and update `tests/webhooks/paymentWebhooks.test.js`
   - [ ] Review and update `tests/routes/savingsGoal.test.js`
   - [ ] Review and update `tests/routes/bank.test.js`

2. **Create New Test Files**
   - [ ] `tests/services/savingsGoalService.test.js`
   - [ ] `tests/services/paymentService.test.js`
   - [ ] `tests/models/PaymentAccount.test.js`
   - [ ] `tests/cron/process-scheduled-payments.test.js`

3. **Frontend Review** ✅
   - [x] Search frontend codebase for Payment model references
   - [x] Update any components that query Payment directly (No changes needed - frontend uses `goal.transfers`)
   - [x] Verify transaction history display works correctly
   
   **Findings:**
   - Frontend does NOT directly query Payment model
   - All frontend components use `goal.transfers` array which is kept in sync for backward compatibility
   - Transaction history endpoint (`/api/savings-goal/:id/transactions`) returns data from `goal.transfers`
   - Frontend uses `transfer.type` which is still available in `goal.transfers` (backward compatibility)
   - **No frontend changes required** - The refactor maintains backward compatibility through `goal.transfers`

4. **Integration Testing**
   - [ ] Test manual savings goal payment flow end-to-end
   - [ ] Test Shopify savings goal payment flow end-to-end
   - [ ] Test refund flow end-to-end
   - [ ] Test batch transfer flow end-to-end
   - [ ] Test cron job execution
   - [ ] Test webhook processing

### Short-term (Post-Deployment)

1. **Monitoring**
   - [ ] Add logging for PaymentAccount creation
   - [ ] Add logging for `getUnitAccountIdForGoal()` errors
   - [ ] Monitor payment creation success rate
   - [ ] Monitor PaymentAccount reuse rate

2. **Documentation**
   - [ ] Update API documentation
   - [ ] Update architecture diagrams
   - [ ] Document PaymentAccount lifecycle

3. **Optimization**
   - [ ] Consider adding `paymentAccountId` to SavingsGoal model
   - [ ] Consider pre-creating PaymentAccounts during bank linking
   - [ ] Consider PaymentAccount caching for frequently accessed accounts

### Long-term (Future Enhancements)

1. **Schema Evolution**
   - [ ] Consider removing `SavingsGoal.bank` (after PaymentAccount migration)
   - [ ] Consider removing `type` from `goal.transfers` (use `direction` only)

2. **Feature Enhancements**
   - [ ] PaymentAccount management UI (view/edit/delete accounts)
   - [ ] PaymentAccount selection during goal creation
   - [ ] PaymentAccount sharing across goals

---

## Risk Assessment

### High Risk Areas

1. **Payment Creation Failure**
   - **Risk**: PaymentAccount creation fails, payment creation fails
   - **Mitigation**: Comprehensive error handling, logging, retry logic
   - **Testing**: Extensive unit and integration tests

2. **Unit Account ID Resolution**
   - **Risk**: `getUnitAccountIdForGoal()` fails for Shopify goals if User.shopifyMerchantId missing
   - **Mitigation**: Validation during goal creation, error handling
   - **Testing**: Test all goal types, test missing data scenarios

3. **Backward Compatibility**
   - **Risk**: Existing code queries Payment model with removed fields
   - **Mitigation**: Comprehensive code search, update all queries
   - **Testing**: Full regression test suite

### Low Risk Areas

1. PaymentAccount model (new, no existing data)
2. PaymentService (well-isolated, easy to test)
3. Frontend (minimal changes expected)

---

## Conclusion

The PaymentAccount refactor improves code organization, reduces redundancy, and centralizes payment logic. The main risks are around testing coverage and backward compatibility. With proper test updates and integration testing, this refactor should be safe to deploy.

**Recommended Deployment Strategy**:
1. Deploy to staging environment
2. Run full regression test suite
3. Monitor for 24-48 hours
4. Deploy to production with feature flag (if possible)
5. Monitor closely for first week

