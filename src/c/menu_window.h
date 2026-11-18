#pragma once

#include <pebble.h>

// The list of stored texts that the app starts with.
void menu_window_push(bool animated);
void menu_window_destroy(void);

// Rebuilds the list after a text was stored or cleared.
void menu_window_reload(void);
// Applies new appearance settings to the list.
void menu_window_apply_settings(void);
