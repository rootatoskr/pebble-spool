# pebble-spool

Spool, a watchapp for Pebble Time 2 (emery) that shows texts pasted on the phone.
Written in C with the Pebble SDK; the phone side is PebbleKit JS.

## How it works

1. The settings page on the phone has five tabs, each with a name and a text field, and
   an Appearance block. Save sends what changed: the selected text, the appearance
   settings or both. Clear removes the selected text.
   The page is in Ukrainian when the phone's language is Ukrainian, otherwise in English.
   A text that is on the watch but not on this phone (after reinstalling the phone app,
   for example) shows its name from the watch; Clear works for it, and saving a new text
   there asks first.
2. The watch stores the texts in persistent storage and shows them without the phone
   nearby. The app starts with a menu of the stored texts, or with the text that was
   open when the app was left; only Back from the menu makes the next launch start
   with the menu.
3. In a text, Up and Down scroll by screens and holding Select switches the text size
   among the enabled ones (14, 18, 20, 24). A short Select press closes the app and
   goes to the watchface; the next launch opens the same text. It is ignored for 700 ms
   after the text appears, so a double press in the menu does not close the app. The place where reading
   stopped is remembered for every text.
4. The appearance settings: whether the current time is shown at the top, which text
   sizes holding Select cycles through, the size of the names in the menu, inverted
   colors (white on black), and scrolling by screens or smoothly in small steps.

Each text is limited to 8000 bytes of UTF-8 and its name to 32 bytes; without a name
the first line of the text is used. Characters that the watch font does not have
(emoji, for example) are replaced with "?".

## Building and running

```sh
pebble build
pebble install --emulator emery
pebble emu-app-config --emulator emery
```

After changing fonts or `characterRegex` in `package.json` run `pebble clean` first:
font resources are not rebuilt otherwise.

## Tests

The phone side has tests that need only Node.js:

```sh
node --test tests/
```

## Project layout

- `src/c/pebble-spool.c` - entry point
- `src/c/menu_window.c` - the menu of stored texts
- `src/c/settings.c` - the appearance settings and the text sizes
- `src/c/text_window.c` - a text: scrolling, font sizes, progress, notices
- `src/c/storage.c` - texts and settings in persistent storage, migration
- `src/c/transfer.c` - receiving texts over AppMessage
- `src/pkjs/index.js` - sending texts, the copies in localStorage
- `src/pkjs/sync.js` - which texts to send and in what order, message building
- `src/pkjs/text.js` - text normalization, names, splitting into chunks
- `src/pkjs/config_page.js` - the settings page
- `resources/` - DejaVu Sans and its license
- `tests/` - tests for the phone side

## Notes

- The font resources use `"extended": true`. Without it the SDK font generator
  stops at 256 glyphs and most Cyrillic letters are missing.
- The build prints a notice that `package.json` declares no `usesPermissions`.
  That is intended: the app uses neither the network nor location.
