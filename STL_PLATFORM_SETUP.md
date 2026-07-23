# Card Crunch STL Platform Setup

Card Crunch is a separate product and repository. It integrates with the standalone STL Platform through a public OAuth client and `@stlproductionz/account-sdk`-compatible browser/mobile adapter.

The canonical production domain is always `stlproductionz.io`; the account authority is `https://accounts.stlproductionz.io`.

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
VITE_STL_PLATFORM_URL=https://accounts.stlproductionz.io
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
   - durable STL device ID returned by the token exchange
   - the Card Crunch `user_games` registration used by the STL Productionz profile
4. Set Google Authorized JavaScript origins for the STL Platform account web app, for example:
   - `https://accounts.stlproductionz.io`
   - `http://localhost:3000`
5. Set Google Authorized Redirect URIs to the platform Supabase callback:
   - `https://<STL_PLATFORM_PROJECT_REF>.supabase.co/auth/v1/callback`
6. Add the Card Crunch Vercel environment variables above and redeploy.
7. Verify `.vercel/project.json` in Card Crunch points to the Card Crunch Vercel project, not STL Platform.

## Save, achievement, and playtime mapping

- Profile/library registration: the platform atomically records Card Crunch for the player after a successful game-bound OAuth exchange. The game never writes profile tables directly.
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

## Session storage

- Installed Android builds persist STL sessions with `@aparajita/capacitor-secure-storage`, using Android Keystore-backed AES-GCM. The same pinned dependency uses the iOS Keychain if an iOS target is added.
- Native OAuth transactions use the same protected store, so the PKCE verifier survives an app process restart while the system browser is open.
- iOS Keychain synchronization is disabled and credentials are marked `whenUnlockedThisDeviceOnly`.
- Android application backup is disabled so encrypted session data cannot be restored without the device-bound Keystore key.
- Browser builds deliberately keep access tokens in memory and never persist refresh tokens in `localStorage`, `sessionStorage`, or the secure-storage plugin's plaintext web implementation. Durable browser sign-in requires a future server-side `HttpOnly` session design.
- Card Crunch has no Electron target. Any future desktop shell must use Electron `safeStorage` in its main process through narrow, sender-validated IPC; it must not reuse the browser adapter.

Live auth is not complete until the STL Platform production API host, Supabase project, Google OAuth app, Vercel environment variables, and OAuth token authority are configured and verified.
