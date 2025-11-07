# Schema Reorganization - Field Placement Analysis

## Overview
Reorganizing fields in SavingsGoal schema to better reflect their purpose and usage patterns.

---

## Field Analysis

### 1. `aiGeneratedImage` → Move to `ProductManual`

**Current Location**: Root level of SavingsGoal  
**Usage**: 
- Set via `POST /:id/generate-image` endpoint (requires `requireSavingsAccountUser`)
- Only used for manual goals (Shopify goals don't have AI images)
- Frontend displays in ViewSavings for manual goals

**Rationale**: AI image generation is only relevant for manual/user-created goals, not Shopify checkout flows.

**Change**: Move to `ProductManual` discriminated schema

---

### 2. `source` (root level) → **Investigate/Remove**

**Current Location**: Root level of SavingsGoal  
**Values Set**:
- `'shopify'` - when created via Shopify route
- `'guest-checkout'` - when created via guest checkout flow
- `'web'` - default value

**Usage Analysis**:
- ✅ Set in creation flows (2 locations)
- ❌ Never queried/filtered
- ❌ Not used in frontend
- ❌ Not used in business logic

**Possible Purposes**:
- Analytics tracking?
- Debugging?
- Future feature?

**Recommendation**: 
- **Option A**: Remove if not needed for analytics
- **Option B**: Keep if needed for analytics, but document purpose
- **Option C**: Move to appropriate product schema if it's product-specific

**Action Required**: Verify with team if this field is used for analytics or can be removed

---

### 3. `plaidToken` → Move to `bankSchema`

**Current Location**: Root level of SavingsGoal  
**Usage**:
- Set during goal creation (links bank account)
- Used for refunds (`goal.plaidToken`)
- Used for payment processing
- Directly tied to bank account information

**Rationale**: `plaidToken` is the processor token for the bank account, logically belongs with other bank fields.

**Change**: Move to `bankSchema` as `plaidToken`

---

### 4. `category` → Move to `ProductManual`

**Current Location**: Root level of SavingsGoal  
**Usage**:
- Only set for manual goals (CreateSavingsGoal.js requires it)
- Used in web search (`goal.category` for product search)
- Frontend shows category selector only for manual creation
- Values: `['product', 'trip', 'donation', 'education', 'home', 'other']`

**Rationale**: Categories are only relevant for manual/user-created goals. Shopify goals don't have categories.

**Change**: Move to `ProductManual` discriminated schema

---

## Proposed Schema Structure

### Root Level (SavingsGoal)
```javascript
{
  userId: ObjectId,
  goalName: String,
  description: String,
  targetAmount: Number,
  currentAmount: Number,
  savingsAmount: Number,
  product: ProductDiscriminated,  // ProductShopify | ProductManual
  schedule: ScheduleSchema,
  bank: {
    bankName: String,
    bankAccountName: String,
    bankLastFour: String,
    bankAccountType: String,
    plaidToken: String  // ← MOVED HERE
  },
  transfers: [TransferSchema],
  isPaused: Boolean,
  guestEmail: String,
  // source: String  // ← REMOVE or document purpose
  timestamps: true
}
```

### ProductManual Schema
```javascript
{
  type: 'Manual',
  category: String,  // ← MOVED HERE (enum: ['product', 'trip', 'donation', 'education', 'home', 'other'])
  aiGeneratedImage: String,  // ← MOVED HERE
  // Optional Google Shopping enrichment
  productLink: String,
  title: String,
  price: String,
  old_price: String,
  extracted_price: Number,
  extracted_old_price: Number,
  product_id: String,
  serpapi_product_api: String,
  thumbnail: String,
  source: String,  // Google Shopping source (different from root 'source')
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
}
```

### ProductShopify Schema
```javascript
{
  type: 'Shopify',
  checkoutCartId: ObjectId,  // Reference to CheckoutCart (removes duplication)
  shopDomain: String,  // For quick access without lookup
  // Removed: lineItems, checkoutId, customerId, totalPrice (use CheckoutCart reference)
}
```

---

## Migration Impact

### Files to Update

1. **Models**:
   - `models/SavingsGoal.js` - Schema reorganization

2. **Routes**:
   - `routes/savingsGoal.js` - Update all field accesses
     - `goal.plaidToken` → `goal.bank.plaidToken`
     - `goal.category` → `goal.product.category`
     - `goal.aiGeneratedImage` → `goal.product.aiGeneratedImage`

3. **Webhooks**:
   - No changes (Shopify products don't use these fields)

4. **Frontend**:
   - `src/pages/ViewSavings.js` - Update field paths
   - `src/pages/CreateSavingsGoal.js` - Already uses category correctly

5. **Tests**:
   - `tests/routes/savingsGoal.test.js` - Update all field assertions

---

## Migration Steps

### Phase 1: Add new fields (backward compatible)
1. Add `plaidToken` to `bankSchema`
2. Add `category` and `aiGeneratedImage` to `ProductManual` schema
3. Keep old fields at root level temporarily

### Phase 2: Update code to use new locations
1. Update all code to read from new locations
2. Update all code to write to new locations
3. Run tests to ensure compatibility

### Phase 3: Data migration
1. Write migration script to move existing data
2. Copy `plaidToken` → `bank.plaidToken`
3. Copy `category` → `product.category` (for manual goals)
4. Copy `aiGeneratedImage` → `product.aiGeneratedImage` (for manual goals)

### Phase 4: Remove old fields
1. Remove `plaidToken` from root
2. Remove `category` from root
3. Remove `aiGeneratedImage` from root
4. Remove or document `source` field

---

## Backward Compatibility

During migration, we'll need to support both old and new locations:

```javascript
// Helper function for reading plaidToken
function getPlaidToken(goal) {
  return goal.bank?.plaidToken || goal.plaidToken;
}

// Helper function for reading category
function getCategory(goal) {
  return goal.product?.category || goal.category;
}

// Helper function for reading aiGeneratedImage
function getAiGeneratedImage(goal) {
  return goal.product?.aiGeneratedImage || goal.aiGeneratedImage;
}
```

---

## Questions to Resolve

1. **`source` field**: 
   - Is it used for analytics?
   - Can it be removed?
   - Should it be product-specific?

2. **Migration timing**: 
   - Should this be done before or after product schema migration?
   - Recommendation: After product schema migration (cleaner)

3. **Default values**:
   - What should `bank.plaidToken` default be?
   - What should `product.category` default be for Shopify goals? (null/undefined)

