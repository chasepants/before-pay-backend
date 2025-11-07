# Savings Goal Routes Refactoring Summary

## Changes Made

### 1. Base Path (Kept Singular)
- **Path:** `/api/savings-goal` (kept as singular for consistency)
- **Note:** While REST convention typically uses plural, singular was maintained for consistency with existing API patterns

### 2. Routes Removed (Moved to Other Resources)
These routes were removed from savings-goal routes and should be moved to their appropriate resource files:

- **`GET /search`** → Should move to `/api/products/search`
- **`POST /send-verification`** → Should move to `/api/auth/verification/send`
- **`POST /verify-code`** → Should move to `/api/auth/verification/verify`
- **`POST /connect-plaid`** → Should move to `/api/bank/plaid/connect`
- **`POST /plaid/create-link-token`** → Should move to `/api/bank/plaid/link-token`

### 3. Routes Renamed

| Old Route | New Route | Notes |
|----------|-----------|-------|
| `POST /create-guest-goal` | `POST /guest` | Simplified naming |
| `POST /:savingsGoalId/refund` | `POST /:id/refund` | Standardized param name from `savingsGoalId` to `id` |
| `POST /:id/ai-insights` | *(removed)* | Route removed (not currently used) |

### 4. Action Routes Standardized

Action endpoints use direct sub-resource pattern (no `/actions/` prefix):

| Old Route | New Route |
|-----------|-----------|
| `POST /:id/generate-image` | `POST /:id/generate-image` (kept) |
| `POST /:id/web-search` | `POST /:id/web-search` (kept) |
| `POST /:id/save-product` | `POST /:id/save-product` (kept) |
| `POST /:savingsGoalId/refund` | `POST /:id/refund` (standardized param name) |

### 5. New Route Added

- **`GET /:id/transactions`** - Moved from `/api/bank/transaction-history/:savingsGoalId`
  - Now properly nested under the savings goal resource
  - Returns transaction history for a specific savings goal

### 6. Routes Kept (No Changes)

These routes remain unchanged in structure:

- `GET /` - List all savings goals for user
- `GET /merchant/:shopDomain` - List merchant's savings goals (NOTE: Should eventually move to `/api/merchants/:shopDomain/savings-goals`)
- `GET /:id` - Get single savings goal
- `POST /shopify` - Create Shopify savings goal
- `POST /` - Create manual savings goal
- `PUT /:id` - Update savings goal
- `DELETE /:id` - Delete savings goal
- `PATCH /:id/pause` - Pause/unpause savings goal

## Updated Route Structure

```
GET    /api/savings-goal                    # List user's goals
GET    /api/savings-goal/merchant/:shopDomain  # List merchant's goals
GET    /api/savings-goal/:id                # Get single goal
GET    /api/savings-goal/:id/transactions   # Get transaction history
POST   /api/savings-goal/shopify            # Create Shopify goal
POST   /api/savings-goal/guest              # Create guest goal
POST   /api/savings-goal                    # Create manual goal
PUT    /api/savings-goal/:id                # Update goal
DELETE /api/savings-goal/:id                # Delete goal
PATCH  /api/savings-goal/:id/pause          # Pause/unpause goal

# Action endpoints (direct sub-resource pattern)
POST   /api/savings-goal/:id/generate-image
POST   /api/savings-goal/:id/web-search
POST   /api/savings-goal/:id/save-product
POST   /api/savings-goal/:id/refund
```

## Breaking Changes

### Frontend Updates Required

1. **Action routes:** Standardized parameter names:
   - `/api/savings-goal/:savingsGoalId/refund` → `/api/savings-goal/:id/refund` (param name changed)
2. **Guest goal creation:** `/api/savings-goal/create-guest-goal` → `/api/savings-goal/guest`
3. **Transaction history:** `/api/bank/transaction-history/:savingsGoalId` → `/api/savings-goal/:id/transactions`

### Routes That Need to Be Created Elsewhere

The following routes were removed and need to be implemented in their proper resource files:

1. **Products/Search Routes** (`/api/products` or `/api/search`)
   - `GET /api/products/search?q=...` (moved from `/api/savings-goal/search`)

2. **Auth Routes** (`/api/auth`)
   - `POST /api/auth/verification/send` (moved from `/api/savings-goal/send-verification`)
   - `POST /api/auth/verification/verify` (moved from `/api/savings-goal/verify-code`)

3. **Bank Routes** (`/api/bank`)
   - `POST /api/bank/plaid/connect` (moved from `/api/savings-goal/connect-plaid`)
   - `POST /api/bank/plaid/link-token` (moved from `/api/savings-goal/plaid/create-link-token`)

## Next Steps

1. ✅ Backend routes refactored
2. ⏳ Create new route files for moved routes (products, auth verification, bank plaid)
3. ⏳ Update frontend to use new route paths
4. ⏳ Update tests to use new route paths
5. ⏳ Consider moving `/merchant/:shopDomain` to `/api/merchants/:shopDomain/savings-goals`

## Notes

- The `/merchant/:shopDomain` route is still in savings-goal routes but should eventually be moved to merchant routes for better REST compliance
- The insights route was changed from POST to GET, but it still modifies the goal (enhances description). Consider if this should remain a GET or be changed to POST with a different pattern
- All removed routes have been replaced with comments indicating where they should be moved

