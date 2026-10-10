# ORIGEN for Android

The Android app is a native Capacitor shell around a purpose-built mobile
interface. It is not the website in a frame: the mobile UI lives in
`src/mobile/`, has its own entry (`mobile/index.html`) and build
(`vite.mobile.config.ts`), and reuses only the tested, DOM-free logic from
`src/` (generator, BIN validation, Guison client, sorter, exports).

Everything the app needs to start is bundled into the APK. No website is
loaded at launch, and Generator, Card Sorter and Settings work with no
connection at all.

## Contents

- [Prerequisites](#prerequisites)
- [Build commands](#build-commands)
- [Where the APK is](#where-the-apk-is)
- [Installing on a device](#installing-on-a-device)
- [Developing the mobile UI](#developing-the-mobile-ui)
- [Release signing](#release-signing)
- [Versioning](#versioning)
- [External services and network use](#external-services-and-network-use)
- [Permissions and privacy](#permissions-and-privacy)
- [Mobile behaviour](#mobile-behaviour)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Limitations](#limitations)

Adding a new tool is covered in [ADDING_A_TOOL.md](./ADDING_A_TOOL.md).

## Prerequisites

| Requirement | Version |
| --- | --- |
| Node.js | 22 or newer (required by the Capacitor 8 CLI) |
| JDK | 21 (Temurin or the JDK bundled with Android Studio) |
| Android SDK | Platform 36 and Build-Tools 36 (Android Studio Otter 2025.2.1 or newer installs them) |
| Device or emulator | Android 7.0 (API 24) or newer, with an up-to-date Android System WebView |

Point the build at the SDK with `ANDROID_HOME` (or an `android/local.properties`
file containing `sdk.dir=/path/to/Android/sdk`, which is git-ignored). The
Gradle wrapper in `android/` downloads the matching Gradle version on first
use.

## Build commands

```bash
npm ci                      # install dependencies
npm run build:mobile        # type-check, then bundle the mobile UI into dist-android/
npm run android:sync        # build:mobile + copy the bundle and plugins into android/
npm run android:apk:debug   # sync + ./gradlew assembleDebug
npm run android:apk:release # sync + ./gradlew assembleRelease (signed if configured)
npm run android:open        # open android/ in Android Studio
```

`android:sync` must run after every web change; Gradle packages whatever is in
`android/app/src/main/assets/public`, which `cap sync` fills from
`dist-android/`. Both are generated and git-ignored.

On Windows, run the Gradle steps from `android\` with `gradlew.bat` instead of
`./gradlew`.

### Building in GitHub Actions

`.github/workflows/android.yml` builds the debug APK on every pull request and
push to `main`, checks that it requests only network permissions, and uploads
it as the `origen-debug-apk` artifact:

```bash
gh run list --workflow android.yml
gh run download <run-id> -n origen-debug-apk
```

Running the workflow manually with **release** checked also builds a release
APK (see [Release signing](#release-signing)).

## Where the APK is

| Build | Path |
| --- | --- |
| Debug | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Release, signed | `android/app/build/outputs/apk/release/app-release.apk` |
| Release, unsigned | `android/app/build/outputs/apk/release/app-release-unsigned.apk` |

The debug APK is signed with the local Android debug key and is suitable for
testing only.

## Installing on a device

With USB debugging enabled (Settings → About phone → tap Build number seven
times, then Developer options → USB debugging):

```bash
adb devices                       # the phone should be listed as "device"
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Without adb, copy the APK to the phone and open it from a file manager. Android
asks once to allow installs from that app ("Install unknown apps").

A debug build and a release build signed with a different key cannot replace
each other; uninstall one before installing the other.

## Developing the mobile UI

```bash
npm run dev:mobile      # http://localhost:5174 — the mobile UI in a browser
npm run preview:mobile  # serve the production bundle on :4174
```

Use the browser's device toolbar at a phone size. In a browser, **Escape**
performs the Android Back action, and the platform layer falls back to web
implementations (localStorage, the async clipboard, file downloads).

To debug the app on a device, run a debug build and open
`chrome://inspect/#devices` in desktop Chrome.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_ORIGEN_BIN_API_ORIGIN` | `https://guison-api.onrender.com` | HTTPS origin of a Guison-compatible BIN metadata service |

Set it in the environment or a git-ignored `.env.local` before
`npm run build:mobile`. Only a bare `https://` origin is accepted; the build
fails on anything else, and the value also becomes the only `connect-src`
allowed by the app's Content Security Policy. It is public configuration, not
a secret: nothing secret is ever compiled into the APK.

## Release signing

Release signing needs a keystore that you create and keep yourself. It is never
committed: `*.jks`, `*.keystore` and `android/keystore.properties` are
git-ignored.

1. Create a keystore once and back it up somewhere safe. Losing it means you
   can never ship an update that installs over existing copies.

   ```bash
   keytool -genkeypair -v -keystore origen-release.jks \
     -alias origen -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Provide the credentials in **one** of these ways:

   - **Local file**: copy `android/keystore.properties.example` to
     `android/keystore.properties` and fill it in. `storeFile` is relative to
     `android/`.
   - **Environment variables** (CI, or to keep passwords out of files):
     `ORIGEN_KEYSTORE_PATH`, `ORIGEN_KEYSTORE_PASSWORD`, `ORIGEN_KEY_ALIAS`,
     `ORIGEN_KEY_PASSWORD`.

3. Build and verify:

   ```bash
   npm run android:apk:release
   "$ANDROID_HOME"/build-tools/36.0.0/apksigner verify --print-certs \
     android/app/build/outputs/apk/release/app-release.apk
   ```

If no complete set of credentials is found, `assembleRelease` still succeeds but
produces `app-release-unsigned.apk`, which Android will not install until it is
signed (for example with `apksigner sign`).

### Signing in GitHub Actions

Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ORIGEN_KEYSTORE_BASE64` | `base64 -w0 origen-release.jks` |
| `ORIGEN_KEYSTORE_PASSWORD` | keystore password |
| `ORIGEN_KEY_ALIAS` | key alias, e.g. `origen` |
| `ORIGEN_KEY_PASSWORD` | key password |

Then run the **Android** workflow manually with **release** checked. The
keystore is decoded into the runner's temporary directory for the build and
deleted afterwards. Workflows triggered from forks do not receive secrets.

## Versioning

`versionName` is read from the root `package.json` (`1.0.0`), and `versionCode`
is derived from it as `major × 10000 + minor × 100 + patch` (`10000`). Bump the
version in `package.json` before a release; the About section in Settings shows
the installed version and build number. Both values can be overridden:

```bash
cd android && ./gradlew assembleRelease -PversionName=1.1.0 -PversionCode=10100
```

## External services and network use

BIN Lookup is the only feature that uses the network. It calls the Guison API
(`GET /v1/bin/{6–8 digits}`), an open, unauthenticated service for public BIN
range metadata (data: `venelinkochev/bin-list-data`, CC BY 4.0).

- Only a validated 6–8 digit prefix is sent. Full card numbers, expiry dates
  and CVVs are rejected on the device before any request.
- Requests time out after 15 seconds and can be cancelled with Back or the
  Cancel button. A transient outage (network failure or 5xx) is retried once.
- When the device is offline the lookup fails immediately with an offline
  message; nothing is queued or cached, and no metadata is ever invented. A
  "not found" answer is shown as a normal result.
- Guison runs on a free hosting tier, so the first request after a quiet period
  can take several seconds while the service wakes up.
- Settings → **Check service status** calls `/readyz` only when tapped.

Generator, Card Sorter and Settings never make network requests.

## Permissions and privacy

The APK requests only:

- `INTERNET` — BIN Lookup.
- `ACCESS_NETWORK_STATE` — to show offline state honestly.

No storage, camera, location or contacts permissions are requested, and the
manifest strips broad storage permissions even if a future dependency asks for
them. The Android CI workflow fails if the built APK requests any other permission.

- Only the theme choice is persisted (Capacitor Preferences). Inputs, results
  and recent lookups live in memory and are gone when the app is closed.
- Exports are written to the app's private cache (`cache/exports/`) and handed
  to the Android share sheet through a `FileProvider` scoped to that folder.
- Cloud backup and device-to-device transfer are disabled
  (`allowBackup="false"` plus data extraction rules).
- Cleartext HTTP is disabled, mixed content is blocked, and the bundled page
  runs under a strict Content Security Policy (`default-src 'none'`, scripts and
  styles from the bundle only, `connect-src` limited to the BIN API origin).

## Mobile behaviour

- **Navigation**: a persistent bottom bar with an icon and label for each tool.
  Tool screens are created on first visit and stay alive, so switching tabs
  never loses typed input. Rapid repeated taps are ignored; tapping the current
  tab scrolls it to the top.
- **Back**: closes an open sheet first, then leaves a secondary view (Generator
  results, Sorter result) or cancels a running lookup, then returns to
  Generator, and finally leaves the app. Tabs never build up a history stack.
- **Destructive actions** (clearing results or input, replacing input from the
  clipboard) ask for confirmation.
- **Edge-to-edge**: the layout pads itself with the system bar and display
  cutout insets that Capacitor's SystemBars plugin provides (with
  `env(safe-area-inset-*)` as a fallback).
- **Keyboard**: the WebView resizes for the soft keyboard; the bottom bar hides
  while typing and the focused field is scrolled into view.
- **Touch and zoom**: every control is at least 44 px in both directions, pinch
  and double-tap zoom are disabled, and nothing scrolls horizontally down to
  320 px wide.
- **Theme**: charcoal-and-mint dark by default, with Light and System options.
  The status and navigation bar icons follow the theme.
- **Motion**: transitions are short, and are removed when the system's
  "Remove animations" setting is on.
- **Startup**: no timed splash screen. The window is charcoal from the first
  frame, and the system splash on Android 12+ is dismissed as soon as the app
  draws.

## Project layout

```
capacitor.config.ts        App id, name, webDir (dist-android) and plugin settings
vite.mobile.config.ts      Mobile build: entry, CSP, version define
mobile/index.html          Mobile entry document
src/mobile/
  main.ts                  Boot: platform → theme → shell
  shell.ts                 App bar, screen host, bottom navigation, Back, feedback
  config.ts                Build-time configuration
  core/                    Tool registry, navigation, Back stack, events, theme, keyboard
  platform/                Platform contracts with Capacitor and browser implementations
  services/bin-service.ts  Guison adapter: offline check, retry, cancellation
  logic/sorter-session.ts  Card Sorter state over the shared transforms
  tools/                   Generator, BIN Lookup, Card Sorter, Settings
  ui/                      DOM helpers, components, sheets, toasts
  styles/mobile.css        Mobile design system
android/                   Native Android project (Gradle)
tests/android/             Playwright tests for the mobile bundle
```

## Testing

```bash
npm test                    # Vitest (web + mobile) and static-server tests
npm run test:coverage       # with coverage thresholds
npm run test:e2e:android    # Playwright against the production mobile bundle
```

Unit tests cover the registry, navigation and Back handling, the shell
(offline startup without network requests, tab state, error containment), each
tool, the BIN service, theme, keyboard detection and the browser adapters. The
Playwright `android` project runs a Pixel 7-sized viewport against the same
files that go into the APK and checks the CSP, offline behaviour, touch target
sizes, overflow, safe areas, the keyboard layout and reduced motion.

## Limitations

- Android only; there is no iOS project.
- Browser tests emulate a phone; they do not replace testing on real devices
  and Android versions.
- The bundle targets modern JavaScript (ES2022). Devices need an Android System
  WebView from roughly 2022 or later, which Google Play keeps updated on
  Android 7.0+.
- The Capacitor bridge is injected by the native WebView. On WebViews too old
  to support that, native features fall back to web behaviour (for example,
  exports and clipboard may be unavailable) while the tools keep working.
- Session data is in memory by design. If Android stops the app in the
  background, inputs and recent lookups start fresh on return.
- Exporting needs an app that accepts shared files (Files, Drive, email).
  Copying to the clipboard always works.
- BIN Lookup depends on the availability of the Guison service and its free
  hosting tier.
- There is no in-app update mechanism; install newer APKs over the old one
  (same signing key required).
