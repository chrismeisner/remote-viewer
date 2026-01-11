# Testing Password Protection

## Changes Made

I've implemented several improvements to fix the password overlay issue on Heroku:

### 1. **Server-Side Cookie Authentication** (`src/middleware.ts`)
- Added Next.js middleware to check authentication on every request
- Uses HTTP-only secure cookies for authentication persistence
- Cookies last 7 days

### 2. **Improved Auth API** (`src/app/api/auth/verify/route.ts`)
- POST endpoint now sets a secure HTTP-only cookie on successful authentication
- GET endpoint returns both `passwordRequired` and `isAuthenticated` status
- Better error logging with console.error

### 3. **Enhanced Client-Side Auth** (`src/app/page.tsx`)
- Now checks both sessionStorage AND server-side cookie authentication
- Better error handling with visible error messages
- Added console logging for debugging authentication flow

### 4. **Better Password Modal** (`src/components/PasswordModal.tsx`)
- Added detailed console logging for debugging
- Improved error messages to help diagnose connection issues

## Testing Locally

1. **Set a password in your environment:**
   ```bash
   # Create a .env.local file if you don't have one
   echo "VIEWER_PASSWORD=test123" > .env.local
   ```

2. **Restart the dev server:**
   ```bash
   # Stop the current server (Ctrl+C) and restart:
   npm run dev
   ```

3. **Clear your browser storage:**
   - Open DevTools (F12)
   - Go to Application tab
   - Clear "Session Storage" and "Cookies" for localhost:3000

4. **Visit http://localhost:3000**
   - You should see the password modal
   - Open the Console tab to see auth logs like:
     - `[auth] check result: { passwordRequired: true, isAuthenticated: false }`
     - When you enter password: `[auth] attempting login...`
     - After success: `[auth] login successful`

5. **Enter the password** (e.g., "test123")
   - The modal should disappear
   - The app should work normally

6. **Refresh the page**
   - You should NOT see the password modal again (cookie persists)

## Testing on Heroku

1. **Set the environment variable on Heroku:**
   ```bash
   heroku config:set VIEWER_PASSWORD=your-secure-password
   ```

2. **Deploy these changes:**
   ```bash
   git add .
   git commit -m "Fix password authentication with server-side cookies"
   git push heroku main
   ```

3. **Test the production site:**
   - Visit your Heroku URL
   - Open browser DevTools Console
   - You should see the password modal
   - Check the console for auth logs

4. **Check for errors:**
   - If the modal doesn't appear, check Console for:
     - `[auth] check error:` - indicates fetch failed
     - Network tab - check if `/api/auth/verify` returns 200
   - If the API call fails, check Heroku logs:
     ```bash
     heroku logs --tail
     ```

## Debugging Production Issues

If the modal still doesn't appear on Heroku:

1. **Check Heroku logs:**
   ```bash
   heroku logs --tail
   ```
   Look for any errors related to `/api/auth/verify`

2. **Verify environment variable:**
   ```bash
   heroku config:get VIEWER_PASSWORD
   ```

3. **Check browser console:**
   - Look for `[auth]` prefixed logs
   - Check Network tab for `/api/auth/verify` response
   - Look for any CORS or CSP errors

4. **Test the API directly:**
   - Open: `https://your-app.herokuapp.com/api/auth/verify`
   - Should return: `{"passwordRequired":true,"isAuthenticated":false}`

## Key Improvements

The main fix is using **HTTP-only cookies** instead of only sessionStorage:

- **Before**: Only client-side sessionStorage (not persistent, could fail silently)
- **After**: Server-side cookie + sessionStorage (more reliable, persists across page loads)

The middleware and improved error handling should make the authentication much more reliable in production environments.
