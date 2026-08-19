(function (root) {
  const KEY = "raincheck-garden-v1";

  function seedPlants(library) {
    return library.seed_plants.map((plant) => ({
      ...plant,
      notes: plant.notes || "",
      last_watered: null,
      active: true,
      weekly_need_override_mm: null,
      dismissed_on: null,
    }));
  }

  function defaultState(library) {
    const place = library.default_place;
    return {
      settings: {
        place_name: place.name,
        latitude: place.lat,
        longitude: place.lon,
        timezone: library.timezone || "America/New_York",
        notify_hour: 7,
      },
      plants: seedPlants(library),
    };
  }

  function migrate(parsed) {
    parsed.plants = (parsed.plants || []).map((plant) => ({
      ...plant,
      dismissed_on: plant.dismissed_on ?? null,
    }));
    return parsed;
  }

  function load(library) {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState(library);
      const parsed = JSON.parse(raw);
      if (!parsed.plants || !parsed.settings) return defaultState(library);
      return migrate(parsed);
    } catch {
      return defaultState(library);
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function reset(library) {
    const next = defaultState(library);
    save(next);
    return next;
  }

  root.RaincheckStore = { load, save, reset, seedPlants, defaultState };
})(typeof globalThis !== "undefined" ? globalThis : window);
