#include <pebble.h>

#include "menu_window.h"
#include "storage.h"
#include "text_window.h"
#include "transfer.h"

static void prv_text_changed(int text) {
  menu_window_reload();
  text_window_handle_text_changed(text);
}

static void prv_settings_changed(void) {
  menu_window_apply_settings();
  text_window_apply_settings();
}

// Opens the text that was open when the app was closed, on top of the menu so that
// Back leads to the menu. A text that was cleared in the meantime is not opened.
static void prv_push_windows(void) {
  int text = storage_read_open_text();
  StorageTextInfo info;
  if (text >= 0) {
    storage_get_info(text, &info);
  }
  if (text < 0 || info.total_bytes == 0) {
    storage_write_open_text(-1);
    menu_window_push(true);
    return;
  }
  menu_window_push(false);
  text_window_push(text, false);
}

int main(void) {
  storage_init();
  prv_push_windows();
  transfer_init(prv_text_changed, prv_settings_changed);
  app_event_loop();
  // Popping unloads the windows, which saves the reading position and the selection.
  window_stack_pop_all(false);
  menu_window_destroy();
}
