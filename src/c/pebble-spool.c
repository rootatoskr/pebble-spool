#include <pebble.h>

static Window *s_window;
static TextLayer *s_text_layer;

static char *s_text;
static uint32_t s_text_size;
static uint32_t s_text_len;
static char s_status[64];

static void prv_show(const char *text) {
  text_layer_set_text(s_text_layer, text);
}

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
    free(s_text);
    s_text_size = total + 1;
    s_text = malloc(s_text_size);
    s_text_len = 0;
    if (!s_text) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "malloc(%lu) failed", (unsigned long)s_text_size);
      prv_show("Out of memory");
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
    snprintf(s_status, sizeof(s_status), "%lu/%lu bytes, %ld chunks",
             (unsigned long)s_text_len, (unsigned long)total, (long)count);
    APP_LOG(APP_LOG_LEVEL_INFO, "Done: %s", s_status);
    prv_show(s_text);
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox dropped: %d", (int)reason);
}

static void prv_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  // Toggle between the received text and the byte count.
  if (!s_text) {
    return;
  }
  const char *current = text_layer_get_text(s_text_layer);
  prv_show(current == s_status ? s_text : s_status);
}

static void prv_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select_click_handler);
}

static void prv_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_text_layer = text_layer_create(bounds);
  text_layer_set_font(s_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_overflow_mode(s_text_layer, GTextOverflowModeWordWrap);
  prv_show("Paste text in settings on your phone");
  layer_add_child(window_layer, text_layer_get_layer(s_text_layer));
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_text_layer);
}

static void prv_init(void) {
  s_window = window_create();
  window_set_click_config_provider(s_window, prv_click_config_provider);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, true);

  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  uint32_t inbox = app_message_inbox_size_maximum();
  app_message_open(inbox, 64);
  APP_LOG(APP_LOG_LEVEL_INFO, "Inbox max: %lu", (unsigned long)inbox);
}

static void prv_deinit(void) {
  window_destroy(s_window);
  free(s_text);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
