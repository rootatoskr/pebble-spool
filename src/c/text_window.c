#include "text_window.h"

#include "storage.h"

#define TEXT_MARGIN 4
// Layer coordinates are 16-bit, so text taller than this is cut off.
#define MAX_TEXT_HEIGHT 30000
#define FONT_COUNT 3
#define DEFAULT_FONT_INDEX 1

static const uint32_t FONT_RESOURCES[FONT_COUNT] = {
  RESOURCE_ID_FONT_DEJAVU_18,
  RESOURCE_ID_FONT_DEJAVU_24,
  RESOURCE_ID_FONT_DEJAVU_32,
};
// Extra space below the last line so that descenders are not clipped.
static const int16_t FONT_BOTTOM_PADDING[FONT_COUNT] = {8, 10, 14};

static Window *s_window;
static ScrollLayer *s_scroll_layer;
static TextLayer *s_notice_layer;
static TextLayer *s_text_layer;
static GFont s_font;
static int s_font_index;
static char *s_text;
static bool s_show_notice;

static int16_t prv_text_height(const char *text, GFont font, int16_t width, GTextAlignment alignment) {
  int16_t height = graphics_text_layout_get_content_size(
      text, font, GRect(0, 0, width, MAX_TEXT_HEIGHT), GTextOverflowModeWordWrap, alignment).h;
  // The result can exceed the box by a part of a line. Margins and the notice are added
  // to it later, so keep it bounded to stay clear of the 16-bit limit.
  return height > MAX_TEXT_HEIGHT ? MAX_TEXT_HEIGHT : height;
}

static void prv_layout(void) {
  GRect frame = layer_get_frame(scroll_layer_get_layer(s_scroll_layer));
  int16_t width = frame.size.w - 2 * TEXT_MARGIN;
  int16_t y = 0;

  Layer *notice_layer = text_layer_get_layer(s_notice_layer);
  layer_set_hidden(notice_layer, !s_show_notice);
  if (s_show_notice) {
    GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
    int16_t height = prv_text_height(text_layer_get_text(s_notice_layer), font, width,
                                     GTextAlignmentCenter) + 8;
    layer_set_frame(notice_layer, GRect(0, 0, frame.size.w, height));
    y = height;
  }

  Layer *text_layer = text_layer_get_layer(s_text_layer);
  if (s_text) {
    int16_t height = prv_text_height(s_text, s_font, width, GTextAlignmentLeft) +
                     FONT_BOTTOM_PADDING[s_font_index];
    text_layer_set_font(s_text_layer, s_font);
    text_layer_set_text_alignment(s_text_layer, GTextAlignmentLeft);
    text_layer_set_text(s_text_layer, s_text);
    layer_set_frame(text_layer, GRect(TEXT_MARGIN, y + TEXT_MARGIN, width, height));
    scroll_layer_set_content_size(s_scroll_layer, GSize(frame.size.w, y + TEXT_MARGIN + height));
  } else {
    const char *placeholder = "Paste text in settings on your phone";
    GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
    int16_t height = prv_text_height(placeholder, font, width, GTextAlignmentCenter) + 8;
    text_layer_set_font(s_text_layer, font);
    text_layer_set_text_alignment(s_text_layer, GTextAlignmentCenter);
    text_layer_set_text(s_text_layer, placeholder);
    layer_set_frame(text_layer, GRect(TEXT_MARGIN, y + (frame.size.h - y - height) / 2, width, height));
    scroll_layer_set_content_size(s_scroll_layer, frame.size);
  }
}

static void prv_select_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  GRect frame = layer_get_frame(scroll_layer_get_layer(s_scroll_layer));
  int32_t old_offset = scroll_layer_get_content_offset(s_scroll_layer).y;
  int32_t old_height = scroll_layer_get_content_size(s_scroll_layer).h;

  GFont old_font = s_font;
  s_font_index = (s_font_index + 1) % FONT_COUNT;
  s_font = fonts_load_custom_font(resource_get_handle(FONT_RESOURCES[s_font_index]));
  storage_write_font_index(s_font_index);
  prv_layout();
  fonts_unload_custom_font(old_font);

  // Stay at the same relative position in the text, but never scroll past its end.
  int32_t new_height = scroll_layer_get_content_size(s_scroll_layer).h;
  int32_t new_offset = old_offset * new_height / old_height;
  int32_t min_offset = frame.size.h - new_height;
  if (new_offset < min_offset) {
    new_offset = min_offset;
  }
  if (new_offset > 0) {
    new_offset = 0;
  }
  scroll_layer_set_content_offset(s_scroll_layer, GPoint(0, new_offset), false);
}

static void prv_click_config_provider(void *context) {
  window_long_click_subscribe(BUTTON_ID_SELECT, 0, prv_select_long_click_handler, NULL);
}

static void prv_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_font_index = storage_read_font_index(DEFAULT_FONT_INDEX);
  if (s_font_index < 0 || s_font_index >= FONT_COUNT) {
    s_font_index = DEFAULT_FONT_INDEX;
  }
  s_font = fonts_load_custom_font(resource_get_handle(FONT_RESOURCES[s_font_index]));

  s_scroll_layer = scroll_layer_create(bounds);
  scroll_layer_set_shadow_hidden(s_scroll_layer, true);
  scroll_layer_set_callbacks(s_scroll_layer, (ScrollLayerCallbacks) {
    .click_config_provider = prv_click_config_provider,
  });
  scroll_layer_set_click_config_onto_window(s_scroll_layer, window);
  layer_add_child(window_layer, scroll_layer_get_layer(s_scroll_layer));

  s_notice_layer = text_layer_create(GRectZero);
  text_layer_set_font(s_notice_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_notice_layer, GTextAlignmentCenter);
  text_layer_set_background_color(s_notice_layer, GColorBlack);
  text_layer_set_text_color(s_notice_layer, GColorWhite);
  text_layer_set_text(s_notice_layer, "Last transfer incomplete. Save again.");
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_notice_layer));

  s_text_layer = text_layer_create(GRectZero);
  text_layer_set_overflow_mode(s_text_layer, GTextOverflowModeWordWrap);
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_text_layer));

  text_window_reload();
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_text_layer);
  text_layer_destroy(s_notice_layer);
  scroll_layer_destroy(s_scroll_layer);
  fonts_unload_custom_font(s_font);
}

void text_window_push(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, true);
}

void text_window_destroy(void) {
  window_destroy(s_window);
  free(s_text);
  s_text = NULL;
}

void text_window_reload(void) {
  // Free the old text first so that two copies never have to fit in the heap.
  text_layer_set_text(s_text_layer, "");
  free(s_text);
  s_text = storage_load_text();
  s_show_notice = storage_has_incomplete_transfer();
  prv_layout();
  scroll_layer_set_content_offset(s_scroll_layer, GPointZero, false);
}
