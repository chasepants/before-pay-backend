# Discriminated SavingsGoal Schema - Architectural Redesign

## Overview
Instead of having a nested `product` field with discriminated schemas, discriminate the entire `SavingsGoal` model at the document level. This reflects that Manual and Shopify goals are fundamentally different entities with different fields and behaviors.

---

## Current Problems

### Nested Product Field Issues
- `product` field feels like an awkward separation
- Type checking happens at nested level (`goal.product.type === 'Shopify'`)
- Fields like `category` and `aiGeneratedImage` belong to the goal, not a nested product
- Shopify goals need `checkoutCartId` at the goal level, not nested

### Current Structure
```javascript
SavingsGoal {
  // Common fields
  goalName, description, targetAmount, currentAmount, etc.
  
  // Awkward nested product
  product: { type: Mixed }  // Can be Shopify or Manual/Google
  
  // Manual-only fields at root level (wrong place)
  category,  // Only for manual goals
  aiGeneratedImage,  // Only for manual goals
  
  // Shopify needs checkoutCartId (not nested)
  // Currently: product.checkoutId, product.shopDomain
}
```

---

## Proposed Structure

### Base Schema (Common Fields)
```javascript
SavingsGoalBase {
  // Identity
  userId: ObjectId,
  goalName: String,
  description: String,
  
  // Financial
  targetAmount: Number,
  currentAmount: Number,
  savingsAmount: Number,
  
  // Payment & Schedule
  schedule: ScheduleSchema,
  bank: {
    bankName: String,
    bankAccountName: String,
    bankLastFour: String,
    bankAccountType: String,
    plaidToken: String  // Moved here
  },
  transfers: [TransferSchema],
  isPaused: Boolean,
  
  // Guest support
  guestEmail: String,
  
  // Metadata
  timestamps: true
}
```

### ManualSavingsGoal (Discriminated)
```javascript
ManualSavingsGoal extends SavingsGoalBase {
  // Discriminator key
  __t: 'ManualSavingsGoal',  // Mongoose discriminator
  
  // Manual-specific fields
  category: String,  // enum: ['product', 'trip', 'donation', 'education', 'home', 'other']
  aiGeneratedImage: String,
  
  // Optional Google Shopping enrichment (array of search results)
  googleShoppingData: [{
    productLink: String,
    title: String,
    price: String,
    old_price: String,
    extracted_price: Number,
    extracted_old_price: Number,
    product_id: String,
    serpapi_product_api: String,
    thumbnail: String,
    source: String,
    source_icon: String,
    rating: Number,
    reviews: Number,
    badge: String,
    tag: String,
    delivery: String,
    description: String,
    shopifyProductId: String,
    shopifyVariantId: String,
    handle: String,
    image: String
  }],
  
  // Optional manual entry fields
  manualProductLink: String,
  manualTitle: String,
  manualPrice: String
}
```

### ShopifySavingsGoal (Discriminated)
```javascript
ShopifySavingsGoal extends SavingsGoalBase {
  // Discriminator key
  __t: 'ShopifySavingsGoal',  // Mongoose discriminator
  
  // Shopify-specific fields (required)
  checkoutCartId: ObjectId,  // Reference to CheckoutCart
  shopDomain: String,  // For quick access without lookup
  
  // NO category
  // NO aiGeneratedImage
  // NO googleShoppingData
}
```

---

## Benefits

### 1. Type Safety at Document Level
```javascript
// Before: Type checking at nested level
if (goal.product && goal.product.type === 'Shopify') { ... }

// After: Type checking at document level
if (goal instanceof ShopifySavingsGoal) { ... }
// Or with discriminator
if (goal.__t === 'ShopifySavingsGoal') { ... }
```

### 2. Natural Field Placement
- `category` belongs to ManualSavingsGoal ✅
- `aiGeneratedImage` belongs to ManualSavingsGoal ✅
- `checkoutCartId` belongs to ShopifySavingsGoal ✅
- No awkward nested structure ✅

### 3. Clearer Intent
- Manual goals: User-created, can have Google Shopping data, can have categories
- Shopify goals: Tied to checkout, always have checkoutCartId, no categories

### 4. Better Queries
```javascript
// Find all Shopify goals
SavingsGoal.find({ __t: 'ShopifySavingsGoal' })

// Find all manual goals with categories
SavingsGoal.find({ __t: 'ManualSavingsGoal', category: 'product' })

// No need for nested product.type queries
```

### 5. Validation at Document Level
- ShopifySavingsGoal: `checkoutCartId` is required
- ManualSavingsGoal: `category` can be required
- Type-specific validation without nested checks

---

## Migration Impact

### Code Changes

#### Before
```javascript
// Create manual goal
const goal = new SavingsGoal({
  goalName: 'My Goal',
  category: 'product',
  product: {
    title: 'Product',
    price: '100'
  }
});

// Check type
if (goal.product?.type === 'Shopify') { ... }

// Access Shopify data
const shopDomain = goal.product.shopDomain;
```

#### After
```javascript
// Create manual goal
const goal = new ManualSavingsGoal({
  goalName: 'My Goal',
  category: 'product',
  googleShoppingData: [{
    title: 'Product',
    price: '100'
  }]
});

// Check type
if (goal instanceof ShopifySavingsGoal) { ... }
// Or
if (goal.__t === 'ShopifySavingsGoal') { ... }

// Access Shopify data
const shopDomain = goal.shopDomain;
const checkoutCart = await CheckoutCart.findById(goal.checkoutCartId);
```

### Files Affected

#### Creation Points (Update to use correct discriminator)
1. `routes/savingsGoal.js` - `POST /` → `new ManualSavingsGoal(...)`
2. `routes/savingsGoal.js` - `POST /shopify` → `new ShopifySavingsGoal(...)`
3. `routes/savingsGoal.js` - `POST /create-guest-goal` → `new ShopifySavingsGoal(...)`
4. `scripts/dev-seed-merchant-and-goal.js` → `new ShopifySavingsGoal(...)`

#### Read Points (Update type checks)
1. `routes/savingsGoal.js` - `POST /:savingsGoalId/refund` - Check `instanceof ShopifySavingsGoal`
2. `webhooks/index.js` - `createOrder()` - Check `instanceof ShopifySavingsGoal`
3. `webhooks/index.js` - `handleTransactionCreated()` - Check `instanceof ShopifySavingsGoal`
4. `cron/process-installments.js` - Query by discriminator
5. `cron/process-payments.js` - Check `instanceof ShopifySavingsGoal`

#### Field Access Updates
1. `goal.product.shopDomain` → `goal.shopDomain`
2. `goal.product.lineItems` → `goal.checkoutCart.lineItems` (via reference)
3. `goal.category` → `goal.category` (already at root, but now type-safe)
4. `goal.aiGeneratedImage` → `goal.aiGeneratedImage` (already at root, but now type-safe)

---

## Implementation Strategy

### Phase 1: Create Discriminated Schemas (Backward Compatible)
1. Create base schema with common fields
2. Create `ManualSavingsGoal` discriminator
3. Create `ShopifySavingsGoal` discriminator
4. Keep old `SavingsGoal` model temporarily for compatibility

### Phase 2: Update Creation Code
1. Update all creation points to use correct discriminator
2. Update field paths (remove `product.` nesting for Shopify)
3. Update field paths (move Google Shopping data to array)

### Phase 3: Update Read/Query Code
1. Replace `product.type` checks with `instanceof` or `__t` checks
2. Update queries to use discriminator field
3. Update field access paths

### Phase 4: Data Migration
1. Migrate existing goals:
   - If `product.type === 'Shopify'` → Convert to `ShopifySavingsGoal`
   - Otherwise → Convert to `ManualSavingsGoal`
2. Move `product` data to appropriate location
3. Set `checkoutCartId` for Shopify goals

### Phase 5: Cleanup
1. Remove old `product` field
2. Remove old `SavingsGoal` model
3. Remove compatibility code

---

## Comparison: Nested Product vs Discriminated Goal

### Nested Product Approach
```javascript
SavingsGoal {
  product: {
    type: 'Shopify' | 'Manual',
    // Shopify fields
    // Manual fields
  }
}
```
**Pros**: Smaller change, less code affected  
**Cons**: Awkward nesting, type checking at nested level, fields don't naturally belong

### Discriminated Goal Approach (RECOMMENDED)
```javascript
ManualSavingsGoal extends SavingsGoalBase { ... }
ShopifySavingsGoal extends SavingsGoalBase { ... }
```
**Pros**: Cleaner architecture, type safety at document level, natural field placement  
**Cons**: More files affected, larger migration

---

## Recommendation

**Use Discriminated Goal Approach** - It's a better architectural fit:
- Manual and Shopify goals are fundamentally different
- Fields naturally belong at the goal level, not nested
- Type safety and validation are clearer
- Queries are simpler
- Future extensibility (could add more goal types)

The migration is larger but results in cleaner, more maintainable code.

