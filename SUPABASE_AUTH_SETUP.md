# Card Crunch Supabase + Google Authentication

This repository is configured for a dedicated Card Crunch identity only.

## Repository audit

The pre-implementation audit found:

- `.vercel/project.json` is linked to the Vercel project named `card-crunch`; it is not committed.
- No Supabase project URL, Supabase key, Google OAuth client ID, or Google OAuth secret existed in source or local environment files.
- No `google-services.json` is present.
- The previous `src/stlAccount.js` implementation pointed at a shared `stlproductionz.io` API and explicitly reused identity with another game. It has been removed.
- The previous Android ID `com.sebtheleb.cardcrunch` has been replaced by the dedicated ID `com.stlproductionz.cardcrunch`.
- The dedicated native callback is `cardcrunch://auth/callback`.
- Upstash/Redis matchmaking variables are unrelated to authentication and remain isolated to online-duel infrastructure.

Do not place a service-role key, Google client secret, or any private key in `VITE_*` variables. Browser builds may only receive the Supabase publishable/anonymous key.

## 1. Create the dedicated Supabase project

1. Sign in to [Supabase](https://supabase.com/dashboard).
2. Create a new project named **Card Crunch** in the intended organization.
3. Do not clone another application's project or database.
4. Save the project reference shown in the project URL. It will look like `abcdefghijklmnopqrst`.
5. No public user table is required for authentication. Supabase manages identities in `auth.users`. Add game profile/progress tables later only with dedicated migrations and Row Level Security.

## 2. Copy the public project values

In **Project Settings > API** copy:

- Project URL: `https://<CARD_CRUNCH_PROJECT_REF>.supabase.co`
- Publishable key (`sb_publishable_...`) or legacy anonymous key

Never copy the `service_role` key into this application.

## 3. Create environment variables

Create `.env.local` from `.env.example` for local development:

```dotenv
VITE_SUPABASE_URL=https://<CARD_CRUNCH_PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<CARD_CRUNCH_PUBLISHABLE_OR_ANON_KEY>
VITE_APP_URL=http://localhost:4183
```

In the **card-crunch** Vercel project, add these variables separately for Production, Preview, and Development:

| Variable | Production value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<CARD_CRUNCH_PROJECT_REF>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Card Crunch publishable/anonymous key |
| `VITE_APP_URL` | `https://card-crunch.vercel.app` |

Use `http://localhost:4183` for the local Development value of `VITE_APP_URL`.

## 4. Configure Supabase Authentication URLs

In **Authentication > URL Configuration** set:

- **Site URL:** `https://card-crunch.vercel.app`
- **Redirect URLs:**
  - `https://card-crunch.vercel.app/auth/callback`
  - `http://localhost:4183/auth/callback`
  - `cardcrunch://auth/callback`

If Vercel preview authentication is needed, add the exact preview callback URL for the branch being tested. Do not authorize an unrelated Vercel project.

## 5. Create the dedicated Google OAuth client

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in a Google Cloud project dedicated to Card Crunch.
2. Configure the consent screen with the name **Card Crunch**, its own support contact, privacy-policy URL, and branding.
3. Create an OAuth Client ID of type **Web application** named **Card Crunch Web**.
4. Add these **Authorized JavaScript origins**:
   - `https://card-crunch.vercel.app`
   - `http://localhost:4183`
5. Add this single Supabase **Authorized redirect URI**:
   - `https://<CARD_CRUNCH_PROJECT_REF>.supabase.co/auth/v1/callback`
6. Copy the Google client ID and client secret into **Supabase > Authentication > Providers > Google**, then enable the provider.

The Google redirect URI is Supabase's callback, not `/auth/callback` on Card Crunch. Supabase redirects back to Card Crunch after completing the provider exchange.

## 6. Native Android and iOS callbacks

Android is prepared with:

- Package/application ID: `com.stlproductionz.cardcrunch`
- Custom protocol: `cardcrunch`
- Callback: `cardcrunch://auth/callback`
- An Android `VIEW` intent filter for host `auth` and path `/callback`
- Capacitor App and Browser plugins for receiving the deep link and running the OAuth browser

After configuring environment variables, run:

```powershell
npm run android:sync
```

If an iOS target is added later, use bundle ID `com.stlproductionz.cardcrunch` and add `cardcrunch` to `CFBundleURLTypes`. No iOS project currently exists in this repository.

## 7. Verify the Vercel project link

Run:

```powershell
Get-Content .vercel/project.json
npx vercel project inspect card-crunch
```

The local file must report `"projectName": "card-crunch"`. If it names another product, delete only the local `.vercel` directory and run `npx vercel link`, explicitly choosing **card-crunch**. Never copy a `.vercel` directory from another repository.

## 8. Run and diagnose locally

```powershell
npm run dev
```

Open `http://localhost:4183`, then open **Card Crunch Account**. On local hosts, the diagnostics section safely shows only:

- Current origin
- Intended OAuth callback
- Supabase project reference
- Presence/missing state for required variables

It never shows the full publishable key.

## 9. Redeploy after environment changes

Vercel environment changes apply only to new deployments. After adding or updating variables:

```powershell
npx vercel env pull .env.local --environment=development
npm test
npm run build
npx vercel deploy --prod --yes
```

Then test Google sign-in at `https://card-crunch.vercel.app/auth/callback` and confirm the returned user belongs to the new Card Crunch Supabase project.

## Configuration status

The code and callback routes are prepared, but external authentication is **not fully configured** until the dedicated Supabase project, Google OAuth client, Supabase provider settings, redirect allowlist, and Vercel environment variables above are completed and tested.
