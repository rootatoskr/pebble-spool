#include "storage.h"

#define KEY_SCHEMA_VERSION 1
#define KEY_FONT_INDEX 2
#define KEY_ACTIVE_SLOT 3
#define KEY_POSITION 4

#define SCHEMA_VERSION 1
#define SLOT_NONE 0
#define SLOT_COUNT 2
// Slot ``n`` keeps its header under ``SLOT_KEY_BASE * n`` and its pieces under the keys after it.
#define SLOT_KEY_BASE 1000
// ``PERSIST_DATA_MAX_LENGTH`` is 256, one byte is left as a margin.
#define PIECE_MAX_BYTES 255

#define STATE_IN_PROGRESS 1
#define STATE_COMPLETE 2

typedef struct {
  uint32_t transfer_id;
  uint32_t total_bytes;
  uint16_t piece_count;
  uint8_t state;
} SlotHeader;

static int s_write_slot = SLOT_NONE;
static SlotHeader s_write_header;

static uint32_t prv_header_key(int slot) {
  return SLOT_KEY_BASE * slot;
}

static uint32_t prv_piece_key(int slot, int piece) {
  return SLOT_KEY_BASE * slot + 1 + piece;
}

static int prv_active_slot(void) {
  int slot = persist_read_int(KEY_ACTIVE_SLOT);
  return (slot >= 1 && slot <= SLOT_COUNT) ? slot : SLOT_NONE;
}

static int prv_inactive_slot(void) {
  return prv_active_slot() == 1 ? 2 : 1;
}

static bool prv_read_header(int slot, SlotHeader *header) {
  return persist_read_data(prv_header_key(slot), header, sizeof(*header)) == (int)sizeof(*header);
}

static bool prv_write_header(int slot, const SlotHeader *header) {
  return persist_write_data(prv_header_key(slot), header, sizeof(*header)) == (int)sizeof(*header);
}

static void prv_delete_slot(int slot) {
  persist_delete(prv_header_key(slot));
  // The piece count of an interrupted transfer is unknown, so delete until a gap.
  for (int piece = 0; persist_exists(prv_piece_key(slot, piece)); piece++) {
    persist_delete(prv_piece_key(slot, piece));
  }
}

void storage_init(void) {
  if (persist_read_int(KEY_SCHEMA_VERSION) != SCHEMA_VERSION) {
    persist_write_int(KEY_SCHEMA_VERSION, SCHEMA_VERSION);
  }
}

bool storage_begin(uint32_t transfer_id) {
  int slot = prv_inactive_slot();
  prv_delete_slot(slot);
  s_write_header = (SlotHeader) {
    .transfer_id = transfer_id,
    .state = STATE_IN_PROGRESS,
  };
  if (!prv_write_header(slot, &s_write_header)) {
    s_write_slot = SLOT_NONE;
    return false;
  }
  s_write_slot = slot;
  return true;
}

bool storage_append(const char *data, size_t length) {
  if (s_write_slot == SLOT_NONE) {
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
    uint32_t key = prv_piece_key(s_write_slot, s_write_header.piece_count);
    if (persist_write_data(key, data, piece_length) != (int)piece_length) {
      s_write_slot = SLOT_NONE;
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
  if (s_write_slot == SLOT_NONE) {
    return false;
  }
  int new_slot = s_write_slot;
  int old_slot = prv_active_slot();
  s_write_slot = SLOT_NONE;
  s_write_header.state = STATE_COMPLETE;
  if (!prv_write_header(new_slot, &s_write_header)) {
    return false;
  }
  // This single write is the switch: before it the old text is active, after it the new one.
  if (persist_write_int(KEY_ACTIVE_SLOT, new_slot) < 0) {
    return false;
  }
  if (old_slot != SLOT_NONE) {
    prv_delete_slot(old_slot);
  }
  return true;
}

char *storage_load_text(void) {
  int slot = prv_active_slot();
  SlotHeader header;
  if (slot == SLOT_NONE || !prv_read_header(slot, &header) || header.state != STATE_COMPLETE ||
      header.total_bytes == 0 || header.total_bytes > STORAGE_MAX_TEXT_BYTES) {
    return NULL;
  }
  char *text = malloc(header.total_bytes + 1);
  if (!text) {
    return NULL;
  }
  uint32_t length = 0;
  for (int piece = 0; piece < header.piece_count; piece++) {
    int read = persist_read_data(prv_piece_key(slot, piece), text + length, header.total_bytes - length);
    if (read <= 0) {
      break;
    }
    length += read;
  }
  if (length != header.total_bytes) {
    free(text);
    return NULL;
  }
  text[length] = '\0';
  return text;
}

uint32_t storage_active_transfer_id(void) {
  SlotHeader header;
  int slot = prv_active_slot();
  if (slot == SLOT_NONE || !prv_read_header(slot, &header) || header.state != STATE_COMPLETE) {
    return 0;
  }
  return header.transfer_id;
}

bool storage_has_incomplete_transfer(void) {
  SlotHeader header;
  return prv_read_header(prv_inactive_slot(), &header) && header.state == STATE_IN_PROGRESS;
}

int storage_read_font_index(int default_index) {
  return persist_exists(KEY_FONT_INDEX) ? persist_read_int(KEY_FONT_INDEX) : default_index;
}

void storage_write_font_index(int index) {
  persist_write_int(KEY_FONT_INDEX, index);
}

bool storage_read_position(StoragePosition *position) {
  return persist_read_data(KEY_POSITION, position, sizeof(*position)) == (int)sizeof(*position);
}

void storage_write_position(const StoragePosition *position) {
  persist_write_data(KEY_POSITION, position, sizeof(*position));
}
