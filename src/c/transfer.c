#include "transfer.h"

#include "storage.h"

// Keep in sync with ``CHUNK_MAX_BYTES`` in ``src/pkjs/text.js``.
#define CHUNK_MAX_BYTES 1000

static TransferTextChangedHandler s_text_changed_handler;

// The transfer that is being received. It lives in RAM only: after an app restart
// the phone starts again from the first chunk.
static bool s_receiving;
static uint32_t s_transfer_id;
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

// The phone compares this id with its own copy and sends the text again if they differ.
static void prv_send_active_id(void) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_uint32(iter, MESSAGE_KEY_ActiveId, storage_active_transfer_id());
  app_message_outbox_send();
}

static void prv_fail(uint32_t transfer_id) {
  s_receiving = false;
  prv_send_result(transfer_id, false);
}

static void prv_handle_chunk(DictionaryIterator *iter, uint32_t transfer_id) {
  Tuple *index_t = dict_find(iter, MESSAGE_KEY_ChunkIndex);
  Tuple *count_t = dict_find(iter, MESSAGE_KEY_ChunkCount);
  Tuple *total_t = dict_find(iter, MESSAGE_KEY_TotalBytes);
  Tuple *data_t = dict_find(iter, MESSAGE_KEY_ChunkData);
  if (!index_t || !count_t || !total_t || !data_t || data_t->type != TUPLE_CSTRING) {
    return;
  }
  int32_t index = index_t->value->int32;
  uint32_t total_bytes = total_t->value->uint32;

  if (index == 0) {
    // The first chunk always starts over, which also covers a repeated Save.
    if (total_bytes > STORAGE_MAX_TEXT_BYTES || !storage_begin(transfer_id)) {
      prv_fail(transfer_id);
      return;
    }
    s_receiving = true;
    s_transfer_id = transfer_id;
    s_next_index = 0;
    s_received_bytes = 0;
  } else if (!s_receiving || transfer_id != s_transfer_id) {
    // A repeated last chunk of a transfer that is already stored is not an error.
    if (transfer_id == storage_active_transfer_id()) {
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
      s_text_changed_handler();
    }
  }
}

static void prv_inbox_received_handler(DictionaryIterator *iter, void *context) {
  Tuple *transfer_id_t = dict_find(iter, MESSAGE_KEY_TransferId);
  if (transfer_id_t) {
    prv_handle_chunk(iter, transfer_id_t->value->uint32);
  } else if (dict_find(iter, MESSAGE_KEY_Hello)) {
    prv_send_active_id();
  }
}

void transfer_init(TransferTextChangedHandler handler) {
  s_text_changed_handler = handler;
  app_message_register_inbox_received(prv_inbox_received_handler);
  // Sized for one chunk message; replies carry at most two integers.
  app_message_open(dict_calc_buffer_size(5, 4, 4, 4, 4, CHUNK_MAX_BYTES + 1),
                   dict_calc_buffer_size(2, 4, 4));
}
