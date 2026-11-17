#include "storage.h"

#define KEY_SCHEMA_VERSION 1
// Schema 2 and earlier kept the font as an index: 0 for 18 px, 1 for 24 px, 2 for 32 px.
#define KEY_V2_FONT_INDEX 2
// Schema 1 had a single text: its active side and its reading position.
#define KEY_V1_ACTIVE_SIDE 3
#define KEY_V1_POSITION 4
// One key per text, the text index is added to the base.
#define KEY_ACTIVE_SIDE_BASE 10
#define KEY_POSITION_BASE 20
#define KEY_MENU_TEXT 30
#define KEY_TEXT_SIZE 31

#define SCHEMA_VERSION 3
#define SIDE_NONE 0
// Side ``s`` (1 or 2) of text ``t`` keeps its header under ``SIDE_KEY_STEP * (2 * t + s)``
// and its pieces under the keys after it. For text 0 these are the keys of schema 1.
#define SIDE_KEY_STEP 1000
// ``PERSIST_DATA_MAX_LENGTH`` is 256, one byte is left as a margin.
#define PIECE_MAX_BYTES 255

#define STATE_IN_PROGRESS 1
#define STATE_COMPLETE 2

typedef struct {
  uint32_t transfer_id;
  uint32_t total_bytes;
  uint16_t piece_count;
  uint8_t state;
  char name[STORAGE_NAME_MAX_BYTES + 1];
} SideHeader;

// The header of schema 1: the same fields without the name.
typedef struct {
  uint32_t transfer_id;
  uint32_t total_bytes;
  uint16_t piece_count;
  uint8_t state;
} V1Header;

static int s_write_text;
static int s_write_side = SIDE_NONE;
static SideHeader s_write_header;

static uint32_t prv_header_key(int text, int side) {
  return SIDE_KEY_STEP * (2 * text + side);
}

static uint32_t prv_piece_key(int text, int side, int piece) {
  return prv_header_key(text, side) + 1 + piece;
}

static int prv_active_side(int text) {
  int side = persist_read_int(KEY_ACTIVE_SIDE_BASE + text);
  return (side == 1 || side == 2) ? side : SIDE_NONE;
}

static int prv_inactive_side(int text) {
  return prv_active_side(text) == 1 ? 2 : 1;
}

static bool prv_read_header(int text, int side, SideHeader *header) {
  return side != SIDE_NONE &&
         persist_read_data(prv_header_key(text, side), header, sizeof(*header)) == (int)sizeof(*header);
}

static bool prv_write_header(int text, int side, const SideHeader *header) {
  return persist_write_data(prv_header_key(text, side), header, sizeof(*header)) == (int)sizeof(*header);
}

static void prv_delete_side(int text, int side) {
  persist_delete(prv_header_key(text, side));
  // The piece count of an interrupted transfer is unknown, so delete until a gap.
  for (int piece = 0; persist_exists(prv_piece_key(text, side, piece)); piece++) {
    persist_delete(prv_piece_key(text, side, piece));
  }
}

// Copies at most ``STORAGE_NAME_MAX_BYTES`` of the first non-empty line of ``source``
// without cutting a UTF-8 sequence.
static void prv_copy_name(char *name, const char *source, size_t source_length) {
  while (source_length > 0 && (*source == ' ' || *source == '\n')) {
    source++;
    source_length--;
  }
  size_t length = 0;
  while (length < source_length && source[length] != '\0' && source[length] != '\n') {
    length++;
  }
  if (length > STORAGE_NAME_MAX_BYTES) {
    length = STORAGE_NAME_MAX_BYTES;
    while (length > 0 && ((uint8_t)source[length] & 0xC0) == 0x80) {
      length--;
    }
  }
  memcpy(name, source, length);
  name[length] = '\0';
}

// Schema 1 kept one text under the keys that text 0 uses now, so the pieces stay where
// they are. Every step leaves the data readable by the step that follows it, and the old
// keys are removed only after the new ones and the schema number are written: an
// interrupted migration is finished on the next launch without losing the text.
static void prv_migrate_from_v1(void) {
  int side = persist_read_int(KEY_V1_ACTIVE_SIDE);
  V1Header old_header;
  if ((side == 1 || side == 2) &&
      persist_get_size(prv_header_key(0, side)) == (int)sizeof(old_header) &&
      persist_read_data(prv_header_key(0, side), &old_header, sizeof(old_header)) ==
          (int)sizeof(old_header)) {
    SideHeader header = {
      .transfer_id = old_header.transfer_id,
      .total_bytes = old_header.total_bytes,
      .piece_count = old_header.piece_count,
      .state = old_header.state,
    };
    // The text gets its first line as the name.
    char first_piece[PIECE_MAX_BYTES];
    int read = persist_read_data(prv_piece_key(0, side, 0), first_piece, sizeof(first_piece));
    if (read > 0) {
      prv_copy_name(header.name, first_piece, read);
    }
    prv_write_header(0, side, &header);
  }
  if (side == 1 || side == 2) {
    persist_write_int(KEY_ACTIVE_SIDE_BASE, side);
  }
  StoragePosition position;
  if (persist_read_data(KEY_V1_POSITION, &position, sizeof(position)) == (int)sizeof(position)) {
    persist_write_data(KEY_POSITION_BASE, &position, sizeof(position));
  }
}

// Removes what schema 1 left behind. Runs again if it was interrupted.
static void prv_clean_up_v1(void) {
  int side = persist_read_int(KEY_V1_ACTIVE_SIDE);
  if (side == 1 || side == 2) {
    // The other side may hold an unfinished transfer in the old header format.
    prv_delete_side(0, side == 1 ? 2 : 1);
  }
  persist_delete(KEY_V1_ACTIVE_SIDE);
  persist_delete(KEY_V1_POSITION);
}

// The font is stored as its size in pixels now. 32 px is gone and becomes 24 px.
// Older versions did not store a font that was never changed: that was 24 px, so it
// stays 24 px, and only a new installation starts with the new default.
// Runs again without harm if it was interrupted.
static void prv_migrate_font_index(void) {
  static const int SIZES[] = {18, 24, 24};
  int index = persist_exists(KEY_V2_FONT_INDEX) ? persist_read_int(KEY_V2_FONT_INDEX) : 1;
  if (index < 0 || index >= (int)ARRAY_LENGTH(SIZES)) {
    index = 1;
  }
  persist_write_int(KEY_TEXT_SIZE, SIZES[index]);
}

// Each migration writes the new keys first, then the schema number, and removes the
// old keys only after that: an interrupted migration is finished on the next launch.
void storage_init(void) {
  int schema = persist_read_int(KEY_SCHEMA_VERSION);
  if (schema != SCHEMA_VERSION) {
    if (schema < 2 && persist_exists(KEY_V1_ACTIVE_SIDE)) {
      prv_migrate_from_v1();
    }
    // Schema 1 and 2 are installations of an older version, 0 is a new one.
    if (schema >= 1 && schema < 3) {
      prv_migrate_font_index();
    }
    persist_write_int(KEY_SCHEMA_VERSION, SCHEMA_VERSION);
  }
  if (persist_exists(KEY_V1_ACTIVE_SIDE) || persist_exists(KEY_V1_POSITION)) {
    prv_clean_up_v1();
  }
  if (persist_exists(KEY_V2_FONT_INDEX)) {
    persist_delete(KEY_V2_FONT_INDEX);
  }
}

bool storage_begin(int text, uint32_t transfer_id, const char *name) {
  int side = prv_inactive_side(text);
  prv_delete_side(text, side);
  s_write_header = (SideHeader) {
    .transfer_id = transfer_id,
    .state = STATE_IN_PROGRESS,
  };
  prv_copy_name(s_write_header.name, name, strlen(name));
  if (!prv_write_header(text, side, &s_write_header)) {
    s_write_side = SIDE_NONE;
    return false;
  }
  s_write_text = text;
  s_write_side = side;
  return true;
}

bool storage_append(const char *data, size_t length) {
  if (s_write_side == SIDE_NONE) {
    return false;
  }
  while (length > 0) {
    size_t piece_length = length;
    if (piece_length > PIECE_MAX_BYTES) {
      piece_length = PIECE_MAX_BYTES;
      // Do not end a piece in the middle of a UTF-8 sequence.
      while (piece_length > 0 && ((uint8_t)data[piece_length] & 0xC0) == 0x80) {
        piece_length--;
      }
    }
    uint32_t key = prv_piece_key(s_write_text, s_write_side, s_write_header.piece_count);
    if (persist_write_data(key, data, piece_length) != (int)piece_length) {
      s_write_side = SIDE_NONE;
      return false;
    }
    s_write_header.piece_count++;
    s_write_header.total_bytes += piece_length;
    data += piece_length;
    length -= piece_length;
  }
  return true;
}

bool storage_commit(void) {
  if (s_write_side == SIDE_NONE) {
    return false;
  }
  int new_side = s_write_side;
  int old_side = prv_active_side(s_write_text);
  s_write_side = SIDE_NONE;
  s_write_header.state = STATE_COMPLETE;
  if (!prv_write_header(s_write_text, new_side, &s_write_header)) {
    return false;
  }
  // This single write is the switch: before it the old version is active, after it the new one.
  if (persist_write_int(KEY_ACTIVE_SIDE_BASE + s_write_text, new_side) < 0) {
    return false;
  }
  if (old_side != SIDE_NONE) {
    prv_delete_side(s_write_text, old_side);
  }
  return true;
}

void storage_get_info(int text, StorageTextInfo *info) {
  *info = (StorageTextInfo) {0};
  SideHeader header;
  bool has_active = prv_read_header(text, prv_active_side(text), &header) &&
                    header.state == STATE_COMPLETE;
  if (has_active) {
    info->transfer_id = header.transfer_id;
    info->total_bytes = header.total_bytes;
    memcpy(info->name, header.name, sizeof(info->name));
  }
  if (prv_read_header(text, prv_inactive_side(text), &header) &&
      header.state == STATE_IN_PROGRESS) {
    info->incomplete = true;
    // Without a stored text, emptied or never sent, the unfinished one gives the name.
    if (info->total_bytes == 0) {
      memcpy(info->name, header.name, sizeof(info->name));
    }
  }
  info->name[STORAGE_NAME_MAX_BYTES] = '\0';
}

char *storage_load_text(int text) {
  int side = prv_active_side(text);
  SideHeader header;
  if (!prv_read_header(text, side, &header) || header.state != STATE_COMPLETE ||
      header.total_bytes == 0 || header.total_bytes > STORAGE_MAX_TEXT_BYTES) {
    return NULL;
  }
  char *buffer = malloc(header.total_bytes + 1);
  if (!buffer) {
    return NULL;
  }
  uint32_t length = 0;
  for (int piece = 0; piece < header.piece_count; piece++) {
    int read = persist_read_data(prv_piece_key(text, side, piece), buffer + length,
                                 header.total_bytes - length);
    if (read <= 0) {
      break;
    }
    length += read;
  }
  if (length != header.total_bytes) {
    free(buffer);
    return NULL;
  }
  buffer[length] = '\0';
  return buffer;
}

int storage_read_text_size(int default_size) {
  return persist_exists(KEY_TEXT_SIZE) ? persist_read_int(KEY_TEXT_SIZE) : default_size;
}

void storage_write_text_size(int size) {
  persist_write_int(KEY_TEXT_SIZE, size);
}

bool storage_read_position(int text, StoragePosition *position) {
  return persist_read_data(KEY_POSITION_BASE + text, position, sizeof(*position)) ==
         (int)sizeof(*position);
}

void storage_write_position(int text, const StoragePosition *position) {
  persist_write_data(KEY_POSITION_BASE + text, position, sizeof(*position));
}

int storage_read_menu_text(int default_text) {
  int text = persist_exists(KEY_MENU_TEXT) ? persist_read_int(KEY_MENU_TEXT) : default_text;
  return (text >= 0 && text < STORAGE_TEXT_COUNT) ? text : default_text;
}

void storage_write_menu_text(int text) {
  persist_write_int(KEY_MENU_TEXT, text);
}
