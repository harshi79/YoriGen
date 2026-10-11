# ORIGEN brand identity

One mark, one palette, one type scale, used by the web product and the Android
app. This page records what each brand asset is, where its source of truth
lives, and the rules that keep the copies in agreement.

`src/mobile/brand.test.ts` checks most of these facts on every test run: the
palette in `mobile.css` against `android/.../values/colors.xml`, the app name
across all five places it appears, the geometry of the launcher and splash
marks, the WCAG contrast of the text colours, and the two typography rules
below.

## Contents

- [The mark](#the-mark)
- [Palette](#palette)
- [Typography](#typography)
- [Casing](#casing)
- [Android brand assets](#android-brand-assets)
- [Sources of truth](#sources-of-truth)
- [Changing the brand](#changing-the-brand)

## The mark

A pair of braces drawn as a single stroked path. It stands for the JSON
fixtures the product exists to produce, and it is legible at 16 px because it
is only two polylines and one chevron each side.

The path is authored once, in a 40-unit space, and every asset reuses it:

```
M15,10h-3v7l-3,3 3,3v7h3m10,-20h3v7l3,3 -3,3v7h-3
```

| Asset | Path | Notes |
| --- | --- | --- |
| `public/favicon.svg` | `M15 10h-3v7l-3 3 3 3v7h3m10-20h3v7l3 3-3 3v7h-3` | Space-separated SVG form; mint chip, dark ink |
| `android/.../drawable/ic_launcher_foreground.xml` | as above | Dark ink, for the mint adaptive background |
| `android/.../drawable/ic_launcher_monochrome.xml` | as above | White, for Android 13+ themed icons |
| `android/.../drawable/ic_splash_brand.xml` | as above | Mint, for the charcoal splash window |
| `android/.../mipmap-*dpi/ic_launcher*.png` | rasterised | Pre-rendered for API 24–25, which has no adaptive icons |

The in-app brand mark in the app bar is the same shape, drawn by the `Braces`
icon from `lucide` inside a mint chip (`.brand-mark` in `shell.ts`).

## Palette

Charcoal and mint. The web product and the mobile app define the same values;
the Android resources mirror the four that the native layer needs before the
WebView paints.

Dark (the default):

| Token | Value | Use | Contrast on `--bg` |
| --- | --- | --- | --- |
| `--bg` | `#101210` | Window, launch background, splash background | — |
| `--surface` | `#181b18` | Cards, bottom navigation | — |
| `--surface-2` | `#1e221d` | Raised chips and segments | — |
| `--input` | `#121512` | Fields, code blocks | — |
| `--border` | `#2c302b` | Card and control outlines | — |
| `--line` | `#262a25` | Hairline separators | — |
| `--text` | `#e9eae6` | Body text | 15.6:1 |
| `--muted` | `#a1a79c` | Secondary text | 7.6:1 |
| `--faint` | `#8a9284` | Eyebrows, footnotes | 5.9:1 |
| `--accent` | `#d1f58a` | Mint: primary actions, the mark, active tab | — |
| `--accent-ink` | `#253119` | Ink on mint | 11.2:1 on `--accent` |
| `--warn` | `#f5c98a` | Offline pill, caution notices | 12.2:1 |
| `--danger` | `#ff9b8f` | Errors, destructive actions | 9.3:1 |
| `--danger-ink` | `#2b0b07` | Ink on a danger surface | 9.0:1 on `--danger` |
| `--focus` | `#a3cb60` | Focus ring (a non-text component, 3:1 minimum) | 10.1:1 |

Light (`:root[data-theme="light"]`) keeps the same hues on a warm off-white:
`--bg` `#f5f6f1`, `--surface` `#ffffff`, `--text` `#20271c` (14.1:1),
`--muted` `#56604d` (6.6:1 on white), `--faint` `#5b6450` (5.7:1),
`--accent` `#c9ed83` with `--accent-ink` `#26341a` (10.0:1), `--warn`
`#8a5a12` (5.4:1), `--danger` `#b3261e` (6.0:1) with `--danger-ink`
`#ffffff` (6.5:1 on `--danger`), `--focus` `#5f8a1f` (3.8:1 — a focus ring is
a user-interface component, where the minimum is 3:1).

Every text/background pair used in the app clears WCAG AA (4.5:1), and body
text clears AAA (7:1). Both filled surfaces — the mint of a primary button and
the red of a destructive one — take their ink from a token, because danger is
pale in Dark and deep in Light; a hardcoded foreground on it measured 2.8:1 in
Light. The brand test asserts all of this rather than leaving it to review.

## Typography

**No font file is bundled.** `--font-ui` is
`Roboto, Inter, -apple-system, "Segoe UI", system-ui, sans-serif`. Roboto is
Android's system face, so on a device it is always present, always offline and
zero bytes; the app's Content Security Policy allows `font-src 'self'` only, so
a web font would have to ship inside the APK to work at all. Inter leads on the
web product; neither product ships a font file, so both fall back to the platform
face. `--mono` is
`ui-monospace, "SFMono-Regular", "Roboto Mono", "Droid Sans Mono", Consolas,
monospace` for card numbers, CVVs, JSON and code.

Sizes are a named scale, one step per role that appears in the app. Use the
token, never the literal:

| Token | Size | Role |
| --- | --- | --- |
| `--size-micro` | 10px | Fixture stamp |
| `--size-label` | 11px | Wordmark, badges |
| `--size-caption` | 12px | Navigation labels, code, statistics labels, status pill |
| `--size-note` | 13px | Hints, metadata rows, footnotes |
| `--size-body` | 14px | Body copy, field labels, notices, buttons on the action bar |
| `--size-control` | 15px | Buttons, segments, switch labels |
| `--size-title` | 16px | Inputs, card titles, state titles; the root size |
| `--size-value` | 18px | Numeric results |
| `--size-heading` | 19px | App bar and sheet headings |
| `--size-input-lg` | 20px | The large BIN input |
| `--size-display` | 22px | Fatal-error heading |

Weights:

| Token | Weight | Role |
| --- | --- | --- |
| `--weight-regular` | 400 | Body copy |
| `--weight-medium` | 500 | De-emphasised values |
| `--weight-emphasis` | 550 | Data values, list links, toasts |
| `--weight-label` | 600 | Field labels, badges, navigation labels |
| `--weight-title` | 650 | Card, state, sheet and app-bar titles; primary buttons |
| `--weight-logotype` | 700 | The ORIGEN wordmark only |

550 and 650 are deliberate intermediate steps. Android's Roboto resolves them
to Medium and Bold; pinning the numbers keeps the rendering identical on every
device instead of leaving it to CSS weight matching.

Line height: `--leading-tight` 1.25 (single-line headings), `--leading-snug`
1.45 (the default), `--leading-normal` 1.55 (code), `--leading-relaxed` 1.6
(long generated output).

Letter spacing: `--tracking-tight` −0.01em (headings), `--tracking-normal`
0.01em (navigation labels, monospaced data), `--tracking-wide` 0.06em (badges,
the large BIN input), `--tracking-micro` 0.08em (the fixture stamp),
`--tracking-label` 0.14em (badges), `--tracking-logotype` 0.16em (the
wordmark). Tracking is dropped to `0` below 360 px so the navigation labels
still fit.

Text scales with the user's system font setting: sizes are `px` on a 16 px
root, `-webkit-text-size-adjust: 100%` stops mobile browsers inflating
landscape text, and nothing is set in a fixed-height box that would clip.

## Casing

Two rules, both enforced by tests.

1. **Content is authored in sentence case.** Descriptions, tool output,
   placeholders, errors, dialogs, hints and anything a person reads at length
   are written normally. Uppercase is a CSS treatment, applied by exactly two
   selectors — `.brand-name` (the wordmark) and `.badge` — so it is
   presentation only. Screen readers read the real text, copy-and-paste
   produces the real text, and a translator never has to decode shouting.
   `src/mobile/brand.test.ts` fails if a third uppercase selector appears.

2. **Nothing derived from a person or a service is re-cased.** User input,
   generated fixtures, BIN metadata, service labels, hostnames and URLs keep
   the casing they arrive with. `String.prototype.toUpperCase` is not called on
   UI text anywhere in `src/mobile/`; the two remaining `toLowerCase` calls
   build CSS class names and DOM event names.

Badges are the only place caps are appropriate: two-or-three-word status
micro-labels such as `Step 1`, `Needs internet`, `Works offline`,
`Session snapshot` and `Not checked`. Acronyms stay as
acronyms (`BIN`, `IIN`, `CVV`, `JSON`), and `SYNTHETIC TEST FIXTURE` stays
uppercase because it is a fixed stamp shared with the web product's exports,
not a sentence.

Navigation labels, card titles, buttons and every longer string stay in
sentence case. Uppercase is not applied wholesale.

## Android brand assets

Application label. `android/app/src/main/res/values/strings.xml` holds
`app_name` and `title_activity_main`, both `ORIGEN`; the manifest references
`@string/app_name`, so the launcher name is localisable without a rebuild.
`capacitor.config.ts` repeats it as `appName` and `src/mobile/config.ts` as
`config.appName`; the brand test fails if they drift apart.

Launcher icon. `mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml`
are adaptive icons: `@color/ic_launcher_background` (the brand mint
`#D1F58A`) plus `@drawable/ic_launcher_foreground` (dark ink braces) plus
`@drawable/ic_launcher_monochrome` for Android 13+ themed icons. The mark's
inked box is 49 × 45 dp centred on the 108 dp canvas, so its circumscribing
circle is 66.5 dp and it survives every launcher mask inside the guaranteed
72 dp safe zone.

Legacy icon. `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher{,_round}.png` are
pre-rendered at 48, 72, 96, 144 and 192 px for API 24–25, which has no adaptive
icons. They are committed rather than generated; see
[Changing the brand](#changing-the-brand).

Splash screen. `AppTheme.NoActionBarLaunch` (parent `Theme.SplashScreen`) sets
`windowSplashScreenBackground` to `@color/origen_background` and
`windowSplashScreenAnimatedIcon` to `@drawable/ic_splash_brand`. There is no
timed splash: the window is charcoal from the first frame and the system splash
is dismissed as soon as the app draws.

`ic_splash_brand.xml` is the braces mark in mint on a 288 dp canvas. Mint is
required here: the launcher foreground's dark ink is designed for the mint
adaptive background and measures 1.4:1 against the charcoal splash, which is
effectively invisible. Mint on charcoal is 15.4:1. The geometry follows the
specification for a splash icon with no background — 288 dp masked to a 192 dp
circle — and the mark's circumscribing circle is 186 dp, so nothing is clipped.

The launch window is charcoal regardless of the system theme, on purpose:
ORIGEN is dark-first, `mobile/index.html` ships `data-theme="dark"`, and the
native layer cannot read the in-app preference before the WebView paints. The
in-app Light and System choices take effect from the first painted frame, and
Capacitor's SystemBars plugin retints the status and navigation bar icons to
match.

Web branding. `public/favicon.svg` is the mark as a 40 × 40 mint chip, and is
copied into `dist-android/` by the mobile build, so the same file serves the
website and the bundled app. `index.html` carries the `ORIGEN — Payment Testing
Toolkit` title, the Open Graph and Twitter tags and the `#111311` theme colour;
the mobile document carries its own `#101210` theme colour, which
`ThemeController` rewrites when the theme changes.

## Sources of truth

| Brand asset | Source of truth | Copies |
| --- | --- | --- |
| Mark path | `public/favicon.svg` | The three Android drawables, the `lucide` `Braces` icon, the rasterised PNGs |
| App name | `android/.../values/strings.xml` | `capacitor.config.ts`, `src/mobile/config.ts`, `mobile/index.html`, `index.html` |
| Palette | `src/mobile/styles/mobile.css` `:root` | `src/style.css` `:root` (web), `android/.../values/colors.xml`, `android/.../values/ic_launcher_background.xml`, the `theme-color` metas |
| Typography | `src/mobile/styles/mobile.css` `:root` tokens | — |
| Adaptive icon | `android/.../mipmap-anydpi-v26/ic_launcher.xml` | `ic_launcher_round.xml` |
| Legacy icon | `android/.../mipmap-*dpi/ic_launcher*.png` | — |
| Splash | `android/.../values/styles.xml` `AppTheme.NoActionBarLaunch` | `android/.../drawable/ic_splash_brand.xml` |
| In-app brand mark | `src/mobile/shell.ts` `.brand-mark` / `.brand-name` | `src/mobile/styles/mobile.css` |
| Bundle and plugin settings | `capacitor.config.ts` | `android/app/src/main/assets/capacitor.config.json` (generated) |

`android/app/src/main/assets/` and `dist-android/` are generated by
`npm run android:sync` and git-ignored. Nothing brand-related is generated:
every asset above is committed.

## Changing the brand

1. Change the value in its source of truth from the table above.
2. Update the copies in the same commit. `npm test` runs
   `src/mobile/brand.test.ts`, which fails if the palette, the app name, the
   mark geometry, the contrast or the typography rules have drifted.
3. For the mark, edit the path in all four vector assets and re-render the
   legacy PNGs. There is no generator in this repository; the PNGs are
   committed. Rendering them from `public/favicon.svg` at 48, 72, 96, 144 and
   192 px — the round variant masked to a circle — is enough.
4. Check the result: `npm run build:mobile` then `npm run preview:mobile`, at
   320 px wide and at a Pixel 7 size (412 × 915), in Dark and Light. The
   Playwright `android` project covers the CSP, offline startup, touch targets
   and overflow; it needs a browser, so it runs in CI.
