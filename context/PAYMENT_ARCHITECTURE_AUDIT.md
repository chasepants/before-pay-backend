# Payment Architecture Audit & Refactor Proposal

## Current Payment System Overview

### Payment Features
1. **Manual Savings Goal Transfers** - Monthly recurring payments until goal is reached
2. **Shopify Savings Goal Installments** - Fixed 4-payment schedule
3. **Shopify Savings Goal Refunds** - All-or-nothing refunds
4. **Transfer Back** - Flexible partial transfers from multiple goals

### Payment Methods
- ACH payments via Plaid (processor tokens)
- Credit ACH payments (autopayments)
- Debit ACH payments (refunds)
- Payments can fail in either direction

---

## Current Architecture Analysis

### 1. Routes (`/api`)

#### Payment-Related Routes

| Route | Method | Location | Purpose | Issues |
|-------|--------|----------|---------|--------|
| `/api/savings-goal/:id/refund` | POST | `routes/savingsGoal.js` | Refund Shopify order | ❌ Payment logic in savings-goal routes |
| `/api/bank/transfers/batch` | POST | `routes/bank.js` | Transfer back to bank | ❌ Payment logic in bank routes |
| `/api/savings-goal/:id/schedule` | PUT | `routes/savingsGoal.js` | Setup payment schedule | ⚠️ Payment setup, not execution |

**Issues:**
- Payment creation logic scattered across multiple route files
- No dedicated payment resource routes
- Payment operations mixed with resource management
- Inconsistent error handling

### 2. Cron Jobs

#### `cron/process-payments.js`
- **Purpose**: Process scheduled payments for manual savings goals
- **Schedule**: Daily (checks dayOfMonth/dayOfWeek)
- **Logic**: 
  - Finds goals matching today's schedule
  - Skips Shopify goals
  - Creates ACH debit payments
  - Records transfers in goal.transfers array

**Issues:**
- Direct Unit SDK usage (not using UnitService)
- No retry logic for failed payments
- No payment validation before creation
- Error handling only logs, doesn't notify
- No idempotency checks

#### `cron/process-installments.js`
- **Purpose**: Process scheduled installments for Shopify goals
- **Schedule**: Daily (checks dayOfMonth/dayOfWeek)
- **Logic**:
  - Finds Shopify goals matching today's schedule
  - Checks if installment already processed
  - Creates ACH debit payments to merchant account
  - Records transfers in goal.transfers array

**Issues:**
- **Duplicate code** with `process-payments.js` (90% similar)
- Direct Unit SDK usage
- Complex installment tracking logic
- No retry logic
- No validation

**Code Duplication:**
- Both files have identical `todayPartsUTC()` function
- Both have similar payment creation logic
- Both have similar error handling
- Both query goals and create payments the same way

### 3. Webhooks (`webhooks/index.js`)

#### Payment Status Webhooks

| Webhook Event | Handler | Current Behavior | Issues |
|---------------|---------|------------------|--------|
| `payment.created` | `handlePaymentCreated` | Sets transfer status to 'pending' | ✅ OK |
| `payment.clearing` | `handlePaymentClearing` | Sets transfer status to 'pending' | ⚠️ Redundant with created |
| `payment.sent` | `handlePaymentSent` | Sets transfer status to 'pending' | ⚠️ Redundant with created |
| `payment.rejected` | `handlePaymentRejected` | Sets transfer status to 'failed' | ❌ No retry logic, no notification |
| `payment.returned` | `handlePaymentReturned` | Sets transfer status to 'failed' | ❌ No retry logic, no notification |
| `payment.canceled` | `handlePaymentCanceled` | Sets transfer status to 'canceled' | ✅ OK |
| `transaction.created` | `handleTransactionCreated` | Updates transfer to 'completed', adjusts goal amounts | ❌ Complex logic, special cases |

**Issues:**
- `handleTransactionCreated` is **300+ lines** with complex conditional logic
- Special handling for different payment types (batch, refund, regular)
- Business logic mixed with webhook handling
- No separation between payment status updates and goal updates
- No retry mechanism for failed payments
- No notification system for payment failures

**Complex Logic in `handleTransactionCreated`:**
1. Batch transfer back handling (lines 208-288)
2. Regular payment handling (lines 291-336)
3. Special Shopify refund logic (lines 313-318)
4. Goal completion logic (lines 324-333)
5. Multiple database queries and updates

### 4. Services

#### `services/unitService.js`
- **Current State**: Basic wrapper around Unit SDK
- **Methods**: `createPayment()`, `createApplication()`, `getAccount()`, etc.
- **Issues**:
  - No payment validation
  - No retry logic
  - No payment status tracking
  - No idempotency handling
  - Generic error messages

---

## Problems Identified

### 1. **Architectural Issues**

#### ❌ No Payment Service Layer
- Payment creation logic duplicated in:
  - `cron/process-payments.js`
  - `cron/process-installments.js`
  - `routes/savingsGoal.js` (refund)
  - `routes/bank.js` (transfer back)
- No centralized payment business logic
- Inconsistent payment creation patterns

#### ❌ Payment Logic Mixed with Domain Logic
- Goal management mixed with payment execution
- Webhook handlers contain business logic
- Routes contain payment creation code

#### ❌ No Payment State Management
- Payment status tracked only in `goal.transfers` array
- No dedicated payment/transfer model
- No payment history or audit trail
- Difficult to query payments across goals

#### ❌ No Failure Handling Strategy
- Failed payments just marked as 'failed'
- No retry mechanism
- No notification system
- No failure analytics

### 2. **Code Quality Issues**

#### ❌ Massive Code Duplication
- `process-payments.js` and `process-installments.js` are 90% identical
- Only difference: account source (user vs merchant) and goal filtering

#### ❌ Complex Webhook Handler
- `handleTransactionCreated` is 300+ lines
- Multiple responsibilities:
  - Payment status updates
  - Goal amount calculations
  - Goal completion logic
  - Special case handling

#### ❌ Inconsistent Error Handling
- Some places use try-catch, others don't
- Error messages inconsistent
- No structured error logging

### 3. **Missing Features**

#### ❌ No Payment Retry Logic
- Failed payments are not retried
- No exponential backoff
- No max retry limits

#### ❌ No Payment Notifications
- Users not notified of payment failures
- No email alerts
- No in-app notifications

#### ❌ No Payment Analytics
- No payment success/failure rates
- No payment timing analytics
- No retry statistics

#### ❌ No Idempotency
- No checks to prevent duplicate payments
- Could create duplicate payments if cron runs twice

---

## Proposed Architecture

### 1. **Payment Service Layer**

Create a dedicated `services/paymentService.js` that handles:
- Payment creation (with validation)
- Payment status tracking
- Retry logic
- Idempotency checks
- Payment notifications

**Benefits:**
- Single source of truth for payment logic
- Consistent error handling
- Easier testing
- Reusable across routes and cron jobs

### 2. **Payment Model**

Create a dedicated `models/Payment.js` model:
- Separate from `SavingsGoal.transfers`
- Better querying and analytics
- Payment history
- Audit trail

**Schema:**
```javascript
{
  paymentId: String,        // Unit payment ID
  transactionId: String,    // Unit transaction ID
  savingsGoalId: ObjectId,   // Reference to goal
  userId: ObjectId,         // Reference to user
  type: String,             // 'debit' | 'credit'
  direction: String,        // 'Debit' | 'Credit'
  amount: Number,           // In dollars
  status: String,           // 'pending' | 'completed' | 'failed' | 'canceled'
  paymentType: String,      // 'manual_installment' | 'shopify_installment' | 'refund' | 'transfer_back'
  batchId: String,          // For batch transfers
  plaidProcessorToken: String,
  accountId: String,         // Unit account ID
  retryCount: Number,
  lastRetryAt: Date,
  errorMessage: String,
  metadata: Object,         // Additional tags/metadata
  createdAt: Date,
  updatedAt: Date
}
```

**Benefits:**
- Better querying (find all failed payments, etc.)
- Payment analytics
- Easier debugging
- Audit trail

### 3. **Unified Cron Job**

Merge `process-payments.js` and `process-installments.js` into:
- `cron/process-scheduled-payments.js`
- Uses payment service
- Handles both manual and Shopify goals
- Configurable payment types

**Benefits:**
- Eliminates code duplication
- Single source of truth for scheduled payments
- Easier maintenance

### 4. **Payment Routes**

Create dedicated payment routes:
- `routes/payments.js`

**Routes:**
```
GET    /api/payments                    # List payments (with filters)
GET    /api/payments/:id                # Get single payment
POST   /api/payments                    # Create payment (for manual/one-off)
POST   /api/payments/:id/retry          # Retry failed payment
GET    /api/payments/savings-goal/:id   # Get payments for a goal
```

**Benefits:**
- RESTful payment resource
- Better API design
- Easier frontend integration

### 5. **Webhook Service**

Create `services/webhookService.js`:
- Handles all payment webhook events
- Updates payment status
- Triggers notifications
- Separates webhook handling from business logic

**Benefits:**
- Cleaner webhook handlers
- Testable webhook logic
- Consistent webhook processing

### 6. **Payment Status Updates**

Refactor `handleTransactionCreated`:
- Split into smaller functions:
  - `updatePaymentStatus()`
  - `updateGoalAmounts()`
  - `handleGoalCompletion()`
  - `handleBatchTransfer()`
  - `handleRefund()`

**Benefits:**
- Easier to test
- Clearer responsibilities
- Better error handling

---

## Recommended File Structure

```
before-pay-backend/
├── models/
│   ├── Payment.js                    # NEW: Dedicated payment model
│   └── SavingsGoal.js                # Keep, but remove transfers array?
│
├── services/
│   ├── paymentService.js             # NEW: Core payment logic
│   ├── paymentNotificationService.js # NEW: Payment notifications
│   ├── webhookService.js              # NEW: Webhook processing
│   └── unitService.js                 # Keep: Low-level Unit SDK wrapper
│
├── routes/
│   ├── payments.js                   # NEW: Payment resource routes
│   ├── savingsGoal.js                 # Remove payment creation logic
│   └── bank.js                        # Remove transfer-back logic
│
├── cron/
│   ├── process-scheduled-payments.js # NEW: Unified cron (replaces both)
│   └── process-payment-retries.js    # NEW: Retry failed payments
│
└── webhooks/
    └── index.js                       # Refactor: Use webhook service
```

---

## Migration Strategy

### Phase 1: Create Payment Service & Model
1. Create `models/Payment.js`
2. Create `services/paymentService.js`
3. Add migration to move existing transfers to Payment model
4. Update tests

### Phase 2: Refactor Cron Jobs
1. Create unified `process-scheduled-payments.js`
2. Update to use payment service
3. Deprecate old cron jobs
4. Update tests

### Phase 3: Refactor Routes
1. Create `routes/payments.js`
2. Move refund logic to payment service
3. Move transfer-back logic to payment service
4. Update frontend to use new routes
5. Update tests

### Phase 4: Refactor Webhooks
1. Create `services/webhookService.js`
2. Refactor `handleTransactionCreated`
3. Add payment notification service
4. Update tests

### Phase 5: Add Advanced Features
1. Add retry logic
2. Add notifications
3. Add analytics
4. Add idempotency checks

---

## Detailed Service Design

### `services/paymentService.js`

```javascript
class PaymentService {
  // Create a payment
  async createPayment(paymentData) {
    // Validate payment data
    // Check idempotency
    // Create payment via UnitService
    // Create Payment record
    // Return payment
  }

  // Create scheduled payment (for cron)
  async createScheduledPayment(goal, paymentType) {
    // Validate goal and schedule
    // Determine account (user vs merchant)
    // Create payment
    // Link to goal
  }

  // Retry failed payment
  async retryPayment(paymentId) {
    // Get payment
    // Check retry limits
    // Create new payment
    // Update payment record
  }

  // Update payment status (for webhooks)
  async updatePaymentStatus(paymentId, status, transactionId) {
    // Update Payment model
    // Update goal amounts if needed
    // Trigger notifications
  }

  // Get payments for a goal
  async getPaymentsForGoal(goalId) {
    // Query Payment model
    // Return payments
  }
}
```

### `services/webhookService.js`

```javascript
class WebhookService {
  // Process payment webhook
  async processPaymentWebhook(eventType, eventData) {
    // Route to appropriate handler
    // Update payment status
    // Trigger side effects (notifications, goal updates)
  }

  // Handle transaction created
  async handleTransactionCreated(eventData) {
    // Update payment status
    // Update goal amounts
    // Handle goal completion
    // Trigger notifications
  }

  // Handle payment failed
  async handlePaymentFailed(eventData) {
    // Update payment status
    // Trigger retry if applicable
    // Send notification
  }
}
```

---

## Benefits of Refactor

### 1. **Maintainability**
- Single source of truth for payment logic
- Easier to add new payment types
- Clearer code organization

### 2. **Testability**
- Services are easily testable
- Mock payment service in tests
- Test payment logic independently

### 3. **Scalability**
- Payment model allows better querying
- Can add payment analytics
- Easier to add retry logic

### 4. **Reliability**
- Idempotency checks prevent duplicates
- Retry logic handles failures
- Better error handling

### 5. **User Experience**
- Payment notifications
- Better error messages
- Payment history

---

## Next Steps

1. **Review this proposal** - Discuss and refine
2. **Create Payment model** - Design schema
3. **Create Payment service** - Implement core logic
4. **Migrate existing data** - Move transfers to Payment model
5. **Refactor cron jobs** - Use payment service
6. **Refactor routes** - Use payment service
7. **Refactor webhooks** - Use webhook service
8. **Add retry logic** - Implement retry mechanism
9. **Add notifications** - Implement notification system
10. **Update tests** - Ensure all tests pass

---

## Questions to Consider

1. **Should we keep `transfers` array in SavingsGoal?**
   - Option A: Keep for backward compatibility, sync with Payment model
   - Option B: Remove, query Payment model instead
   - **Recommendation**: Option A initially, migrate to Option B

2. **How to handle batch transfers?**
   - Option A: Single Payment record with multiple goal references
   - Option B: Multiple Payment records linked by batchId
   - **Recommendation**: Option B (current approach, easier to query)

3. **Payment retry strategy?**
   - How many retries?
   - Exponential backoff?
   - Manual retry option?
   - **Recommendation**: 3 retries, exponential backoff, manual retry API

4. **Notification system?**
   - Email only?
   - In-app notifications?
   - SMS?
   - **Recommendation**: Start with email, add in-app later

