#include "text_window.h"

#include "storage.h"

#define TEXT_MARGIN 4
// The progress indicator is a bar on the right edge with a gap between it and the text.
#define INDICATOR_WIDTH 3
#define INDICATOR_GAP 3
#define INDICATOR_MIN_HEIGHT 12
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
static Layer *s_indicator_layer;
static GFont s_font;
static int s_font_index;
// Which of the stored texts is shown.
static int s_text_index;
static uint32_t s_transfer_id;
static char *s_text;
static bool s_show_notice;
// Height of one line of text in the current font.
static int16_t s_line_height;
// Where the first line of text starts in the scrolled content.
static int16_t s_text_top;
static int16_t s_content_height;
// Where the content is scrolled to, or is being animated to. Not positive.
static int32_t s_scroll_offset;
// The reading position as it is in storage, to skip writes that would change nothing.
static StoragePosition s_stored_position;

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
  int32_t min_offset = prv_frame_height() - s_content_height;
  if (offset < min_offset) {
    offset = min_offset;
  }
  if (offset > 0) {
    offset = 0;
  }
  s_scroll_offset = offset;
  scroll_layer_set_content_offset(s_scroll_layer, GPoint(0, offset), animated);
}

// Remembers the place for the next launch. Called when the window goes away: when it is
// closed and when the app exits.
static void prv_save_position(void) {
  StoragePosition position = {
    .transfer_id = s_transfer_id,
    .offset = s_scroll_offset,
    .content_height = s_content_height,
  };
  if (memcmp(&position, &s_stored_position, sizeof(position)) != 0) {
    storage_write_position(s_text_index, &position);
    s_stored_position = position;
  }
}

// Draws the part of the bar that corresponds to the visible part of the text.
// Nothing is drawn when the whole text fits on the screen.
static void prv_indicator_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  int32_t frame_height = bounds.size.h;
  if (s_content_height <= frame_height) {
    return;
  }
  int32_t height = frame_height * frame_height / s_content_height;
  if (height < INDICATOR_MIN_HEIGHT) {
    height = INDICATOR_MIN_HEIGHT;
  }
  // The actual offset, not ``s_scroll_offset``, so that the bar follows the animation.
  int32_t scrolled = -scroll_layer_get_content_offset(s_scroll_layer).y;
  int32_t y = scrolled * (frame_height - height) / (s_content_height - frame_height);
  graphics_context_set_fill_color(ctx, GColorDarkGray);
  graphics_fill_rect(ctx, GRect(0, y, bounds.size.w, height), 0, GCornerNone);
}

static void prv_content_offset_changed_handler(ScrollLayer *scroll_layer, void *context) {
  layer_mark_dirty(s_indicator_layer);
}

static void prv_layout(void) {
  GRect frame = layer_get_frame(scroll_layer_get_layer(s_scroll_layer));
  // The space for the indicator is always reserved, so that the line breaks do not
  // depend on whether the indicator is shown.
  int16_t width = frame.size.w - TEXT_MARGIN - INDICATOR_GAP - INDICATOR_WIDTH;
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
    s_content_height = s_text_top + height;
    scroll_layer_set_content_size(s_scroll_layer, GSize(frame.size.w, s_content_height));
  } else {
    const char *placeholder = "Paste text in settings on your phone";
    GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
    int16_t height = prv_text_height(placeholder, font, width, GTextAlignmentCenter) + 8;
    text_layer_set_font(s_text_layer, font);
    text_layer_set_text_alignment(s_text_layer, GTextAlignmentCenter);
    text_layer_set_text(s_text_layer, placeholder);
    layer_set_frame(text_layer, GRect(TEXT_MARGIN, y + (frame.size.h - y - height) / 2, width, height));
    s_content_height = frame.size.h;
    scroll_layer_set_content_size(s_scroll_layer, frame.size);
  }
  layer_mark_dirty(s_indicator_layer);
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
  int32_t old_height = s_content_height;

  GFont old_font = s_font;
  s_font_index = (s_font_index + 1) % FONT_COUNT;
  s_font = fonts_load_custom_font(resource_get_handle(FONT_RESOURCES[s_font_index]));
  storage_write_font_index(s_font_index);
  prv_layout();
  fonts_unload_custom_font(old_font);

  // Stay at the same relative position in the text.
  prv_scroll_to(old_offset * s_content_height / old_height, false);
}

// Called after the scroll layer has set up its own Up and Down handlers, which this replaces.
static void prv_click_config_provider(void *context) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, SCROLL_REPEAT_INTERVAL_MS,
                                          prv_up_click_handler);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, SCROLL_REPEAT_INTERVAL_MS,
                                          prv_down_click_handler);
  window_long_click_subscribe(BUTTON_ID_SELECT, 0, prv_select_long_click_handler, NULL);
}

// Shows the text that is in storage. Returns to the remembered place if it belongs to
// this text; a new text has another transfer id and starts from the top.
static void prv_reload(void) {
  // Free the old text first so that two copies never have to fit in the heap.
  text_layer_set_text(s_text_layer, "");
  free(s_text);
  s_text = storage_load_text(s_text_index);
  StorageTextInfo info;
  storage_get_info(s_text_index, &info);
  s_transfer_id = info.transfer_id;
  s_show_notice = info.incomplete;
  prv_layout();

  int32_t offset = 0;
  if (storage_read_position(s_text_index, &s_stored_position) &&
      s_stored_position.transfer_id == s_transfer_id &&
      s_stored_position.content_height > 0) {
    // The same scaling as on a font change; ``prv_scroll_to`` keeps it inside the content.
    offset = s_stored_position.offset * s_content_height / s_stored_position.content_height;
  } else {
    s_stored_position = (StoragePosition) {0};
  }
  prv_scroll_to(offset, false);
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
    .content_offset_changed_handler = prv_content_offset_changed_handler,
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

  s_indicator_layer = layer_create(GRect(bounds.size.w - INDICATOR_WIDTH, 0,
                                         INDICATOR_WIDTH, bounds.size.h));
  layer_set_update_proc(s_indicator_layer, prv_indicator_update_proc);
  layer_add_child(window_layer, s_indicator_layer);

  prv_reload();
}

static void prv_window_disappear(Window *window) {
  prv_save_position();
}

static void prv_window_unload(Window *window) {
  layer_destroy(s_indicator_layer);
  text_layer_destroy(s_text_layer);
  text_layer_destroy(s_notice_layer);
  scroll_layer_destroy(s_scroll_layer);
  fonts_unload_custom_font(s_font);
  free(s_text);
  s_text = NULL;
  window_destroy(window);
  s_window = NULL;
}

void text_window_push(int text) {
  s_text_index = text;
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .disappear = prv_window_disappear,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, true);
}

void text_window_handle_text_changed(int text) {
  if (s_window && text == s_text_index) {
    prv_reload();
  }
}
