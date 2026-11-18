#include "menu_window.h"

#include "settings.h"
#include "storage.h"
#include "text_window.h"

#define ROW_MARGIN 6
// Space above the name and below it; the box for the name is a few pixels taller than
// the font so that accents and descenders are not cut.
#define ROW_TOP 4
#define ROW_BOTTOM 12
#define NAME_BOX_EXTRA 8
#define NOTICE_HEIGHT 20
#define SELECTION_REPEAT_INTERVAL_MS 150

static Window *s_window;
static StatusBarLayer *s_status_bar;
static MenuLayer *s_menu_layer;
static TextLayer *s_empty_layer;
// The system menu font has no Ukrainian letters, so rows are drawn with DejaVu.
static GFont s_title_font;
static int s_title_size;
static GFont s_notice_font;

// The texts in the menu, in slot order: stored ones and ones whose transfer broke off.
static int s_row_count;
static int s_row_text[STORAGE_TEXT_COUNT];
static StorageTextInfo s_row_info[STORAGE_TEXT_COUNT];
// The selected text as it is in storage, to skip writes that would change nothing.
static int s_stored_selection;

static void prv_load_rows(void) {
  s_row_count = 0;
  for (int text = 0; text < STORAGE_TEXT_COUNT; text++) {
    StorageTextInfo info;
    storage_get_info(text, &info);
    if (info.total_bytes > 0 || info.incomplete) {
      s_row_text[s_row_count] = text;
      s_row_info[s_row_count] = info;
      s_row_count++;
    }
  }
}

// Selects the row of ``text``, or the nearest row before it if that text is gone.
static void prv_select_text(int text) {
  int row = 0;
  for (int i = 0; i < s_row_count; i++) {
    if (s_row_text[i] <= text) {
      row = i;
    }
  }
  menu_layer_set_selected_index(s_menu_layer, MenuIndex(0, row), MenuRowAlignCenter, false);
}

static int prv_selected_text(void) {
  int row = menu_layer_get_selected_index(s_menu_layer).row;
  return (row >= 0 && row < s_row_count) ? s_row_text[row] : s_stored_selection;
}

static void prv_update_empty_state(void) {
  layer_set_hidden(menu_layer_get_layer(s_menu_layer), s_row_count == 0);
  layer_set_hidden(text_layer_get_layer(s_empty_layer), s_row_count != 0);
}

static uint16_t prv_get_num_rows(MenuLayer *menu_layer, uint16_t section, void *context) {
  return s_row_count;
}

static int16_t prv_get_cell_height(MenuLayer *menu_layer, MenuIndex *index, void *context) {
  int16_t height = ROW_TOP + s_title_size + ROW_BOTTOM;
  return s_row_info[index->row].incomplete ? height + NOTICE_HEIGHT : height;
}

static void prv_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *index, void *context) {
  GRect bounds = layer_get_bounds(cell_layer);
  int16_t width = bounds.size.w - 2 * ROW_MARGIN;
  const StorageTextInfo *info = &s_row_info[index->row];
  // A text that never arrived completely may have no name yet.
  char fallback[24];
  const char *title = info->name;
  if (title[0] == '\0') {
    snprintf(fallback, sizeof(fallback), "Text %d", s_row_text[index->row] + 1);
    title = fallback;
  }
  graphics_draw_text(ctx, title, s_title_font,
                     GRect(ROW_MARGIN, ROW_TOP, width, s_title_size + NAME_BOX_EXTRA),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  if (info->incomplete) {
    int16_t y = ROW_TOP + s_title_size + ROW_BOTTOM - 4;
    graphics_draw_text(ctx, "Transfer incomplete", s_notice_font,
                       GRect(ROW_MARGIN, y, width, NOTICE_HEIGHT),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
}

static void prv_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  menu_layer_set_selected_next(s_menu_layer, true, MenuRowAlignCenter, true);
}

static void prv_down_click_handler(ClickRecognizerRef recognizer, void *context) {
  menu_layer_set_selected_next(s_menu_layer, false, MenuRowAlignCenter, true);
}

static void prv_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_row_count > 0) {
    text_window_push(s_row_text[menu_layer_get_selected_index(s_menu_layer).row], true);
  }
}

// Back from the menu is the only way out after which the next launch starts with the
// menu; every other way out reopens the last text. Holding Back here also arrives as
// a press first, so it clears the open text as well.
static void prv_back_click_handler(ClickRecognizerRef recognizer, void *context) {
  storage_write_open_text(-1);
  window_stack_pop(true);
}

// The menu layer's own click setup has no place for Back, so it is replaced.
static void prv_click_config_provider(void *context) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, SELECTION_REPEAT_INTERVAL_MS,
                                          prv_up_click_handler);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, SELECTION_REPEAT_INTERVAL_MS,
                                          prv_down_click_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select_click_handler);
  window_single_click_subscribe(BUTTON_ID_BACK, prv_back_click_handler);
}

static void prv_load_title_font(int size) {
  static const uint32_t RESOURCES[SETTINGS_SIZE_COUNT] = {
    RESOURCE_ID_FONT_DEJAVU_14, RESOURCE_ID_FONT_DEJAVU_18,
    RESOURCE_ID_FONT_DEJAVU_20, RESOURCE_ID_FONT_DEJAVU_24,
  };
  if (s_title_font && size == s_title_size) {
    return;
  }
  if (s_title_font) {
    fonts_unload_custom_font(s_title_font);
  }
  s_title_size = size;
  s_title_font = fonts_load_custom_font(resource_get_handle(RESOURCES[settings_size_index(size)]));
}

// Applies the stored settings: the size of the names and whether the time is shown.
// Black on white, or white on black with inverted colors; the selected row is the opposite.
static void prv_apply_colors(bool invert) {
  GColor background = invert ? GColorBlack : GColorWhite;
  GColor foreground = invert ? GColorWhite : GColorBlack;
  window_set_background_color(s_window, background);
  status_bar_layer_set_colors(s_status_bar, background, foreground);
  menu_layer_set_normal_colors(s_menu_layer, background, foreground);
  menu_layer_set_highlight_colors(s_menu_layer, foreground, background);
  text_layer_set_text_color(s_empty_layer, foreground);
}

static void prv_apply_settings(void) {
  Settings settings;
  settings_load(&settings);
  prv_load_title_font(settings.menu_size);
  prv_apply_colors(settings.invert);
  GRect bounds = layer_get_bounds(window_get_root_layer(s_window));
  int16_t top = settings.show_time ? STATUS_BAR_LAYER_HEIGHT : 0;
  layer_set_hidden(status_bar_layer_get_layer(s_status_bar), !settings.show_time);
  layer_set_frame(menu_layer_get_layer(s_menu_layer),
                  GRect(0, top, bounds.size.w, bounds.size.h - top));
  layer_set_frame(text_layer_get_layer(s_empty_layer),
                  GRect(4, top + (bounds.size.h - top) / 2 - 32, bounds.size.w - 8, 64));
}

static void prv_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_notice_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_DEJAVU_14));

  // The status bar shows the current time on its own.
  s_status_bar = status_bar_layer_create();
  status_bar_layer_set_separator_mode(s_status_bar, StatusBarLayerSeparatorModeDotted);
  layer_add_child(window_layer, status_bar_layer_get_layer(s_status_bar));

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_rows = prv_get_num_rows,
    .get_cell_height = prv_get_cell_height,
    .draw_row = prv_draw_row,
  });
  window_set_click_config_provider(window, prv_click_config_provider);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));

  s_empty_layer = text_layer_create(GRectZero);
  text_layer_set_font(s_empty_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_background_color(s_empty_layer, GColorClear);
  text_layer_set_text_alignment(s_empty_layer, GTextAlignmentCenter);
  text_layer_set_text(s_empty_layer, "Paste text in settings on your phone");
  layer_add_child(window_layer, text_layer_get_layer(s_empty_layer));

  prv_apply_settings();
  prv_load_rows();
  menu_layer_reload_data(s_menu_layer);
  s_stored_selection = storage_read_menu_text(0);
  prv_select_text(s_stored_selection);
  prv_update_empty_state();
}

// Remembers the selected text for the next launch. The menu goes away when a text is
// opened and when the app exits.
static void prv_window_disappear(Window *window) {
  int text = prv_selected_text();
  if (s_row_count > 0 && text != s_stored_selection) {
    storage_write_menu_text(text);
    s_stored_selection = text;
  }
}

static void prv_window_unload(Window *window) {
  text_layer_destroy(s_empty_layer);
  menu_layer_destroy(s_menu_layer);
  status_bar_layer_destroy(s_status_bar);
  fonts_unload_custom_font(s_notice_font);
  fonts_unload_custom_font(s_title_font);
  s_title_font = NULL;
}

void menu_window_push(bool animated) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .disappear = prv_window_disappear,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, animated);
}

void menu_window_destroy(void) {
  window_destroy(s_window);
}

void menu_window_reload(void) {
  int text = prv_selected_text();
  prv_load_rows();
  menu_layer_reload_data(s_menu_layer);
  prv_select_text(text);
  prv_update_empty_state();
}

void menu_window_apply_settings(void) {
  int text = prv_selected_text();
  prv_apply_settings();
  menu_layer_reload_data(s_menu_layer);
  prv_select_text(text);
}
