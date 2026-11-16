#pragma once

#include <pebble.h>

// Keep in sync with ``MAX_TEXT_BYTES`` in ``src/pkjs/text.js``.
#define STORAGE_MAX_TEXT_BYTES 8000

// The text lives in one of two slots. A new text is written to the inactive slot and
// becomes active only after it has arrived completely, so a broken transfer never
// damages the text that is already on the watch.

void storage_init(void);

// Starts writing a new text to the inactive slot and marks it as in progress.
bool storage_begin(uint32_t transfer_id);
// Appends UTF-8 data to the slot opened by ``storage_begin``.
bool storage_append(const char *data, size_t length);
// Makes the new text the active one and removes the previous text.
bool storage_commit(void);

// Returns the active text in a ``malloc``-ed buffer, or NULL if there is none.
char *storage_load_text(void);
// Transfer id of the active text, 0 if no text was ever stored.
uint32_t storage_active_transfer_id(void);
// True if a transfer was started and never finished.
bool storage_has_incomplete_transfer(void);

int storage_read_font_index(int default_index);
void storage_write_font_index(int index);
