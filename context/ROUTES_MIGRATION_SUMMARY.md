# Routes Migration Summary

## Routes Successfully Moved

### 1. Products Routes (`/api/products`)
**New File:** `routes/products.js`

- **`GET /api/products/search`** - Product search using SerpAPI
  - Moved from: `GET /api/savings-goal/search`
  - Requires: `requireSavingsAccountUser` middleware
  - Query param: `q` (search query)

### 2. Auth Verification Routes (`/api/auth/verification`)
**Updated File:** `routes/auth.js`

- **`POST /api/auth/verification/send`** - Send email verification code
  - Moved from: `POST /api/savings-goal/send-verification`
  - Body: `{ email: string }`
  - Creates verification code and sends email via SendGrid

- **`POST /api/auth/verification/verify`** - Verify email code and create guest session
  - Moved from: `POST /api/savings-goal/verify-code`
  - Body: `{ email: string, verificationCode: string }`
  - Returns: `{ success: true, guestToken: string }`

### 3. Bank Plaid Routes (`/api/bank/plaid`)
**Updated File:** `routes/bank.js`

- **`POST /api/bank/plaid/connect`** - Connect Plaid account for guest users
  - Moved from: `POST /api/savings-goal/connect-plaid`
  - Body: `{ guestToken?: string, emailToken?: string, publicToken: string, accountId?: string }`
  - Exchanges Plaid public token for access token

- **`POST /api/bank/plaid/link-token`** - Create Plaid link token for guest users
  - Moved from: `POST /api/savings-goal/plaid/create-link-token`
  - Body: `{ guestToken?: string, emailToken?: string }`
  - Returns: `{ success: true, linkToken: string, expiration: string }`

### 4. User Routes (`/api/users`)
**New File:** `routes/users.js`

- **`GET /api/users`** - Get current authenticated user
  - Moved from: `GET /api/auth/current_user`
  - Returns: User object or null
  - Uses JWT token from Authorization header

- **`PUT /api/users`** - Update current authenticated user
  - New route (previously didn't exist)
  - Requires: `ensureAuthenticated` middleware
  - Body: `{ firstName?: string, lastName?: string, email?: string }`
  - Returns: Updated user object

- **`POST /api/users`** - Create a new user
  - Moved from: `POST /api/auth/register`
  - Body: `{ email: string, password: string, firstName: string, lastName: string, userType?: 'guest' | 'savings-account' }`
  - Creates user in Firebase and MongoDB
  - Returns: `{ message: string, token: string, user: object }`

- **`GET /api/users/customer-token`** - Get Unit customer token for current user
  - Moved from: `GET /api/auth/customer-token`
  - Requires: `ensureAuthenticated` middleware
  - Returns: `{ token: string }`

- **`POST /api/users/unit-application-form`** - Create Unit application form for current user
  - Moved from: `GET /api/auth/create-application-form` (changed to POST)
  - Requires: `ensureAuthenticated` middleware
  - Returns: `{ id: string, token: string, expiration: string, url: string }`

## Server Configuration

**Updated:** `server.js`
- Added: `app.use('/api/products', require('./routes/products'));`
- Added: `app.use('/api/users', userRoutes);`

## Model Dependencies

The following Mongoose models are used by the migrated routes:

- **`VerificationCode`** - Defined in `models/VerificationCode.js`
  - ✅ Consolidated into dedicated model file

- **`GuestSession`** - Defined in `models/GuestSession.js`
  - ✅ Consolidated into dedicated model file

- **`EmailToken`** - Already exists as `models/EmailToken.js`

- **`User`** - Already exists as `models/User.js`
  - Used by user routes for authentication and user management

## Frontend Updates

The following frontend routes have been updated:

1. **Product Search:**
   - Old: `GET /api/savings-goal/search?q=...`
   - New: `GET /api/products/search?q=...`

2. **Verification:**
   - Old: `POST /api/savings-goal/send-verification`
   - New: `POST /api/auth/verification/send`
   - Old: `POST /api/savings-goal/verify-code`
   - New: `POST /api/auth/verification/verify`

3. **Plaid:**
   - Old: `POST /api/savings-goal/connect-plaid`
   - New: `POST /api/bank/plaid/connect`
   - Old: `POST /api/savings-goal/plaid/create-link-token`
   - New: `POST /api/bank/plaid/link-token`

4. **User Routes:**
   - Old: `GET /api/auth/current_user`
   - New: `GET /api/users`
   - Old: `POST /api/auth/register`
   - New: `POST /api/users`
   - Old: `GET /api/auth/customer-token`
   - New: `GET /api/users/customer-token`
   - Old: `GET /api/auth/create-application-form`
   - New: `POST /api/users/unit-application-form`

## Next Steps

1. ✅ Routes moved to proper resource files
2. ✅ Server.js updated to mount products and users routes
3. ✅ Frontend updated to use new route paths
4. ✅ `VerificationCode` and `GuestSession` models consolidated into separate model files
5. ✅ Tests updated to use new route paths
6. ✅ User routes refactored without `/me` keyword (following REST conventions)

