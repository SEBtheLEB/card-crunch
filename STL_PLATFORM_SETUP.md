# Card Crunch STL Platform Setup

Card Crunch is a separate product and repository. It integrates with the standalone STL Platform through a public OAuth client and `@stlproductionz/account-sdk`-compatible browser/mobile adapter.

## Application registration

- Game title: `Card Crunch`
- Game slug: `card-crunch`
- Game ID: `c32010e4-b054-4b59-a636-aa2c5a991d64`
- OAuth client ID: `card-crunch-mobile`
- Client type: public
- PKCE: required, S256 only
- Client secret: none in the game
- Development callback: `cardcrunch-dev://auth/callback`
- Production callback: `cardcrunch://auth/callback`
- Android package ID: `com.stlproductionz.cardcrunch`

## Card Crunch environment variables

Create these locally and in the Card Crunch Vercel project:

```env
VITE_STL_PLATFORM_URL=https://accounts.stlproductions.io
VITE_STL_CLIENT_ID=card-crunch-mobile
VITE_STL_GAME_ID=c32010e4-b054-4b59-a636-aa2c5a991d64
VITE_STL_REDIRECT_URI_DEV=cardcrunch-dev://auth/callback
VITE_STL_REDIRECT_URI_PROD=cardcrunch://auth/callback
```

Never add STL Platform service-role keys, Google OAuth secrets, Supabase keys, or another product's callback URLs to Card Crunch.

## STL Platform manual setup

1. Apply the STL Platform migration `20260722220000_register_card_crunch.sql`.
2. Configure STL Platform's production Supabase project and Google OAuth provider inside the platform repo, not Card Crunch.
3. Ensure the platform OAuth consent/token authority issues short-lived one-time authorization codes bound to:
   - `client_id = card-crunch-mobile`
   - exact redirect URI
   - S256 code challenge
   - permanent STL user ID
4. Set Google Authorized JavaScript origins for the STL Platform account web app, for example:
   - `https://accounts.stlproductions.io`
   - `http://localhost:3000`
5. Set Google Authorized Redirect URIs to the platform Supabase callback:
   - `https://<STL_PLATFORM_PROJECT_REF>.supabase.co/auth/v1/callback`
6. Add the Card Crunch Vercel environment variables above and redeploy.
7. Verify `.vercel/project.json` in Card Crunch points to the Card Crunch Vercel project, not STL Platform.

## Save, achievement, and playtime mapping

- Cloud save slot: `card-crunch-primary`
- Save format: `card-crunch-save-v1`
- Saved systems: pots, coins/economy, card collection, store purchases, shield token, theme, card skin, best score, best streak, total crunches
- Conflict behavior: Card Crunch detects local and cloud revisions that both advanced and marks conflict instead of overwriting.
- Playtime: run start, 30-second heartbeat, run end/quit
- Achievements:
  - `FIRST_CRUNCH`
  - `FIRST_BANK`
  - `FIRST_POT_CLEAR`
  - `FULL_HAND_CRUNCH`
  - `STREAK_5`
  - `MILLION_RUN_CASH`
  - `TOTAL_CRUNCHES_1000`

## Current limitation

The browser build cannot store refresh tokens in OS-protected credential storage. The adapter stores web sessions in memory only. Native Android/iOS builds should install a Capacitor secure-storage plugin exposing `SecureStorage` or `SecureStoragePlugin`; once present, Card Crunch will use it automatically for session restoration.

Live auth is not complete until the STL Platform production API host, Supabase project, Google OAuth app, Vercel environment variables, and OAuth token authority are configured and verified.
