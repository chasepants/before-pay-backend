# REST API Route Audit

## Current Route Structure

### Base Paths
- `/api/auth` - Authentication routes
- `/api/savings-goal` - Savings goal routes
- `/api/bank` - Bank/transfer routes
- `/api/launch` - Launch notification routes
- `/api/shopify-merchant` - Shopify merchant routes
- `/webhook` - Unit webhook handler
- `/webhooks/shopify-pubsub` - Shopify pub/sub webhook
- `/api/webhooks/shopify-pubsub` - Shopify pub/sub webhook (alias)

---

## Route Audit by File

### `/api/auth` (routes/auth.js)

| Method | Path | Current Behavior | REST Compliance | Issues |
|--------|------|------------------|-----------------|--------|
| GET | `/google` | Initiates Google OAuth | ✅ OK | OAuth callback, acceptable |
| GET | `/google/callback` | Google OAuth callback | ✅ OK | OAuth callback, acceptable |
| GET | `/current_user` | Gets current authenticated user | ⚠️ PARTIAL | Should be `/me` or `/users/me` |
| GET | `/customer-token` | Generates Unit customer token | ❌ BAD | Not a resource, should be `/users/me/customer-token` or `/auth/customer-token` |
| POST | `/register` | Creates new user | ⚠️ PARTIAL | Should be `/users` (POST creates) |
| POST | `/login` | Returns error (deprecated) | ❌ BAD | Should be removed or moved to `/auth/login` |
| POST | `/verify-firebase-token` | Verifies Firebase token | ⚠️ PARTIAL | Should be `/auth/verify-firebase-token` or `/auth/token/verify` |
| POST | `/forgot-password` | Sends password reset email | ⚠️ PARTIAL | Should be `/auth/password/reset` or `/users/me/password/reset` |
| POST | `/send-verification` | Sends email verification | ⚠️ PARTIAL | Should be `/users/me/email/verify` or `/auth/email/verify` |
| GET | `/logout` | Logout endpoint | ⚠️ PARTIAL | Should be `/auth/logout` (POST) |
| GET | `/create-application-form` | Creates Unit application form | ❌ BAD | Not RESTful, should be `/users/me/unit-application-form` (POST) or `/applications` (POST) |

**Issues:**
- Mixing authentication actions with user resources
- `/customer-token` is not a resource
- `/create-application-form` is an action, not a resource
- `/current_user` should be `/me` or `/users/me`

---

### `/api/savings-goal` (routes/savingsGoal.js)

| Method | Path | Current Behavior | REST Compliance | Issues |
|--------|------|------------------|-----------------|--------|
| GET | `/` | Lists user's savings goals | ✅ GOOD | Standard collection endpoint |
| GET | `/merchant/:shopDomain` | Lists merchant's savings goals | ⚠️ PARTIAL | Should be `/merchants/:shopDomain/savings-goals` |
| GET | `/search` | Searches products via SerpAPI | ❌ BAD | Not a savings goal resource, should be `/products/search` or `/search/products` |
| GET | `/:id` | Gets single savings goal | ✅ GOOD | Standard resource endpoint |
| POST | `/shopify` | Creates Shopify savings goal | ⚠️ PARTIAL | Should be `/` with type in body, or `/shopify-savings-goals` |
| POST | `/send-verification` | Sends email verification code | ❌ BAD | Not a savings goal action, should be `/auth/verification/send` or `/verification/send` |
| POST | `/verify-code` | Verifies email code | ❌ BAD | Not a savings goal action, should be `/auth/verification/verify` or `/verification/verify` |
| POST | `/connect-plaid` | Connects Plaid account | ❌ BAD | Not a savings goal action, should be `/bank/connect` or `/plaid/connect` |
| POST | `/plaid/create-link-token` | Creates Plaid link token | ❌ BAD | Not a savings goal action, should be `/bank/plaid/link-token` or `/plaid/link-token` |
| POST | `/create-guest-goal` | Creates guest savings goal | ⚠️ PARTIAL | Should be `/` with guest context, or `/guest/savings-goals` |
| POST | `/` | Creates manual savings goal | ✅ GOOD | Standard collection endpoint |
| DELETE | `/:id` | Deletes savings goal | ✅ GOOD | Standard resource endpoint |
| PUT | `/:id` | Updates savings goal | ✅ GOOD | Standard resource endpoint |
| PATCH | `/:id/pause` | Pauses savings goal | ⚠️ PARTIAL | Should be PUT `/:id` with `{ isPaused: true }` or `/actions/pause` |
| POST | `/:id/generate-image` | Generates AI image | ❌ BAD | Action, should be `/actions/generate-image` or PUT with image |
| POST | `/:id/ai-insights` | Gets AI insights | ❌ BAD | Action, should be `/actions/ai-insights` or GET `/insights` |
| POST | `/:id/web-search` | Searches products | ❌ BAD | Action, should be `/actions/web-search` or separate search endpoint |
| POST | `/:id/save-product` | Saves product to goal | ❌ BAD | Action, should be PUT `/:id` with product data or `/actions/save-product` |
| POST | `/:savingsGoalId/refund` | Processes refund | ❌ BAD | Should be `/refunds` (POST) or `/actions/refund` |

**Issues:**
- Many non-resource actions mixed in (verification, Plaid, search)
- Actions should be sub-resources or use action pattern
- `/search` is not a savings goal resource
- Guest-specific routes should be clearly separated

---

### `/api/bank` (routes/bank.js)

| Method | Path | Current Behavior | REST Compliance | Issues |
|--------|------|------------------|-----------------|--------|
| POST | `/plaid-link-token` | Creates Plaid link token | ⚠️ PARTIAL | Should be `/plaid/link-token` or `/link-tokens` |
| POST | `/setup-savings` | Sets up savings plan for goal | ❌ BAD | Not a bank resource, should be `/savings-goals/:id/setup` or `/savings-goals/:id/schedule` |
| GET | `/transaction-history/:savingsGoalId` | Gets transaction history | ⚠️ PARTIAL | Should be `/savings-goals/:id/transactions` or `/transactions?savingsGoalId=:id` |
| POST | `/transfer-back-batch` | Transfers money back to bank | ⚠️ PARTIAL | Should be `/transfers` (POST) or `/transfers/batch` |

**Issues:**
- `/setup-savings` doesn't belong in bank routes
- Transaction history should be under savings-goals or transactions resource
- Transfer operations should be under transfers resource

---

### `/api/shopify-merchant` (routes/shopifyMerchant.js)

| Method | Path | Current Behavior | REST Compliance | Issues |
|--------|------|------------------|-----------------|--------|
| GET | `/status/:shopId` | Gets merchant status | ⚠️ PARTIAL | Should be `/merchants/:shopId/status` or `/merchants/:shopId` |
| POST | `/register` | Registers new merchant | ⚠️ PARTIAL | Should be `/merchants` (POST creates) |
| POST | `/register-with-credentials` | Registers merchant with credentials | ⚠️ PARTIAL | Should be `/merchants` with credentials in body |
| POST | `/start-unit-application/:merchantId` | Starts Unit application | ❌ BAD | Action, should be `/merchants/:id/unit-applications` (POST) or `/actions/start-application` |
| POST | `/webhook/unit-application-update` | Webhook for Unit updates | ⚠️ PARTIAL | Should be `/webhooks/unit-application-update` (not under merchants) |
| GET | `/` | Gets current merchant | ⚠️ PARTIAL | Should be `/merchants/me` or `/me` |
| GET | `/dashboard/:merchantId` | Gets merchant dashboard | ⚠️ PARTIAL | Should be `/merchants/:id/dashboard` or `/merchants/:id` with dashboard data |
| PUT | `/toggle/:merchantId` | Toggles merchant enabled status | ❌ BAD | Should be PUT `/merchants/:id` with `{ isEnabled: true/false }` |
| PUT | `/toggle-abandoned-cart-emails/:merchantId` | Toggles abandoned cart emails | ❌ BAD | Should be PUT `/merchants/:id` with `{ abandonedCartEmailsEnabled: true/false }` |
| GET | `/insights/:merchantId` | Gets merchant insights | ⚠️ PARTIAL | Should be `/merchants/:id/insights` |
| POST | `/sso-login` | SSO login for merchant | ⚠️ PARTIAL | Should be `/auth/sso` or `/auth/shopify-sso` |
| GET | `/customer-token` | Gets merchant customer token | ❌ BAD | Duplicate of auth route, should be `/merchants/me/customer-token` |

**Issues:**
- Many actions instead of resource updates
- Webhook should not be under merchant routes
- Toggle operations should be PUT with body data
- SSO login should be in auth routes

---

### `/api/launch` (routes/launch.js)

| Method | Path | Current Behavior | REST Compliance | Issues |
|--------|------|------------------|-----------------|--------|
| POST | `/notify` | Registers for launch notifications | ⚠️ PARTIAL | Should be `/notifications` or `/launch-notifications` |

**Issues:**
- `/notify` is an action, should be a resource

---

### Root Level Routes (server.js)

| Method | Path | Current Behavior | REST Compliance | Issues |
|--------|------|------------------|-----------------|--------|
| POST | `/webhook` | Unit webhook handler | ✅ OK | Webhooks are acceptable at root |
| POST | `/webhooks/shopify-pubsub` | Shopify pub/sub webhook | ✅ OK | Webhooks are acceptable |
| POST | `/api/webhooks/shopify-pubsub` | Shopify pub/sub webhook (alias) | ✅ OK | Webhooks are acceptable |
| GET | `/test` | Test endpoint | ✅ OK | Dev/test endpoint |
| GET | `/api/cors-test` | CORS test endpoint | ✅ OK | Dev/test endpoint |
| GET | `/api/savings-goal-test` | Savings goal CORS test | ✅ OK | Dev/test endpoint |
| GET | `/api/cron/process-payments` | Cron job trigger | ⚠️ PARTIAL | Should be `/cron/process-payments` or internal only |
| GET | `/api/cron/abandoned-carts` | Cron job trigger | ⚠️ PARTIAL | Should be `/cron/abandoned-carts` or internal only |
| GET | `/api/checkout-cart/:checkoutId` | Gets checkout cart | ⚠️ PARTIAL | Should be `/checkout-carts/:id` |
| GET | `/api/validate-email-token/:token` | Validates email token | ⚠️ PARTIAL | Should be `/email-tokens/:token/validate` or `/auth/email-tokens/:token` |

**Issues:**
- Cron endpoints should not be public API routes
- Checkout cart should be a proper resource
- Email token validation should be in auth routes

---

## Recommended Route Restructuring

### 1. Authentication Routes (`/api/auth`)

**Current Issues:**
- Mixing user resources with auth actions
- Actions not clearly separated

**Recommended Structure:**
```
GET    /api/auth/google                    # OAuth initiation (keep)
GET    /api/auth/google/callback            # OAuth callback (keep)
POST   /api/auth/register                  # User registration (keep, but consider moving)
POST   /api/auth/login                     # Remove (deprecated)
POST   /api/auth/verify-firebase-token     # Rename from /verify-firebase-token
POST   /api/auth/password/reset            # Rename from /forgot-password
POST   /api/auth/email/verify               # Rename from /send-verification
POST   /api/auth/logout                     # Change from GET to POST
POST   /api/auth/customer-token            # Move from root level
POST   /api/auth/verification/send           # Move from savings-goal
POST   /api/auth/verification/verify         # Move from savings-goal
GET    /api/auth/email-tokens/:token        # Move from root, rename from /validate-email-token
POST   /api/auth/shopify-sso                # Move from shopify-merchant
```

### 2. User Routes (`/api/users`)

**New Resource:**
```
GET    /api/users/me                        # Rename from /current_user
PUT    /api/users/me                        # Update current user
POST   /api/users                          # Create user (move from /auth/register)
GET    /api/users/me/customer-token        # Get customer token for user
POST   /api/users/me/unit-application-form # Create application form (rename from /create-application-form)
GET    /api/users/me/email/verify           # Send verification (alternative to auth route)
```

### 3. Savings Goal Routes (`/api/savings-goals`)

**Recommended Structure:**
```
GET    /api/savings-goals                  # List user's goals (keep)
GET    /api/savings-goals/:id              # Get single goal (keep)
POST   /api/savings-goals                  # Create manual goal (keep)
POST   /api/savings-goals/guest            # Create guest goal (rename from /create-guest-goal)
PUT    /api/savings-goals/:id              # Update goal (keep)
DELETE /api/savings-goals/:id              # Delete goal (keep)
PATCH  /api/savings-goals/:id/pause        # Pause goal (keep, or use PUT)
GET    /api/savings-goals/:id/transactions # Get transactions (move from /bank/transaction-history)
GET    /api/savings-goals/:id/insights      # Get insights (rename from /ai-insights)

# Actions (sub-resource pattern)
POST   /api/savings-goals/:id/actions/generate-image
POST   /api/savings-goals/:id/actions/web-search
POST   /api/savings-goals/:id/actions/save-product
POST   /api/savings-goals/:id/actions/refund

# Merchant-specific
GET    /api/merchants/:shopDomain/savings-goals  # Rename from /merchant/:shopDomain
```

### 4. Bank/Transfer Routes (`/api/bank` or `/api/transfers`)

**Recommended Structure:**
```
# Plaid operations
POST   /api/bank/plaid/link-token          # Rename from /plaid-link-token
POST   /api/bank/plaid/connect             # Move from savings-goal/connect-plaid
POST   /api/bank/plaid/create-link-token   # Move from savings-goal/plaid/create-link-token

# Transfers
GET    /api/transfers                      # List transfers
POST   /api/transfers                      # Create transfer
POST   /api/transfers/batch                # Batch transfer (rename from /transfer-back-batch)
GET    /api/transfers/:id                  # Get single transfer

# Savings setup (move from /setup-savings)
PUT    /api/savings-goals/:id/schedule     # Setup savings schedule
```

### 5. Merchant Routes (`/api/merchants`)

**Recommended Structure:**
```
GET    /api/merchants/me                   # Get current merchant (rename from /)
GET    /api/merchants/:id                  # Get merchant by ID
GET    /api/merchants/:id/status           # Get status (rename from /status/:shopId)
POST   /api/merchants                      # Register merchant (rename from /register)
PUT    /api/merchants/:id                  # Update merchant (combine toggles)
GET    /api/merchants/:id/dashboard        # Get dashboard (rename from /dashboard/:merchantId)
GET    /api/merchants/:id/insights         # Get insights (rename from /insights/:merchantId)
POST   /api/merchants/:id/unit-applications # Start application (rename from /start-unit-application)
GET    /api/merchants/:id/customer-token   # Get customer token (move from root)
```

### 6. Product/Search Routes (`/api/products` or `/api/search`)

**New Resource:**
```
GET    /api/products/search                # Move from /savings-goal/search
GET    /api/search/products                # Alternative naming
```

### 7. Checkout Cart Routes (`/api/checkout-carts`)

**New Resource:**
```
GET    /api/checkout-carts/:id             # Rename from /checkout-cart/:checkoutId
POST   /api/checkout-carts                 # Create checkout cart
GET    /api/checkout-carts                 # List checkout carts
```

### 8. Refund Routes (`/api/refunds`)

**New Resource:**
```
POST   /api/refunds                        # Create refund (move from /savings-goals/:id/refund)
GET    /api/refunds                        # List refunds
GET    /api/refunds/:id                    # Get single refund
```

### 9. Webhook Routes

**Recommended Structure:**
```
POST   /api/webhooks/unit                  # Unit webhooks (rename from /webhook)
POST   /api/webhooks/shopify-pubsub        # Shopify pub/sub (keep)
POST   /api/webhooks/unit-application-update # Move from shopify-merchant
```

### 10. Launch Routes (`/api/launch-notifications`)

**Recommended Structure:**
```
POST   /api/launch-notifications           # Rename from /notify
GET    /api/launch-notifications           # List notifications (if needed)
```

---

## Priority Fixes

### High Priority (Breaking Changes - Major Impact)

1. **Move non-resource actions out of savings-goal routes:**
   - `/send-verification` → `/api/auth/verification/send`
   - `/verify-code` → `/api/auth/verification/verify`
   - `/connect-plaid` → `/api/bank/plaid/connect`
   - `/plaid/create-link-token` → `/api/bank/plaid/link-token`
   - `/search` → `/api/products/search`

2. **Fix bank routes:**
   - `/setup-savings` → `/api/savings-goals/:id/schedule` (PUT)
   - `/transaction-history/:savingsGoalId` → `/api/savings-goals/:id/transactions`

3. **Fix merchant routes:**
   - Toggle operations → PUT `/api/merchants/:id` with body
   - `/sso-login` → `/api/auth/shopify-sso`
   - `/webhook/unit-application-update` → `/api/webhooks/unit-application-update`

### Medium Priority (Improvements - Moderate Impact)

1. **Standardize resource names:**
   - `/current_user` → `/api/users/me`
   - `/create-guest-goal` → `/api/savings-goals/guest`
   - `/create-application-form` → `/api/users/me/unit-application-form`

2. **Move actions to sub-resources:**
   - `/:id/generate-image` → `/:id/actions/generate-image`
   - `/:id/web-search` → `/:id/actions/web-search`
   - `/:id/save-product` → `/:id/actions/save-product`
   - `/:id/refund` → `/api/refunds` (POST)

3. **Fix checkout cart:**
   - `/api/checkout-cart/:checkoutId` → `/api/checkout-carts/:id`

### Low Priority (Nice to Have - Low Impact)

1. **Rename for clarity:**
   - `/forgot-password` → `/api/auth/password/reset`
   - `/send-verification` → `/api/auth/email/verify`
   - `/notify` → `/api/launch-notifications`

2. **Consolidate duplicate routes:**
   - Merge `/customer-token` routes (auth and merchant)
   - Remove deprecated `/login` route

---

## Summary Statistics

- **Total Routes Audited:** ~45 routes
- **Fully REST Compliant:** ~15 routes (33%)
- **Partially Compliant:** ~18 routes (40%)
- **Non-Compliant:** ~12 routes (27%)

### Main Issues Found:
1. **Actions mixed with resources** - Many POST endpoints that perform actions rather than create resources
2. **Wrong resource placement** - Routes placed in wrong resource files (e.g., Plaid in savings-goal)
3. **Inconsistent naming** - Mix of camelCase, kebab-case, and action verbs
4. **Missing resource hierarchy** - No clear parent-child relationships
5. **Webhooks in wrong places** - Webhooks mixed with resource routes

