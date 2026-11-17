#include "settings.h"

#include <limits.h>

#include "storage.h"

const int SETTINGS_SIZES[SETTINGS_SIZE_COUNT] = {14, 18, 20, 24};

#define ALL_SIZES ((1 << SETTINGS_SIZE_COUNT) - 1)
#define DEFAULT_MENU_SIZE 18

int settings_size_index(int size) {
  for (int i = 0; i < SETTINGS_SIZE_COUNT; i++) {
    if (SETTINGS_SIZES[i] == size) {
      return i;
    }
  }
  return -1;
}

void settings_load(Settings *settings) {
  StorageSettings stored;
  if (!storage_read_settings(&stored)) {
    stored = (StorageSettings) {
      .show_time = 1,
      .size_mask = ALL_SIZES,
      .menu_size = DEFAULT_MENU_SIZE,
    };
  }
  settings->show_time = stored.show_time != 0;
  settings->size_mask = stored.size_mask & ALL_SIZES;
  if (settings->size_mask == 0) {
    settings->size_mask = ALL_SIZES;
  }
  settings->menu_size = settings_size_index(stored.menu_size) >= 0 ? stored.menu_size
                                                                  : DEFAULT_MENU_SIZE;
}

void settings_save(const Settings *settings) {
  StorageSettings stored = {
    .show_time = settings->show_time ? 1 : 0,
    .size_mask = settings->size_mask,
    .menu_size = settings->menu_size,
  };
  storage_write_settings(&stored);
  int size = settings_text_size();
  int enabled = settings_nearest_enabled_size(settings->size_mask, size);
  if (enabled != size) {
    storage_write_text_size(enabled);
  }
}

int settings_text_size(void) {
  int size = storage_read_text_size(SETTINGS_DEFAULT_TEXT_SIZE);
  return settings_size_index(size) >= 0 ? size : SETTINGS_DEFAULT_TEXT_SIZE;
}

int settings_nearest_enabled_size(uint8_t mask, int size) {
  int best = size;
  int best_distance = INT_MAX;
  // Smallest first and a strict comparison: of two equally close sizes the smaller wins.
  for (int i = 0; i < SETTINGS_SIZE_COUNT; i++) {
    if (mask & (1 << i)) {
      int distance = abs(SETTINGS_SIZES[i] - size);
      if (distance < best_distance) {
        best = SETTINGS_SIZES[i];
        best_distance = distance;
      }
    }
  }
  return best;
}

int settings_next_enabled_size(uint8_t mask, int size) {
  int index = settings_size_index(size);
  for (int step = 1; step <= SETTINGS_SIZE_COUNT; step++) {
    int next = (index + step) % SETTINGS_SIZE_COUNT;
    if (mask & (1 << next)) {
      return SETTINGS_SIZES[next];
    }
  }
  return size;
}
