#include "transfer.h"

#include "settings.h"
#include "storage.h"

// Keep in sync with ``CHUNK_MAX_BYTES`` in ``src/pkjs/text.js``.
#define CHUNK_MAX_BYTES 1000

static TransferTextChangedHandler s_text_changed_handler;
static TransferSettingsChangedHandler s_settings_changed_handler;

// The transfer that is being received. It lives in RAM only: after an app restart
// the phone starts again from the first chunk.
static bool s_receiving;
static uint32_t s_transfer_id;
static int s_text;
static int32_t s_next_index;
static uint32_t s_received_bytes;

static void prv_send_result(uint32_t transfer_id, bool ok) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_uint32(iter, MESSAGE_KEY_ResultId, transfer_id);
  dict_write_uint8(iter, MESSAGE_KEY_ResultOk, ok ? 1 : 0);
  app_message_outbox_send();
}

static uint32_t prv_stored_transfer_id(int text) {
  StorageTextInfo info;
  storage_get_info(text, &info);
  return info.transfer_id;
}

// The phone compares the ids with its own copies and sends again the texts that differ,
// and fills the settings page with the settings, the text size and the names and sizes
// of the texts it has no copy of.
void transfer_send_state(void) {
  const uint32_t id_keys[STORAGE_TEXT_COUNT] = {
    MESSAGE_KEY_SlotId0, MESSAGE_KEY_SlotId1, MESSAGE_KEY_SlotId2,
    MESSAGE_KEY_SlotId3, MESSAGE_KEY_SlotId4,
  };
  const uint32_t name_keys[STORAGE_TEXT_COUNT] = {
    MESSAGE_KEY_SlotName0, MESSAGE_KEY_SlotName1, MESSAGE_KEY_SlotName2,
    MESSAGE_KEY_SlotName3, MESSAGE_KEY_SlotName4,
  };
  const uint32_t size_keys[STORAGE_TEXT_COUNT] = {
    MESSAGE_KEY_SlotSize0, MESSAGE_KEY_SlotSize1, MESSAGE_KEY_SlotSize2,
    MESSAGE_KEY_SlotSize3, MESSAGE_KEY_SlotSize4,
  };
  DictionaryIterator *iter;
  if (s_receiving || app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  for (int text = 0; text < STORAGE_TEXT_COUNT; text++) {
    StorageTextInfo info;
    storage_get_info(text, &info);
    dict_write_uint32(iter, id_keys[text], info.transfer_id);
    dict_write_cstring(iter, name_keys[text], info.name);
    dict_write_uint16(iter, size_keys[text], info.total_bytes);
  }
  Settings settings;
  settings_load(&settings);
  dict_write_uint8(iter, MESSAGE_KEY_ShowTime, settings.show_time ? 1 : 0);
  dict_write_uint8(iter, MESSAGE_KEY_SizeMask, settings.size_mask);
  dict_write_uint8(iter, MESSAGE_KEY_MenuSize, settings.menu_size);
  dict_write_uint8(iter, MESSAGE_KEY_Invert, settings.invert ? 1 : 0);
  dict_write_uint8(iter, MESSAGE_KEY_ScrollMode, settings.smooth_scroll ? 1 : 0);
  dict_write_uint8(iter, MESSAGE_KEY_TextSize,
                   settings_nearest_enabled_size(settings.size_mask, settings_text_size()));
  app_message_outbox_send();
}

static void prv_handle_settings(DictionaryIterator *iter) {
  Tuple *show_time_t = dict_find(iter, MESSAGE_KEY_ShowTime);
  Tuple *size_mask_t = dict_find(iter, MESSAGE_KEY_SizeMask);
  Tuple *menu_size_t = dict_find(iter, MESSAGE_KEY_MenuSize);
  Tuple *invert_t = dict_find(iter, MESSAGE_KEY_Invert);
  Tuple *scroll_mode_t = dict_find(iter, MESSAGE_KEY_ScrollMode);
  if (!show_time_t || !size_mask_t || !menu_size_t) {
    return;
  }
  Settings settings = {
    .show_time = show_time_t->value->int32 != 0,
    .size_mask = size_mask_t->value->int32 & ((1 << SETTINGS_SIZE_COUNT) - 1),
    .menu_size = menu_size_t->value->int32,
    .invert = invert_t && invert_t->value->int32 != 0,
    .smooth_scroll = scroll_mode_t && scroll_mode_t->value->int32 != 0,
  };
  if (settings.size_mask == 0 || settings_size_index(settings.menu_size) < 0) {
    return;
  }
  settings_save(&settings);
  s_settings_changed_handler();
  transfer_send_state();
}

static void prv_fail(uint32_t transfer_id) {
  s_receiving = false;
  prv_send_result(transfer_id, false);
}

static void prv_handle_chunk(DictionaryIterator *iter, uint32_t transfer_id) {
  Tuple *slot_t = dict_find(iter, MESSAGE_KEY_Slot);
  Tuple *index_t = dict_find(iter, MESSAGE_KEY_ChunkIndex);
  Tuple *count_t = dict_find(iter, MESSAGE_KEY_ChunkCount);
  Tuple *total_t = dict_find(iter, MESSAGE_KEY_TotalBytes);
  Tuple *data_t = dict_find(iter, MESSAGE_KEY_ChunkData);
  if (!slot_t || !index_t || !count_t || !total_t || !data_t || data_t->type != TUPLE_CSTRING) {
    return;
  }
  int32_t text = slot_t->value->int32;
  int32_t index = index_t->value->int32;
  uint32_t total_bytes = total_t->value->uint32;
  if (text < 0 || text >= STORAGE_TEXT_COUNT) {
    prv_fail(transfer_id);
    return;
  }

  if (index == 0) {
    // The name comes with the first chunk.
    Tuple *name_t = dict_find(iter, MESSAGE_KEY_Name);
    const char *name = (name_t && name_t->type == TUPLE_CSTRING) ? name_t->value->cstring : "";
    // The first chunk always starts over, which also covers a repeated Save.
    if (total_bytes > STORAGE_MAX_TEXT_BYTES || !storage_begin(text, transfer_id, name)) {
      prv_fail(transfer_id);
      return;
    }
    s_receiving = true;
    s_transfer_id = transfer_id;
    s_text = text;
    s_next_index = 0;
    s_received_bytes = 0;
  } else if (!s_receiving || transfer_id != s_transfer_id) {
    // A repeated last chunk of a transfer that is already stored is not an error.
    if (transfer_id == prv_stored_transfer_id(text)) {
      prv_send_result(transfer_id, true);
    } else {
      prv_fail(transfer_id);
    }
    return;
  } else if (index == s_next_index - 1) {
    // The phone repeats a chunk when its acknowledgement was lost.
    return;
  }
  if (index != s_next_index) {
    prv_fail(transfer_id);
    return;
  }

  // ``length`` of a cstring tuple includes the trailing NUL.
  size_t length = data_t->length - 1;
  if (s_received_bytes + length > total_bytes || !storage_append(data_t->value->cstring, length)) {
    prv_fail(transfer_id);
    return;
  }
  s_received_bytes += length;
  s_next_index++;

  if (s_next_index == count_t->value->int32) {
    s_receiving = false;
    bool ok = s_received_bytes == total_bytes && storage_commit();
    prv_send_result(transfer_id, ok);
    if (ok) {
      s_text_changed_handler(s_text);
    }
  }
}

static void prv_inbox_received_handler(DictionaryIterator *iter, void *context) {
  Tuple *transfer_id_t = dict_find(iter, MESSAGE_KEY_TransferId);
  if (transfer_id_t) {
    prv_handle_chunk(iter, transfer_id_t->value->uint32);
  } else if (dict_find(iter, MESSAGE_KEY_Hello)) {
    transfer_send_state();
  } else if (dict_find(iter, MESSAGE_KEY_SizeMask)) {
    prv_handle_settings(iter);
  }
}

void transfer_init(TransferTextChangedHandler text_handler,
                   TransferSettingsChangedHandler settings_handler) {
  s_text_changed_handler = text_handler;
  s_settings_changed_handler = settings_handler;
  app_message_register_inbox_received(prv_inbox_received_handler);
  // The inbox fits one chunk message: five integers, the name and the chunk itself.
  // The largest reply is the state: for every text its id, name and size, and six small
  // numbers.
  app_message_open(dict_calc_buffer_size(7, 4, 4, 4, 4, 4, STORAGE_NAME_MAX_BYTES + 1,
                                         CHUNK_MAX_BYTES + 1),
                   dict_calc_buffer_size(3 * STORAGE_TEXT_COUNT + 6, 4, 4, 4, 4, 4,
                                         STORAGE_NAME_MAX_BYTES + 1, STORAGE_NAME_MAX_BYTES + 1,
                                         STORAGE_NAME_MAX_BYTES + 1, STORAGE_NAME_MAX_BYTES + 1,
                                         STORAGE_NAME_MAX_BYTES + 1, 2, 2, 2, 2, 2,
                                         1, 1, 1, 1, 1, 1));
}
