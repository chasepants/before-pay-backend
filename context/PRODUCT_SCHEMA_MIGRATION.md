# Product Schema Migration - Impact Analysis

## ⚠️ ARCHITECTURAL DECISION

**Consider using Discriminated Goal Schema instead** - See `DISCRIMINATED_GOAL_SCHEMA.md`

Instead of discriminating the nested `product` field, we could discriminate the entire `SavingsGoal` model:
- `ManualSavingsGoal` - Has category, aiGeneratedImage, optional Google Shopping data
- `ShopifySavingsGoal` - Has checkoutCartId, shopDomain, no category

This is a cleaner architectural fit since Manual and Shopify goals are fundamentally different entities.

---

## Overview
Migrating `SavingsGoal.product` from `Schema.Types.Mixed` to discriminated schemas for type safety and validation.

**Note**: This document describes the nested product approach. Consider the discriminated goal approach first.

## Current State
- `product: { type: Schema.Types.Mixed }` - No validation, accepts any structure
- Two product types: `Shopify` (tied to checkout) and `Manual` (user-created, optionally with Google Shopping data)
- Data duplication: Shopify line items stored in both `CheckoutCart` and `SavingsGoal.product.lineItems`

## Target State
- Base product schema with common fields
- `ProductShopify` discriminated schema (reference `CheckoutCart` instead of duplicating)
- `ProductManual` discriminated schema:
  - **Category** (moved from root level - only relevant for manual goals)
  - **aiGeneratedImage** (moved from root level - only relevant for manual goals)
  - Optional Google Shopping enrichment data (SerpApi results)
  - Optional manual entry fields (productLink, title, price, etc.)
  - Can exist with minimal data (just goalName/targetAmount)

### Related Schema Changes (see SCHEMA_REORGANIZATION.md)
- `plaidToken` → Move to `bankSchema` (bank-related)
- `category` → Move to `ProductManual` (only for manual goals)
- `aiGeneratedImage` → Move to `ProductManual` (only for manual goals)
- `source` (root) → Investigate/remove (appears unused)

---

## Files Affected

### Backend Models (1 file)
- ✅ `models/SavingsGoal.js` - **CRITICAL** - Core schema change

### Backend Routes (2 files)
- ✅ `routes/savingsGoal.js` - **CRITICAL** - Multiple endpoints create/read/update product
  - `POST /shopify` - Creates Shopify goal
  - `POST /create-guest-goal` - Creates Shopify goal from checkout
  - `POST /` - Creates Google goal
  - `POST /:id/save-product` - Updates product data
  - `POST /:savingsGoalId/refund` - Reads `product.type` and `product.shopDomain`
  - `GET /:id` - Returns product data

### Backend Webhooks (1 file)
- ✅ `webhooks/index.js` - **CRITICAL** - Reads product for order creation
  - `createOrder()` - Accesses `goal.product.shopDomain` and `goal.product.lineItems`
  - `handleTransactionCreated()` - Checks `product.type === 'Shopify'`
  - `handlePaymentCreated()` - Checks `product.type === 'Shopify'`

### Backend Cron Jobs (2 files)
- ✅ `cron/process-installments.js` - **HIGH** - Queries by `product.type`
- ✅ `cron/process-payments.js` - **HIGH** - Checks `product.type === 'Shopify'`

### Backend Routes - Shopify (1 file)
- ✅ `routes/shopifyMerchant.js` - **MEDIUM** - Queries by `product.type`

### Backend Scripts (1 file)
- ✅ `scripts/dev-seed-merchant-and-goal.js` - **LOW** - Creates test data with product

### Backend Tests (2 files)
- ✅ `tests/routes/savingsGoal.test.js` - **CRITICAL** - Extensive product tests
- ✅ `tests/routes/shopifyMerchant.test.js` - **MEDIUM** - Tests product queries

### Frontend (Multiple files - estimated)
- ⚠️ `src/pages/ViewOrder.js` - Checks `product.type === 'Shopify'`
- ⚠️ `src/pages/ViewSavings.js` - Checks `product.type === 'Shopify'`
- ⚠️ `src/pages/StartSavingsPlan.js` - Creates product data
- Additional files may access product data

---

## Code Patterns to Update

### 1. Product Type Checks
```javascript
// Current (7 locations)
if (goal.product && goal.product.type === 'Shopify') { ... }
if (goal.product?.type === 'Shopify') { ... }
'product.type': 'Shopify'

// After migration - still valid but type-safe
if (goal.product && goal.product.type === 'Shopify') { ... }
```

### 2. Product Creation
```javascript
// Current (3 locations in routes/savingsGoal.js)

// Shopify product:
product: {
  type: 'Shopify',
  checkoutId: '...',
  shopDomain: '...',
  lineItems: [...]
}

// Manual product (with optional Google Shopping enrichment):
product: {
  // No type field currently - just Mixed data
  title: '...',  // From Google Shopping search
  price: '...',
  thumbnail: '...',
  // ... other optional Google Shopping fields from SerpApi
}

// Manual product (manual entry only, no Google data):
product: {
  productLink: '...',  // User-entered link
  // ... minimal fields
}

// Manual product (minimal - no product data at all):
product: {
  // May be empty or undefined
}

// After migration - use discriminated constructor
// SavingsGoal.create({ product: { type: 'Shopify', checkoutCartId: '...' } })
// SavingsGoal.create({ product: { type: 'Manual', title: '...', price: '...' } })
```

### 3. Product Access
```javascript
// Current (multiple locations)
goal.product.shopDomain
goal.product.lineItems
goal.product.checkoutId

// After migration - Shopify products reference CheckoutCart
goal.product.shopDomain  // Still works
goal.product.checkoutCart.lineItems  // New path
goal.product.checkoutCartId  // Reference instead of duplicating
```

### 4. Product Updates
```javascript
// Current (routes/savingsGoal.js:726)
goal.product = {
  ...goal.product,
  title: productData.title,
  // ...
}

// After migration - type-specific updates
// Need to handle based on product.type
```

---

## Test Coverage Assessment

### ✅ Good Coverage
- `tests/routes/savingsGoal.test.js` - 3413 lines
  - Tests product creation (Google)
  - Tests product updates
  - Tests product retrieval
  - Tests Shopify-specific operations

### ⚠️ Gaps to Address
1. **Discriminated schema creation** - No tests for creating Shopify vs Google products
2. **CheckoutCart reference** - No tests for Shopify products referencing CheckoutCart
3. **Type validation** - No tests that invalid product types are rejected
4. **Migration compatibility** - No tests for backward compatibility with existing Mixed data

---

## Migration Strategy

### Phase 1: Schema Design (No Breaking Changes)
1. Create base product schema with common fields
2. Create `ProductGoogle` and `ProductShopify` discriminated schemas
3. Keep `Mixed` type temporarily, add validation layer
4. Write migration tests

### Phase 2: Backward-Compatible Migration
1. Update creation code to use discriminated schemas
2. Update read code to handle both old (Mixed) and new (discriminated) data
3. Add data migration script to convert existing Mixed products
4. Run tests to ensure backward compatibility

### Phase 3: Remove Duplication (Shopify)
1. Update `ProductShopify` to reference `CheckoutCart` instead of duplicating lineItems
2. Update code that accesses `goal.product.lineItems` to use `goal.product.checkoutCart.lineItems`
3. Remove lineItems from ProductShopify schema
4. Update tests

### Phase 4: Remove Mixed Type
1. Remove `Schema.Types.Mixed` option
2. Enforce discriminated schemas only
3. Remove backward compatibility code
4. Final test suite run

---

## Risk Assessment

### High Risk Areas
1. **Order Creation** (`webhooks/index.js:createOrder`) - Accesses `goal.product.lineItems` directly
2. **Refund Endpoint** (`routes/savingsGoal.js:refund`) - Accesses `goal.product.shopDomain`
3. **Cron Jobs** - Query by `product.type`, may break if schema changes
4. **Frontend** - May have assumptions about product structure

### Mitigation
1. Comprehensive test coverage before migration
2. Feature flags for gradual rollout
3. Data migration script tested on staging
4. Monitor logs for errors post-deployment

---

## Testing Requirements

### Must Test
1. ✅ Creating Manual product goals (with Google Shopping data)
2. ✅ Creating Manual product goals (without Google Shopping data - manual entry only)
3. ✅ Creating Shopify product goals (with CheckoutCart reference)
3. ✅ Reading product data (both types)
4. ✅ Updating product data
5. ✅ Querying by product type
6. ✅ Order creation with Shopify products
7. ✅ Refund with Shopify products
8. ✅ Cron jobs processing Shopify goals
9. ✅ Backward compatibility with existing Mixed data
10. ✅ Migration script converting Mixed → Discriminated

### Test Data Needed
- Existing goals with Mixed product data (for migration testing)
- Manual product goals with Google Shopping enrichment data
- Manual product goals with manual entry only (no Google data)
- Manual product goals with minimal/no product data
- Shopify product goals (with and without CheckoutCart)
- Goals without product data (if allowed)

---

## Next Steps

1. **Review this document** - Confirm approach and priorities
2. **Create base schemas** - Design ProductGoogle and ProductShopify schemas
3. **Write schema tests** - Test discriminated schema creation and validation
4. **Update creation endpoints** - Migrate to discriminated schemas
5. **Add migration script** - Convert existing Mixed data
6. **Update read paths** - Handle CheckoutCart references
7. **Run full test suite** - Ensure no regressions
8. **Deploy incrementally** - Feature flag or staged rollout

