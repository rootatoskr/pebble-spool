#include "text_window.h"

#define TEXT_MARGIN 4
// Layer coordinates are 16-bit, so text taller than this is cut off.
#define MAX_TEXT_HEIGHT 30000

static const uint32_t FONT_RESOURCES[] = {
  RESOURCE_ID_FONT_DEJAVU_18,
  RESOURCE_ID_FONT_DEJAVU_24,
  RESOURCE_ID_FONT_DEJAVU_32,
};
// Extra space below the last line so that descenders are not clipped.
static const int16_t FONT_BOTTOM_PADDING[] = {8, 10, 14};

static Window *s_window;
static ScrollLayer *s_scroll_layer;
static TextLayer *s_text_layer;
static GFont s_font;
static int s_font_index;
static char *s_text;

static void prv_layout(void) {
  GRect frame = layer_get_frame(scroll_layer_get_layer(s_scroll_layer));
  int16_t width = frame.size.w - 2 * TEXT_MARGIN;
  GRect box = GRect(0, 0, width, MAX_TEXT_HEIGHT);

  if (s_text) {
    GSize size = graphics_text_layout_get_content_size(
        s_text, s_font, box, GTextOverflowModeWordWrap, GTextAlignmentLeft);
    int16_t height = size.h + FONT_BOTTOM_PADDING[s_font_index];
    text_layer_set_font(s_text_layer, s_font);
    text_layer_set_text_alignment(s_text_layer, GTextAlignmentLeft);
    text_layer_set_text(s_text_layer, s_text);
    layer_set_frame(text_layer_get_layer(s_text_layer),
                    GRect(TEXT_MARGIN, TEXT_MARGIN, width, height));
    scroll_layer_set_content_size(s_scroll_layer, GSize(frame.size.w, TEXT_MARGIN + height));
  } else {
    const char *placeholder = "Paste text in settings on your phone";
    GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
    GSize size = graphics_text_layout_get_content_size(
        placeholder, font, box, GTextOverflowModeWordWrap, GTextAlignmentCenter);
    int16_t height = size.h + 8;
    text_layer_set_font(s_text_layer, font);
    text_layer_set_text_alignment(s_text_layer, GTextAlignmentCenter);
    text_layer_set_text(s_text_layer, placeholder);
    layer_set_frame(text_layer_get_layer(s_text_layer),
                    GRect(TEXT_MARGIN, (frame.size.h - height) / 2, width, height));
    scroll_layer_set_content_size(s_scroll_layer, frame.size);
  }
}

static void prv_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_font = fonts_load_custom_font(resource_get_handle(FONT_RESOURCES[s_font_index]));

  s_scroll_layer = scroll_layer_create(bounds);
  scroll_layer_set_shadow_hidden(s_scroll_layer, true);
  scroll_layer_set_click_config_onto_window(s_scroll_layer, window);
  layer_add_child(window_layer, scroll_layer_get_layer(s_scroll_layer));

  s_text_layer = text_layer_create(bounds);
  text_layer_set_overflow_mode(s_text_layer, GTextOverflowModeWordWrap);
  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_text_layer));

  prv_layout();
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_text_layer);
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

void text_window_set_text(char *text) {
  char *old_text = s_text;
  s_text = text;
  prv_layout();
  scroll_layer_set_content_offset(s_scroll_layer, GPointZero, false);
  free(old_text);
}
