#include <pebble.h>

#include "storage.h"
#include "text_window.h"

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *index_t = dict_find(iter, MESSAGE_KEY_ChunkIndex);
  Tuple *count_t = dict_find(iter, MESSAGE_KEY_ChunkCount);
  Tuple *data_t = dict_find(iter, MESSAGE_KEY_ChunkData);
  if (!index_t || !count_t || !data_t) {
    return;
  }
  int32_t index = index_t->value->int32;
  int32_t count = count_t->value->int32;

  if (index == 0 && !storage_begin(1)) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "storage_begin failed");
    return;
  }
  // ``length`` of a cstring tuple includes the trailing NUL.
  if (!storage_append(data_t->value->cstring, data_t->length - 1)) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "storage_append failed");
    return;
  }
  if (index == count - 1) {
    bool ok = storage_commit();
    APP_LOG(APP_LOG_LEVEL_INFO, "commit %d", ok);
    text_window_reload();
  }
}

static void prv_init(void) {
  storage_init();
  text_window_push();

  app_message_register_inbox_received(prv_inbox_received);
  app_message_open(app_message_inbox_size_maximum(), 64);
  APP_LOG(APP_LOG_LEVEL_INFO, "Started, heap free %lu", (unsigned long)heap_bytes_free());
}

static void prv_deinit(void) {
  text_window_destroy();
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
