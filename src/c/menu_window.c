#include "menu_window.h"

#include "storage.h"
#include "text_window.h"

#define ROW_MARGIN 6
#define ROW_HEIGHT 44
#define ROW_WITH_NOTICE_HEIGHT 64

static Window *s_window;
static StatusBarLayer *s_status_bar;
static MenuLayer *s_menu_layer;
static TextLayer *s_empty_layer;
// The system menu font has no Ukrainian letters, so rows are drawn with DejaVu.
static GFont s_title_font;
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
  return s_row_info[index->row].incomplete ? ROW_WITH_NOTICE_HEIGHT : ROW_HEIGHT;
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
  graphics_draw_text(ctx, title, s_title_font, GRect(ROW_MARGIN, 4, width, 32),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  if (info->incomplete) {
    graphics_draw_text(ctx, "Transfer incomplete", s_notice_font, GRect(ROW_MARGIN, 36, width, 24),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
}

static void prv_select_click(MenuLayer *menu_layer, MenuIndex *index, void *context) {
  text_window_push(s_row_text[index->row]);
}

static void prv_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_title_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_DEJAVU_24));
  s_notice_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_DEJAVU_18));

  // The status bar shows the current time on its own.
  s_status_bar = status_bar_layer_create();
  status_bar_layer_set_colors(s_status_bar, GColorWhite, GColorBlack);
  status_bar_layer_set_separator_mode(s_status_bar, StatusBarLayerSeparatorModeDotted);
  layer_add_child(window_layer, status_bar_layer_get_layer(s_status_bar));
  bounds.origin.y = STATUS_BAR_LAYER_HEIGHT;
  bounds.size.h -= STATUS_BAR_LAYER_HEIGHT;

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_rows = prv_get_num_rows,
    .get_cell_height = prv_get_cell_height,
    .draw_row = prv_draw_row,
    .select_click = prv_select_click,
  });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));

  s_empty_layer = text_layer_create(GRect(4, bounds.origin.y + bounds.size.h / 2 - 32,
                                           bounds.size.w - 8, 64));
  text_layer_set_font(s_empty_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_empty_layer, GTextAlignmentCenter);
  text_layer_set_text(s_empty_layer, "Paste text in settings on your phone");
  layer_add_child(window_layer, text_layer_get_layer(s_empty_layer));

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
}

void menu_window_push(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .disappear = prv_window_disappear,
    .unload = prv_window_unload,
  });
  window_stack_push(s_window, true);
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
