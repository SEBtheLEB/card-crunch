# Card Crunch Google Play Release

Card Crunch is packaged as a Capacitor 8 Android app with package ID `com.sebtheleb.cardcrunch`. It targets Android 16 / API 36 and uses Google Play Games Services v2 for automatic platform authentication and the Best Run leaderboard.

## Build

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run android:bundle
```

The signed bundle is written to:

`android/app/build/outputs/bundle/release/app-release.aab`

The local upload key and its credentials are intentionally ignored by Git. Keep both of these files backed up securely:

- `android/keystore/card-crunch-upload.jks`
- `android/keystore.properties`

Losing the upload key requires an upload-key reset through Play Console. Enroll in Play App Signing when creating the app.

Upload certificate SHA-1 (for the Play Games Android credential):

`8D:D7:09:44:67:2E:D9:1F:92:6B:E4:4A:63:78:FA:55:5F:AB:80:39`

## Play Games Services setup

1. Create the Card Crunch app in Google Play Console using package ID `com.sebtheleb.cardcrunch`.
2. Open Play Games Services, create a v2 configuration, and link the Android app.
3. Create a numeric, larger-is-better leaderboard named `Best Run`.
4. Replace `0000000000` and `REPLACE_WITH_PLAY_LEADERBOARD_ID` in `android/app/src/main/res/values/strings.xml` with the Console-issued project and leaderboard IDs.
5. Add both the upload certificate SHA-1 and the Play App Signing certificate SHA-1 to the linked Play Games credential.
6. Add test accounts, upload to Internal testing, and verify automatic sign-in, score submission at run end, and the leaderboard button.

Play Games v2 is required for new titles. Scores are submitted only at a critical transition (run end), in line with the leaderboard quality guidance.

## Store submission checklist

- Upload the signed `.aab` to Internal testing first.
- Use `https://card-crunch.vercel.app/privacy-policy.html` as the privacy policy URL after the production web deploy completes.
- Complete App access, Ads, Content rating, Target audience, Data safety, and Government apps declarations.
- The current native build does not enable a production ad provider. Mark the initial release accordingly. Update Data safety before enabling AdMob or another provider.
- Add phone screenshots, a 512 x 512 store icon, a 1024 x 500 feature graphic, support email, category, and store copy.
- Run Play Console pre-launch reports on small, standard, and large Android phones.

## Versioning

Before every Play upload, increase `versionCode` in `android/app/build.gradle`. Update `versionName` for user-facing releases.

## Official references

- https://developer.android.com/games/pgs/android/android-signin
- https://developer.android.com/games/pgs/android/leaderboards
- https://developer.android.com/google/play/requirements/target-sdk
