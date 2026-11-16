# pebble-spool

A watchapp for Pebble Time 2 (emery) that shows a text pasted on the phone.
Written in C with the Pebble SDK; the phone side is PebbleKit JS.

## How it works

1. The settings page on the phone has a text field. Save sends the text to the watch.
2. The watch stores the text in persistent storage and shows it without the phone nearby.
3. Up and Down scroll, holding Select switches the font size (18, 24, 32).

The text is limited to 8000 bytes of UTF-8. Characters that the watch font does not
have (emoji, for example) are replaced with "?".

## Building and running

```sh
pebble build
pebble install --emulator emery
pebble emu-app-config --emulator emery
```

After changing fonts or `characterRegex` in `package.json` run `pebble clean` first:
font resources are not rebuilt otherwise.

## Project layout

- `src/c/pebble-spool.c` - entry point
- `src/c/text_window.c` - the screen: scrolling text, font sizes, notices
- `src/c/storage.c` - text and settings in persistent storage
- `src/c/transfer.c` - receiving the text over AppMessage
- `src/pkjs/index.js` - sending the text, the copy in localStorage
- `src/pkjs/text.js` - text normalization and splitting into chunks
- `src/pkjs/config_page.js` - the settings page
- `resources/` - DejaVu Sans and its license

## Notes

- The font resources use `"extended": true`. Without it the SDK font generator
  stops at 256 glyphs and most Cyrillic letters are missing.
- The build prints a notice that `package.json` declares no `usesPermissions`.
  That is intended: the app uses neither the network nor location.
