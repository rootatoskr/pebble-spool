#include <pebble.h>

#include "storage.h"
#include "text_window.h"
#include "transfer.h"

int main(void) {
  storage_init();
  text_window_push();
  transfer_init(text_window_reload);
  app_event_loop();
  text_window_destroy();
}
