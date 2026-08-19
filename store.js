(function (root) {
  const KEY = "raincheck-garden-v1";
  const IDB_NAME = "garden-jdp";
  const IDB_STORE = "garden";

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

  function validGarden(value) {
    return Boolean(value && Array.isArray(value.plants) && value.settings);
  }

  function askPersist() {
    if (!navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persist().catch(() => {});
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error("idb"));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveIdb(state) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.objectStore(IDB_STORE).put(state, KEY);
      });
      db.close();
    } catch {
      /* localStorage still holds the copy */
    }
  }

  async function loadIdb() {
    try {
      const db = await openDb();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return value;
    } catch {
      return null;
    }
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return validGarden(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveIdb(state);
    askPersist();
  }

  function load(library) {
    const parsed = readLocal();
    if (!parsed) return defaultState(library);
    return migrate(parsed);
  }

  async function loadAsync(library) {
    let parsed = readLocal();
    if (!validGarden(parsed)) parsed = await loadIdb();
    if (!validGarden(parsed)) return defaultState(library);
    const next = migrate(parsed);
    save(next);
    return next;
  }

  function reset(library) {
    const next = defaultState(library);
    save(next);
    return next;
  }

  function backupBlob(state) {
    const payload = {
      app: "garden.jdp",
      saved_at: new Date().toISOString(),
      garden: state,
    };
    return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  }

  function parseBackup(text) {
    const parsed = JSON.parse(text);
    const garden = parsed.garden && parsed.garden.plants ? parsed.garden : parsed;
    if (!validGarden(garden)) throw new Error("backup");
    return migrate(garden);
  }

  root.RaincheckStore = {
    load,
    loadAsync,
    save,
    reset,
    seedPlants,
    defaultState,
    backupBlob,
    parseBackup,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
