#include <pebble.h>

#include "text_window.h"

static char *s_text;
static uint32_t s_text_size;
static uint32_t s_text_len;

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *index_t = dict_find(iter, MESSAGE_KEY_ChunkIndex);
  Tuple *count_t = dict_find(iter, MESSAGE_KEY_ChunkCount);
  Tuple *total_t = dict_find(iter, MESSAGE_KEY_TotalBytes);
  Tuple *data_t = dict_find(iter, MESSAGE_KEY_ChunkData);
  if (!index_t || !count_t || !total_t || !data_t) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "Incomplete message");
    return;
  }

  int32_t index = index_t->value->int32;
  int32_t count = count_t->value->int32;
  uint32_t total = (uint32_t)total_t->value->int32;

  if (index == 0) {
    s_text_size = total + 1;
    s_text = malloc(s_text_size);
    s_text_len = 0;
    if (!s_text) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "malloc(%lu) failed", (unsigned long)s_text_size);
      return;
    }
    s_text[0] = '\0';
  }
  if (!s_text) {
    return;
  }

  // ``length`` of a cstring tuple includes the trailing NUL.
  uint32_t chunk_len = data_t->length > 0 ? data_t->length - 1 : 0;
  if (s_text_len + chunk_len >= s_text_size) {
    chunk_len = s_text_size - 1 - s_text_len;
  }
  memcpy(s_text + s_text_len, data_t->value->cstring, chunk_len);
  s_text_len += chunk_len;
  s_text[s_text_len] = '\0';

  APP_LOG(APP_LOG_LEVEL_INFO, "Chunk %ld/%ld, %lu/%lu bytes",
          (long)(index + 1), (long)count, (unsigned long)s_text_len, (unsigned long)total);

  if (index == count - 1) {
    text_window_set_text(s_text);
    s_text = NULL;
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox dropped: %d", (int)reason);
}

static void prv_init(void) {
  text_window_push();

  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  uint32_t inbox = app_message_inbox_size_maximum();
  app_message_open(inbox, 64);
  APP_LOG(APP_LOG_LEVEL_INFO, "Inbox max: %lu", (unsigned long)inbox);
}

static void prv_deinit(void) {
  text_window_destroy();
  free(s_text);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
