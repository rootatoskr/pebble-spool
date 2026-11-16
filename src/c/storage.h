#pragma once

#include <pebble.h>

// Keep in sync with ``MAX_TEXT_BYTES`` in ``src/pkjs/text.js``.
#define STORAGE_MAX_TEXT_BYTES 8000
#define STORAGE_TEXT_COUNT 5
#define STORAGE_NAME_MAX_BYTES 32

// Each text has two sides. A new version is written to the inactive side and becomes
// active only after it has arrived completely, so a broken transfer never damages
// the version that is already on the watch, and never touches the other texts.

typedef struct {
  // Id of the stored version, 0 if nothing was ever stored for this text.
  uint32_t transfer_id;
  // Size of the stored version. An emptied text keeps its id and has 0 bytes.
  uint32_t total_bytes;
  // True if a transfer of a new version was started and never finished.
  bool incomplete;
  // Name of the stored version or, if there is none, of the unfinished one.
  char name[STORAGE_NAME_MAX_BYTES + 1];
} StorageTextInfo;

// Brings data written by an older version of the app to the current layout.
void storage_init(void);

// Starts writing a new version of ``text`` and marks it as in progress.
bool storage_begin(int text, uint32_t transfer_id, const char *name);
// Appends UTF-8 data to the version opened by ``storage_begin``.
bool storage_append(const char *data, size_t length);
// Makes the new version the active one and removes the previous one.
bool storage_commit(void);

void storage_get_info(int text, StorageTextInfo *info);
// Returns the text in a ``malloc``-ed buffer, or NULL if it is empty.
char *storage_load_text(int text);

int storage_read_font_index(int default_index);
void storage_write_font_index(int index);

// Where the user stopped reading. The offset is kept together with the content height
// it belongs to, so that it can be scaled when the font size is different on return.
typedef struct {
  uint32_t transfer_id;
  int32_t offset;
  int32_t content_height;
} StoragePosition;

bool storage_read_position(int text, StoragePosition *position);
void storage_write_position(int text, const StoragePosition *position);
