# Changelog

Dates are those of the git tags.

## 1.5.2 – 2026-11-24

- A text taller than 30000 px (thousands of short lines) is cut at a line boundary, with
  "Text too long to show in full. Shorten it in settings." below it. The byte limit is
  unchanged.
- If the watch's result for a transfer does not come within 10 s, the phone sends Hello
  and, from the watch's state, marks the text delivered or sends it again. Without a
  state it tries up to 3 times, then marks the text as not delivered. The queue never
  stops.
- Broken data in localStorage no longer keeps the settings page from opening.
- A text damaged on the watch (missing pieces, sizes that do not add up) is reported
  with id 0, so the phone sends it again by itself; the text window says "Text damaged.
  It will be sent again from the phone." The phone never generates id 0.
- Scrolling by screens always keeps the first line whole: after a size change, after
  restoring the reading place and at the end of a text, where empty space may remain
  at the bottom.
- The phone neither saves nor sends a text over 8000 bytes after normalization.

## 1.5.1 – 2026-11-23

- The settings page is in English only.
- README links the appstore listing.

## 1.5 – 2026-11-23

- The app is called Spool.
- The settings page is in English, or in Ukrainian when the phone's language is
  Ukrainian (`navigator.language`). Dropped again in 1.5.1.
- The watch state carries the name and size of every text. A tab whose text is on the
  watch but not on this phone shows the name from the watch and "Is on the watch, no
  copy on this phone"; Clear removes the text from the watch, saving a new text there
  asks first.
- Launcher icon.

## 1.4 – 2026-11-18

- "Inverted colors" setting (off by default): white on black in the whole app – the
  menu with its selected row, the text, the time row, the placeholder and the broken
  transfer notice. The progress bar is light gray on black.
- "Scrolling" setting: by screen (default) or smooth – the ScrollLayer's own Up/Down
  with small steps, as in 1.0. Reading place, size changes, the progress bar and
  restoring work in both modes.
- Both apply at once in an open menu or text. The settings record is read from any
  length of at least 3 bytes; missing fields take their defaults.

## 1.3.2 – 2026-11-18

- A short Select press in a text is ignored for 700 ms after the text window appears
  (opened from the menu or restored at launch), so that a double press in the menu does
  not close the app.

## 1.3.1 – 2026-11-18

- A short Select press in a text closes the app and returns to the watchface
  (`exit_reason_set(APP_EXIT_ACTION_PERFORMED_SUCCESSFULLY)`). The next launch opens the
  same text at the same place. Holding Select still changes the size.

## 1.3 – 2026-11-18

- Text sizes 14, 18, 20 and 24 instead of 18, 24 and 32. The size is stored in pixels:
  18 stays 18, 24 and 32 become 24, a new installation starts with 20.
- Appearance settings on the watch: show the time, which sizes holding Select cycles
  through, the size of the names in the menu. The watch reports them and its text size
  to the phone at launch, after new settings and after a size change; while a text is
  being received that report is skipped.
- Settings page: an Appearance block. Save sends the settings and the selected text only
  if they changed.
- Without the time row the menu and the text use the whole screen; new settings apply
  at once.
- At launch the text that was open when the app was left opens on top of the menu. Only
  Back from the menu makes the next launch start with the menu.
- The phone is a Samsung S26 with Android from this version on; before, it was an iPhone.

## 1.2 – 2026-11-17

- Up to 5 texts of up to 8000 bytes, each with a name of up to 32 bytes of UTF-8.
  Without a typed name the first line of the text is the name.
- Storage: every text has two sides, a name, a transfer id and a reading place. Writing
  one text is atomic and does not touch the others. The text of 1.1 migrates to text 1;
  old keys are removed only after the new ones and the schema number are written.
- Protocol: a transfer carries the slot and the name. At launch the watch reports the
  ids of all 5 slots, and the phone sends, one by one, only those that differ.
- Settings page: tabs 1–5, a name field, Save sends only the selected text, Clear asks
  first.
- Watch: a menu of the names, Select opens a text, Back returns to the menu. The menu
  remembers the selected row; only the open text is loaded into memory.
- The time in a status bar at the top of the menu and while reading.

## 1.1 – 2026-11-16

- Tests for `src/pkjs/text.js` in `tests/`, run with `node --test tests/`.
- Empty lines are squeezed: spaces before a line break are removed, three or more line
  breaks become two.
- The fonts contain exactly the characters that `normalizeText` keeps; a test checks
  that `characterRegex` and `normalizeText` agree.
- Up/Down scroll by the screen height minus one line, in whole lines; holding repeats.
- The reading place is remembered on exit and restored at launch; a new text starts at
  the top.
- Progress bar: 3 px on the right edge, hidden when the text fits on the screen.

## 1.0 – 2026-11-16

- Own HTML settings page (Clay has no multi-line field) with a `<textarea>` and Save,
  built into the app as a data URI so that it works offline in the Pebble app.
- The text goes to the watch over AppMessage, in chunks with an acknowledgement each.
- The text is kept in the watch's persistent storage and opens without the phone.
- Watch screen: only the text in a ScrollLayer, scrolled with Up/Down.
- Holding Select switches the font size: small, medium, large. The choice is kept.
- Without a text: "Paste text in settings on your phone".
- The settings page counts bytes and warns when the text is over the limit.
- A copy of the text is kept in the phone's localStorage; if the watch reports no text
  at launch and the phone has a copy, it is sent again.
- Not in version 1: auto-scrolling, Timeline, App Glance, touch – later, only on a
  separate request.

### Before 1.0: step 0

A minimal check of the riskiest part, the connection: a settings page with a
`<textarea>` and Save, the transfer, and the text shown on the watch without any
formatting. Passed on the iPhone used then: about 3000 characters of Cyrillic arrived
whole.
