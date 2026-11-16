#include "text_window.h"

#include "storage.h"

#define TEXT_MARGIN 4
// Layer coordinates are 16-bit, so text taller than this is cut off.
#define MAX_TEXT_HEIGHT 30000
#define FONT_COUNT 3
#define DEFAULT_FONT_INDEX 1
#define SCROLL_REPEAT_INTERVAL_MS 300

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
// Height of one line of text in the current font.
static int16_t s_line_height;
// Where the first line of text starts in the scrolled content.
static int16_t s_text_top;
// Where the content is scrolled to, or is being animated to. Not positive.
static int32_t s_scroll_offset;

static int16_t prv_text_height(const char *text, GFont font, int16_t width, GTextAlignment alignment) {
  int16_t height = graphics_text_layout_get_content_size(
      text, font, GRect(0, 0, width, MAX_TEXT_HEIGHT), GTextOverflowModeWordWrap, alignment).h;
  // The result can exceed the box by a part of a line. Margins and the notice are added
  // to it later, so keep it bounded to stay clear of the 16-bit limit.
  return height > MAX_TEXT_HEIGHT ? MAX_TEXT_HEIGHT : height;
}

static int16_t prv_frame_height(void) {
  return layer_get_frame(scroll_layer_get_layer(s_scroll_layer)).size.h;
}

// Scrolls to ``offset``, limited to the range between the start and the end of the content.
static void prv_scroll_to(int32_t offset, bool animated) {
  int32_t min_offset = prv_frame_height() - scroll_layer_get_content_size(s_scroll_layer).h;
  if (offset < min_offset) {
    offset = min_offset;
  }
  if (offset > 0) {
    offset = 0;
  }
  s_scroll_offset = offset;
  scroll_layer_set_content_offset(s_scroll_layer, GPoint(0, offset), animated);
}

static void prv_layout(void) {
  GRect frame = layer_get_frame(scroll_layer_get_layer(s_scroll_layer));
  int16_t width = frame.size.w - 2 * TEXT_MARGIN;
  int16_t y = 0;

  s_line_height = prv_text_height("A\nA", s_font, width, GTextAlignmentLeft) -
                  prv_text_height("A", s_font, width, GTextAlignmentLeft);

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
    s_text_top = y + TEXT_MARGIN;
    layer_set_frame(text_layer, GRect(TEXT_MARGIN, s_text_top, width, height));
    scroll_layer_set_content_size(s_scroll_layer, GSize(frame.size.w, s_text_top + height));
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

// Offset at which line ``line`` is the first one on screen. Line 0 is the very top,
// including the margin and the notice above the text.
static int32_t prv_offset_of_line(int32_t line) {
  return line > 0 ? -(s_text_top + line * s_line_height) : 0;
}

// One press moves by the visible height minus one line, in whole lines, so that the
// last full line stays on screen as context and the first line on screen is never cut.
static void prv_scroll_by_page(ClickRecognizerRef recognizer, int direction) {
  int32_t page_lines = prv_frame_height() / s_line_height - 1;
  if (page_lines < 1) {
    page_lines = 1;
  }
  // The offset is not on a line boundary after the end of the text was reached or the
  // font was changed. Count from the boundary that makes the step shorter, not longer.
  int32_t into_text = -s_scroll_offset - s_text_top;
  int32_t line;
  if (into_text <= 0) {
    line = 0;
  } else if (direction > 0) {
    line = into_text / s_line_height;
  } else {
    line = (into_text + s_line_height - 1) / s_line_height;
  }
  line += direction * page_lines;
  // While a button is held the next step comes before an animation would finish.
  prv_scroll_to(prv_offset_of_line(line), !click_recognizer_is_repeating(recognizer));
}

static void prv_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  prv_scroll_by_page(recognizer, -1);
}

static void prv_down_click_handler(ClickRecognizerRef recognizer, void *context) {
  prv_scroll_by_page(recognizer, 1);
}

static void prv_select_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  int32_t old_offset = s_scroll_offset;
  int32_t old_height = scroll_layer_get_content_size(s_scroll_layer).h;

  GFont old_font = s_font;
  s_font_index = (s_font_index + 1) % FONT_COUNT;
  s_font = fonts_load_custom_font(resource_get_handle(FONT_RESOURCES[s_font_index]));
  storage_write_font_index(s_font_index);
  prv_layout();
  fonts_unload_custom_font(old_font);

  // Stay at the same relative position in the text.
  int32_t new_height = scroll_layer_get_content_size(s_scroll_layer).h;
  prv_scroll_to(old_offset * new_height / old_height, false);
}

// Called after the scroll layer has set up its own Up and Down handlers, which this replaces.
static void prv_click_config_provider(void *context) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, SCROLL_REPEAT_INTERVAL_MS,
                                          prv_up_click_handler);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, SCROLL_REPEAT_INTERVAL_MS,
                                          prv_down_click_handler);
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
  prv_scroll_to(0, false);
}
