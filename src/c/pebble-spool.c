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

int main(void) {
  storage_init();
  menu_window_push();
  transfer_init(prv_text_changed, prv_settings_changed);
  app_event_loop();
  // Popping unloads the windows, which saves the reading position and the selection.
  window_stack_pop_all(false);
  menu_window_destroy();
}
