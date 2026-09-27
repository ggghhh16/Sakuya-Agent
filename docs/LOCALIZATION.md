# Localization

Sakuya supports `en` and `zh-CN`. `src/i18n.ts` keeps a small external locale store and exposes `useLocale`, `tr`, `getLocale`, and `setLocale`. Components subscribe without remounting, so switching preserves form and chat state. The preference is saved under `sakuya-language` and reflected in the document's `lang` attribute. First launch follows the browser language.

Chinese source strings are translation keys. English translations live in `src/locales/en.json`. Wrap interface strings with `tr`; use indexed placeholders such as `tr('新建{0}', [kind])` for complete sentences. Add `useLocale()` to components that render translated content. Shared status maps use getters to avoid freezing their language at module initialization. Format dates with `getLocale()` and calendar headers with `weekdays()`.

Do not translate user input, persisted document titles, chat messages, reports, code, or source excerpts. Known backend error text may be translated for display; unknown diagnostics remain intact. Existing demo data and worker logs are not rewritten. The chosen interface language does not change model prompts.

The main language button is immediately after Settings. Login and registration have their own accessible toggle. The Turnstile widget receives the chosen language and is recreated when that language changes.

Desktop startup text and tray menus also follow the locale. A narrow preload method accepts only `en` or `zh-CN`; the main process checks the sender, main frame, and workspace origin before persisting the preference. Browser-only choices stay in that browser and do not modify a separate desktop profile.

Run `node scripts/check-locales.mjs` to check literal translation coverage and placeholder parity. Run `node node_modules/@playwright/test/cli.js test tests/language.spec.ts` for browser behavior. Tests explicitly set a Chinese browser locale for compatibility with the existing Chinese suite; the language tests also verify English behavior.

Run `node scripts/check-language-desktop.mjs <release-directory>/win-unpacked` to verify the actual packaged Electron application using an isolated profile and backend. This checks switching, validation of native locale preferences, and persistence after restarting the application. It does not verify a real external CAPTCHA challenge.
