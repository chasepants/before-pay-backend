# Payment State Machine Architecture Proposal

## Current Problem

We have a complex state machine:
- **Payment States**: `pending` → `processing` → `completed` | `failed` | `rejected` | `canceled`
- **Payment Types**: `debit` (installments), `credit` (refunds, transfer_back)
- **Payment Categories**: `manual_installment`, `shopify_installment`, `refund`, `transfer_back`, `transfer_back_batch`

Each payment state change needs to:
1. Update the Payment record
2. Update the SavingsGoal state (currentAmount, isPaused, etc.)
3. Handle special cases (refunds, goal completion, etc.)

**Current Issue**: This logic is scattered across PaymentService and WebhookService, with no clear "conductor" orchestrating the state transitions.

## Proposed Architecture

### Service Responsibilities

#### **PaymentService** (Pure Payment Operations)
- Creates payments via Unit API
- Updates payment status in Payment model
- Queries payments
- **NO knowledge of savings goals**

#### **SavingsGoalService** (Business Logic Conductor)
- Uses PaymentService to create payments
- Links payments to savings goals
- **Knows how payment state changes affect goal state**
- Handles all business rules:
  - Debit completed → increase currentAmount
  - Credit completed → decrease currentAmount
  - Refund completed → set currentAmount to 0, pause goal
  - Goal reaches target → pause, create order
- Updates goal state (currentAmount, isPaused, savingsAmount, transfers array)

#### **WebhookService** (Event Handler)
- Receives webhook events from Unit
- Updates payment status via PaymentService
- **Notifies SavingsGoalService** about payment state changes
- SavingsGoalService handles all goal state updates

## Payment State Machine

```
Payment States:
  pending → processing → completed
  pending → processing → failed
  pending → rejected
  pending → canceled

Payment Effects on Goals:
  debit + completed → currentAmount += amount
  credit + completed → currentAmount -= amount
  credit + completed (refund) → currentAmount = 0, isPaused = true
  any + failed → no change to currentAmount
  any + rejected → no change to currentAmount
```

## Implementation

### SavingsGoalService Methods

```javascript
class SavingsGoalService {
  // Create payment for a goal
  async createPaymentForGoal(goal, paymentData) {
    // Use PaymentService to create payment
    // Link payment to goal
    // Update goal.transfers array
  }

  // Handle payment state change
  async handlePaymentStateChange(paymentId, newStatus, transactionId) {
    // Get payment
    // Get goal
    // Apply business rules based on payment type and status
    // Update goal state
  }

  // Handle payment completed
  async handlePaymentCompleted(payment, tags) {
    // Update currentAmount based on payment type
    // Handle special cases (refunds, goal completion)
    // Update goal state
  }

  // Handle payment failed
  async handlePaymentFailed(payment) {
    // No change to currentAmount
    // Maybe log or notify
  }
}
```

## Benefits

1. **Single Source of Truth**: SavingsGoalService knows all the rules
2. **Testable**: Business logic is isolated and testable
3. **Maintainable**: Changes to business rules happen in one place
4. **Clear Separation**: PaymentService = payments, SavingsGoalService = goals, WebhookService = events

## Migration Path

1. Create SavingsGoalService
2. Move payment creation logic from routes/cron to SavingsGoalService
3. Move goal state update logic from WebhookService to SavingsGoalService
4. WebhookService becomes a thin event router
5. PaymentService becomes pure payment operations

