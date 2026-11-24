---
alwaysApply: true
---

# pebble-spool

Spool is a watchapp for Pebble Time 2 (emery) that shows texts pasted on the phone. It is written in C with the Pebble SDK; the phone side is PebbleKit JS. Current version – 1.5.2, change history – in `CHANGELOG.md`.

Store: https://apps.repebble.com/14817aa6769140bda8a8f80d

Talk to the user in Ukrainian. Code comments, variable names and commit messages are in English.

## Purpose and boundaries

Show a specific text from the phone on the watch. Nothing more.

Never do:
- text editing on the watch;
- cloud, accounts, syncing with services;
- voice input.

Auto-scroll, Timeline, App Glance, touch – only on separate request.

## Features

- Up to 5 texts, each up to 8000 bytes of UTF-8, with a name up to 32 bytes. Without an entered name, the first line of the text becomes the name.
- Settings page on the phone: tabs 1–5, name field, text, byte counter with an overflow warning, "Appearance" block. "Save" sends only what changed: the selected text, the settings, or both. "Clear" and saving an empty text ask for confirmation. The tab of a text that is not on the phone shows the name from the watch and "Is on the watch, no copy on this phone"; saving a new text there asks for confirmation.
- Watch: a menu with text names; Select opens a text, Back returns to the menu. The menu remembers the selected item; only the open text is loaded into memory.
- In a text: Up/Down scroll by screen (screen height minus one line, in whole lines, the top line is always whole) or smoothly; holding repeats the step. Holding Select switches the size among the enabled ones (14, 18, 20, 24). A short Select closes the app and returns to the watchface; it is ignored for 700 ms after the text window appears. The progress indicator is a 3 px bar on the right, hidden if the text fits.
- Appearance settings: show time (StatusBarLayer), which sizes holding Select cycles through, menu title size, inverted colors, scrolling by screen or smoothly. They apply immediately in an open menu or text.
- Restore: the reading position is remembered for each text; a new text starts from the beginning. On launch, the text that was open at exit is opened on top of the menu; only Back in the menu leads to launching with the menu.
- Service messages on the watch are in English: "Paste text in settings on your phone", "Last transfer incomplete. Save again.", "Transfer incomplete" in the menu, "Text too long to show in full. Shorten it in settings.", "Text damaged. It will be sent again from the phone.".
- Copies of the texts are stored in the phone's localStorage; texts missing on the watch are sent again by the phone on its own.

## Architecture

### Watch (`src/c/`)

- `pebble-spool.c` – entry point: storage initialization, menu and restoring the open text, AppMessage.
- `menu_window.c` – text menu (DejaVu, because the system menu font has no Ukrainian letters), custom buttons to intercept Back.
- `text_window.c` – text window: fonts, scrolling, snapping to a line, indicator, marks, 700 ms Select guard, reading position.
- `settings.c` – appearance settings and text sizes.
- `storage.c` – texts, settings and positions in persistent storage, migrations.
- `transfer.c` – receiving texts and settings, status messages.

### Phone (`src/pkjs/`)

- `index.js` – PebbleKit JS events, transfer queue, retries and timeouts, copies in localStorage.
- `sync.js` – what to send and in which order, message building, state parsing, settings, localStorage migration, `newTextId`.
- `text.js` – text normalization, names, UTF-8 length, splitting into chunks.
- `config_page.js` – settings page (data URI) and parsing of its response.

The page opens as a data URI and returns the result to `pebblejs://close#` as url-safe base64 of the JSON `{slot, name?, text?, settings?}`; `text` and `settings` are present only if they changed.

### AppMessage protocol

Keys (`package.json`, `messageKeys`): `Hello`, `SlotId0`–`SlotId4`, `SlotName0`–`SlotName4`, `SlotSize0`–`SlotSize4`, `ShowTime`, `SizeMask`, `MenuSize`, `Invert`, `ScrollMode`, `TextSize`, `TransferId`, `Slot`, `Name`, `ChunkIndex`, `ChunkCount`, `TotalBytes`, `ChunkData`, `ResultId`, `ResultOk`.

- Phone → watch:
  - `Hello` – asks for the state. The phone sends it at launch and when it did not get a result in time.
  - Settings: `ShowTime`, `SizeMask` (bit `i` – size `SIZES[i]`), `MenuSize`, `Invert`, `ScrollMode`.
  - Text chunk: `TransferId`, `Slot`, `ChunkIndex`, `ChunkCount`, `TotalBytes`, `ChunkData`; the first chunk also has `Name`. A chunk is up to 1000 bytes, UTF-8 is not split. An empty text is one empty chunk, it clears the slot. The first chunk always restarts the transfer.
- Watch → phone:
  - State: for each slot `SlotId`, `SlotName`, `SlotSize`, and also `ShowTime`, `SizeMask`, `MenuSize`, `Invert`, `ScrollMode`, `TextSize`. Sent in response to `Hello`, after new settings and after a size change; skipped while a text is being received or the outbox is busy. A damaged text is reported with id 0.
  - Result: `ResultId`, `ResultOk` after the last chunk.
- Phone: one transfer at a time, settings always first. "Save" puts the slot at the front of the queue, an interrupted transfer is queued again. Each message gets up to 3 attempts with a 1 s pause. After the last chunk the phone waits 10 s for the result; if there is none – `Hello` and 10 s for the state, up to 3 attempts, then the text is marked as not delivered. Based on the state, the phone marks texts as delivered or queues those whose ids differ from its copies.
- Transfer id is a random positive 31-bit number (`sync.newTextId`), never 0: 0 means "nothing saved" and "damaged".
- Phone localStorage: `text<n>`, `name<n>`, `textId<n>`, `syncState<n>` (`pending`, `synced`, `failed`), `lastSlot`, `settings`, `settingsState`, `watchSettings`, `textSize`, `watchSlots`. Version 1.1 keys without a number (`text`, `textId`, `syncState`) migrate to slot 0. Broken JSON is read as missing data.

### Storage on the watch

Schema number – 3, key 1.

- Text `t` (0–4) has two sides `s` (1, 2). The side header (transfer id, size, chunk count, state, name) is under key `1000 * (2t + s)`, chunks of up to 255 bytes are under the following keys, UTF-8 is not split.
- The active side is key `10 + t`. A new version is written to the inactive side; writing the active side number is the switch, after it the old side is deleted. An interrupted transfer does not touch the saved version or other texts.
- Reading position – key `20 + t`: transfer id, offset and the content height it belongs to.
- `30` – text selected in the menu, `31` – text size in pixels, `32` – settings (a record of any length from 3 bytes, missing fields are 0, i.e. default), `33` – open text.
- A text is considered damaged if there are no chunks or their sizes do not add up to `total_bytes`; the check does not read the text itself.
- Migrations: schema 1 (one text; keys 3 and 4) – into text 0 with the first line as the name; schema ≤ 2 stored the font as an index under key 2 – it becomes pixels (18 → 18, 24 and 32 → 24, not stored → 24); a fresh install starts with 20. Old keys are deleted only after the new ones and the schema number are written; an interrupted migration completes on the next launch.

## Technical limits and verified facts

- Limits: text – 8000 bytes of UTF-8 after normalization, name – 32 bytes. Text layer height – up to 30 000 px (layer coordinates are 16-bit); a taller text is cut at a line boundary with a mark.
- One persist value – at most 256 bytes (`PERSIST_DATA_MAX_LENGTH`).
- Font – DejaVu Sans in `resources/`, four resources (14, 18, 20, 24) with `"extended": true` (without it the generator stops at 256 glyphs) and `characterRegex` `[ -~ -¬®-ÿЀ-џҐґ‐-‧‰-›€№−]`. `normalizeText` passes exactly these characters and replaces the rest with "?"; a test checks this. System fonts show ґ, є, і, ї as squares, so only the custom font is used for text. After changing fonts or `characterRegex` – `pebble clean`. The recommended maximum font size is 48.
- AppMessage: the inbox buffer is sized for a chunk (~1100 bytes), the largest outgoing message is the state, up to 349 bytes. `app_message_outbox_size_maximum()` and `app_message_inbox_size_maximum()` on emery in the emulator are 8200; not checked on the watch.
- Settings page as a data URI: the opening URL is up to ~77 KB with 5 full texts and long names, the return URL is up to ~11 KB. The page is English only.
- The build says `usesPermissions` is missing in `package.json`; that is correct: the app uses neither network nor geolocation.
- A clean build (`pebble clean`) changes the resource timestamp in the `.pbw`, so a `.pbw` from the same code differs byte for byte.
- The phone is a Samsung S26 with Android. The Pebble app on Android runs PebbleKit JS in a hidden WebView. Before version 1.3 the phone was an iPhone, where PebbleKit JS runs in JavaScriptCore without `fetch` and DOM; the phone code still does not use them. On iPhone only early versions were checked: at step 0 about 3000 Cyrillic characters arrived in full. Before changing the phone code, read the guide about PebbleKit JS in the Pebble mobile app (find it in https://developer.repebble.com/llms.txt).
- Verified on Samsung S26: the settings page as a data URI opens in the Pebble app, saving and editing texts work. Not verified on Android: a page with 5 full texts and the dark theme.
- The emulator does not check the page in the Pebble app: `pebble emu-app-config` opens it in the computer's browser.

## Platform and configuration

- The only target platform is `emery` (Pebble Time 2). `pebble.targetPlatforms` in `package.json` must contain only `emery`.
- This is an app, not a watchface: `pebble.watchapp.watchface` must be `false`.
- The app is configurable: `pebble.capabilities` must contain `configurable`.
- `pebble.displayName` – `Spool`: this is how the app is named on the watch, on the settings page and in the store. The top-level `name` field is `pebble-spool`, like the repository.
- Launcher icon – `resources/icon.png` (25×25, `"menuIcon": true`).

## Project structure

```
src/c/ - watch app code (C)
src/pkjs/ - phone code (PebbleKit JS)
resources/ - fonts and launcher icon
tests/ - phone code tests (Node.js)
package.json - metadata, platforms, AppMessage keys, resources
CHANGELOG.md - version history
screenshots/ - .pbw and store materials, not in the repository
```

## Commands

```bash
pebble build  # build
pebble clean  # clean the build
pebble install --emulator emery  # install into the Time 2 emulator
pebble emu-app-config --emulator emery  # open the app settings page in the browser
pebble screenshot --scale 6 --no-open screenshot.png
pebble emu-button click select  # press a button
pebble logs --emulator emery  # APP_LOG logs, until Ctrl-C
node --test tests/  # phone code tests
```

For help on any command add `--help`.

## Verification after every change

Do not stop at a successful build.

1. `pebble build` and `node --test tests/`
2. `pebble install --emulator emery --logs` – wait for the app to start, check the logs, stop with Ctrl-C.
3. `pebble emu-app-config --emulator emery` – paste a test text, save.
4. `pebble screenshot --scale 6 --no-open screenshot.png` – look at the screenshot.
5. Check scrolling: `pebble emu-button click down --repeat 5`, then another screenshot.
6. Check the font size: `pebble emu-button click select --duration 1000`, then a screenshot.
7. Check persistence: close the app (`pebble emu-button click back --duration 2000`), open it again – the text and font must stay.

Test texts:
- a short English line;
- Ukrainian text with "ґ є і ї" – the letters must render, not squares;
- a long Ukrainian text of several screens – checks UTF-8 splitting and scroll speed;
- a text longer than the allowed limit – a warning must appear in settings.

After verification, ask yourself whether the screenshot matches the task, and fix discrepancies.

Mark temporary edits that simulate failures or take measurements with `HACK` on every line and remove them after verification: `grep -c HACK` over the code must give 0, and `git status` must be clean.

## Emulator control

- `click` – press and release, `--duration` for a long press.
- `push` / `release` – hold / release.
- `--repeat N` and `--interval ms` – repeat presses.
- Buttons: `back`, `up`, `select`, `down`.

If the emulator behaves strangely (a screenshot of another app, installation hangs): `pebble kill`, then `pebble wipe`, then install again.

## Installing on the watch

Only when the user asks:

```bash
pebble install --cloudpebble
```

Do not keep `pebble logs` or `--logs` open on a real watch longer than needed: the log stream keeps Bluetooth active and drains the watch and the phone.

## Release

- The version is in `package.json` (`version`), together with a section in `CHANGELOG.md`.
- The tag `vX.Y.Z` (annotated, "Version X.Y.Z") is placed on the commit the `.pbw` was built from.
- The `.pbw` (`screenshots/spool-X.Y.Z.pbw`) and store materials (screenshots, description, release notes, icons, banner) are in `screenshots/`, which is in `.gitignore`.
- The user publishes manually through the Developer Dashboard (New Release). Only the user changes the app's visibility in the store.

## Git

- After every working step verified in the emulator, make a commit with a short description in English. Commit nothing if the build fails.
- Do not add signatures, trailers or mentions of AI assistants in commit messages, comments and project files.
- Author and committer are the GitHub no-reply address: `rootatoskr <129084982+rootatoskr@users.noreply.github.com>`.
- Push only on the user's command and never with force.

## Documentation

- Index of all pages: https://developer.repebble.com/llms.txt
- Every page has a Markdown version: replace the trailing `/` with `.md`. Read the `.md` version before using an API.
- Before using a function, check it in the reference, not from memory.

Useful sections:
- Persistent Storage: https://developer.repebble.com/guides/events-and-services/persistent-storage.md
- App Configuration (manual setup): https://developer.repebble.com/guides/user-interfaces/app-configuration-static.md
- Fonts: https://developer.repebble.com/guides/app-resources/fonts.md
- PebbleKit JS: https://developer.repebble.com/guides/communication/using-pebblekit-js.md
- AppMessage: https://developer.repebble.com/docs/c/Foundation/AppMessage.md
- Buttons: https://developer.repebble.com/guides/events-and-services/buttons.md
- UI layers: https://developer.repebble.com/guides/user-interfaces/layers.md
- App Metadata: https://developer.repebble.com/guides/tools-and-resources/app-metadata.md
