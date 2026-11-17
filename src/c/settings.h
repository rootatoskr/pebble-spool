#pragma once

#include <pebble.h>

// The text sizes in pixels, smallest first. Bit ``i`` of a size mask stands for
// ``SETTINGS_SIZES[i]``. Keep in sync with ``SIZES`` in ``src/pkjs/sync.js``.
#define SETTINGS_SIZE_COUNT 4
extern const int SETTINGS_SIZES[SETTINGS_SIZE_COUNT];
#define SETTINGS_DEFAULT_TEXT_SIZE 20

typedef struct {
  bool show_time;
  // The sizes that holding Select cycles through. Never 0.
  uint8_t size_mask;
  // The size of the names in the menu, one of ``SETTINGS_SIZES``.
  int menu_size;
} Settings;

// Reads the settings, with the defaults for anything missing or invalid.
void settings_load(Settings *settings);
// Stores the settings and moves the text size to an enabled one if it was turned off.
void settings_save(const Settings *settings);

// Index of ``size`` in ``SETTINGS_SIZES``, or -1.
int settings_size_index(int size);
// The stored text size, always one of ``SETTINGS_SIZES``.
int settings_text_size(void);
// The enabled size closest to ``size``; of two equally close the smaller one.
int settings_nearest_enabled_size(uint8_t mask, int size);
// The next enabled size after ``size``, starting again from the smallest.
int settings_next_enabled_size(uint8_t mask, int size);
