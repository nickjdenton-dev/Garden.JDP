const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const NY = "America/New_York";

const SOILS = [
  {
    name: "Compost",
    ids: ["dwarf-banana", "mona-lisa-banana", "turmeric", "mulberry"],
  },
  {
    name: "Trellis",
    ids: ["passionflower", "loofah", "butterfly-pea"],
  },
  {
    name: "Bark",
    ids: ["vanilla"],
  },
  {
    name: "Grit",
    ids: ["san-pedro"],
  },
  {
    name: "Pot",
    ids: ["deadly-nightshade"],
  },
];

const BED = {
  "banana-tiny": { x: 30, y: 44 },
  "banana-mona-lisa": { x: 46, y: 38 },
  "turmeric-1": { x: 38, y: 62 },
  "mulberry-1": { x: 16, y: 34 },
  "passionflower-1": { x: 20, y: 14 },
  "loofah-1": { x: 48, y: 12 },
  "loofah-2": { x: 62, y: 20 },
  "butterfly-pea-1": { x: 78, y: 12 },
  "butterfly-pea-2": { x: 90, y: 22 },
  "vanilla-1": { x: 72, y: 44 },
  "san-pedro-1": { x: 78, y: 70 },
  "san-pedro-2": { x: 90, y: 64 },
  "nightshade-1": { x: 12, y: 74 },
};

const state = {
  library: null,
  garden: null,
  snapshot: null,
  briefing: null,
  openPlantId: null,
};

function todayNy(nowMs = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

function isDismissedToday(plant) {
  return Boolean(plant && plant.dismissed_on === todayNy());
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function shortPlace(name) {
  return String(name || "Hobe Sound").split(",")[0].trim() || "Hobe Sound";
}

function firstSentence(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const match = raw.match(/^.+?[.](?=\s|$)/);
  return match ? match[0] : raw;
}

function plantLastMs(plant) {
  if (!plant.last_watered) return null;
  const parsed = Date.parse(plant.last_watered);
  return Number.isNaN(parsed) ? null : parsed;
}

function withWaterTimes(plants) {
  return plants.map((plant) => ({ ...plant, last_watered_ms: plantLastMs(plant) }));
}

function statusOf(decision, plant) {
  if (decision?.action === "watch") return "watch";
  if (decision?.action === "water" && !isDismissedToday(plant)) return "water";
  return "ok";
}

function statusLabel(kind) {
  if (kind === "water") return "Thirsty";
  if (kind === "watch") return "Watch";
  return "Ok";
}

function toxLabel(toxicity) {
  if (toxicity === "high") return "Toxic";
  if (toxicity === "bioactive") return "Bioactive";
  return "";
}

function persist() {
  RaincheckStore.save(state.garden);
}

function thirstyPlants() {
  const water = state.briefing?.water || [];
  return water.filter((d) => {
    const plant = state.garden.plants.find((p) => p.id === d.plant_id);
    return plant && !isDismissedToday(plant);
  });
}

function buildBriefing(snapshot, plants, nowMs) {
  const settings = state.garden.settings;
  const decisions = RaincheckWatering.decideAll(
    withWaterTimes(plants),
    snapshot,
    nowMs,
    state.library.species
  );
  const water = decisions.filter((d) => d.action === "water");
  const watch = decisions.filter((d) => d.action === "watch");
  const skip = decisions.filter((d) => d.action === "skip");
  const visibleWater = water.filter((d) => {
    const plant = plants.find((p) => p.id === d.plant_id);
    return plant && !isDismissedToday(plant);
  });
  const tempC = snapshot.current_temp_c;
  return {
    generated_at: new Date(nowMs).toISOString(),
    place_name: settings.place_name,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    timezone: snapshot.timezone,
    weather: {
      text: RaincheckWeather.wmoText(snapshot.current_weather_code, state.library),
      temp_c: tempC,
      temp_f: tempC == null ? null : Math.round((tempC * 9) / 5 + 32),
      humidity: snapshot.current_humidity,
      daily: snapshot.daily,
    },
    summary: RaincheckWatering.briefingSummary(decisions),
    needs_notification: Boolean(visibleWater.length || watch.length),
    water,
    watch,
    skip,
    decisions,
  };
}

function fillPlaceSelect() {
  const select = $("#place-select");
  const places = state.library.places;
  const name = state.garden.settings.place_name;
  select.innerHTML = places
    .map((p) => `<option value="${esc(p.name)}" data-lat="${p.lat}" data-lon="${p.lon}">${esc(p.name)}</option>`)
    .join("");
  if (places.some((p) => p.name === name)) select.value = name;
}

function renderHeader() {
  const temp = state.briefing?.weather?.temp_f;
  $("#temp").textContent = temp == null ? "—" : `${temp}°`;
  $("#place-btn").textContent = shortPlace(state.garden.settings.place_name);
}

function renderThirst() {
  const due = thirstyPlants();
  const bar = $("#thirst");
  if (!due.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  $("#thirst-label").textContent = due.length === 1 ? "Thirsty" : `${due.length} thirsty`;
}

function renderBed() {
  const decisions = state.briefing?.decisions || [];
  $("#bed").innerHTML = state.garden.plants
    .map((plant, index) => {
      const species = state.library.species[plant.species_id] || {};
      const decision = decisions.find((d) => d.plant_id === plant.id);
      const kind = statusOf(decision, plant);
      const spot = BED[plant.id] || {
        x: 12 + (index % 5) * 19,
        y: 18 + Math.floor(index / 5) * 28,
      };
      const glyph = RaincheckGlyphs.svg(plant.species_id);
      return `<button type="button" class="stem is-${kind}" style="left:${spot.x}%;top:${spot.y}%" data-plant="${esc(plant.id)}" role="listitem">${glyph}<b>${esc(plant.nickname)}</b></button>`;
    })
    .join("");
}

function renderExplore() {
  const species = state.library.species;
  $("#soils").innerHTML = SOILS.map((group) => {
    const items = group.ids
      .map((id) => species[id])
      .filter(Boolean)
      .map(
        (s) =>
          `<div class="soil-item">${RaincheckGlyphs.svg(s.id)}<span>${esc(s.common_name)}</span></div>`
      )
      .join("");
    return `<section class="soil"><h2>${group.name}</h2><div class="soil-row">${items}</div></section>`;
  }).join("");
  $("#library").innerHTML = Object.values(species)
    .map((s) => `<li>${esc(s.common_name)}</li>`)
    .join("");
}

function closeSheet() {
  state.openPlantId = null;
  $("#sheet").hidden = true;
  $("#sheet-backdrop").hidden = true;
}

function openSheet(plantId) {
  const plant = state.garden.plants.find((p) => p.id === plantId);
  if (!plant) return;
  const species = state.library.species[plant.species_id] || {};
  const decision = (state.briefing?.decisions || []).find((d) => d.plant_id === plant.id);
  const kind = statusOf(decision, plant);
  const tox = toxLabel(species.toxicity);
  state.openPlantId = plantId;
  $("#sheet-body").innerHTML = `
    <h2>${esc(plant.nickname)}</h2>
    <p class="latin">${esc(species.scientific_name || "")}</p>
    <p class="status ${kind}">${statusLabel(kind)}</p>
    <p class="fact">${esc(firstSentence(species.soil))}</p>
    <p class="fact">${esc(firstSentence(species.sun))}</p>
    ${tox ? `<p class="flag">${tox}</p>` : ""}
    <div class="sheet-actions">
      <button type="button" data-sheet="watered">Watered</button>
      ${kind === "water" ? `<button type="button" class="ghost" data-sheet="dismiss">Dismiss</button>` : ""}
    </div>
  `;
  $("#sheet").hidden = false;
  $("#sheet-backdrop").hidden = false;
}

function renderAll() {
  renderHeader();
  renderThirst();
  renderBed();
  renderExplore();
  fillPlaceSelect();
  if (state.openPlantId) openSheet(state.openPlantId);
}

function maybeNotify(briefing) {
  if (!briefing.needs_notification || !window.Notification || Notification.permission !== "granted") return;
  const due = thirstyPlants();
  const watch = briefing.watch || [];
  if (!due.length && !watch.length) return;
  const body = RaincheckWatering.briefingSummary([...due, ...watch]);
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "WATERING", body });
  } else {
    new Notification("Raincheck", { body, icon: "./icon.png" });
  }
}

async function refreshWeather() {
  const { latitude, longitude, timezone, place_name } = state.garden.settings;
  state.snapshot = await RaincheckWeather.fetchWeather(Number(latitude), Number(longitude), timezone);
  state.snapshot.place_name = place_name;
  state.briefing = buildBriefing(state.snapshot, state.garden.plants, Date.now());
  renderAll();
  maybeNotify(state.briefing);
}

function saveStation(placeName, latitude, longitude) {
  state.garden.settings.place_name = placeName;
  state.garden.settings.latitude = Number(latitude);
  state.garden.settings.longitude = Number(longitude);
  persist();
  $("#place-pop").hidden = true;
  return refreshWeather();
}

function markWatered(ids) {
  const stamp = new Date().toISOString();
  const set = new Set(ids);
  state.garden.plants.forEach((plant) => {
    if (!set.has(plant.id)) return;
    plant.last_watered = stamp;
    plant.dismissed_on = null;
  });
  persist();
  return refreshWeather();
}

function dismissToday(ids) {
  const day = todayNy();
  const set = new Set(ids);
  state.garden.plants.forEach((plant) => {
    if (!set.has(plant.id)) return;
    plant.dismissed_on = day;
  });
  persist();
  return refreshWeather();
}

$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach((el) => el.classList.remove("is-on"));
    $$(".panel").forEach((el) => el.classList.remove("is-on"));
    btn.classList.add("is-on");
    $(`#panel-${btn.dataset.tab}`).classList.add("is-on");
    closeSheet();
    $("#place-pop").hidden = true;
  });
});

$("#place-btn").addEventListener("click", (event) => {
  event.stopPropagation();
  $("#place-pop").hidden = !$("#place-pop").hidden;
});

$("#place-select").addEventListener("change", async (event) => {
  const opt = event.target.selectedOptions[0];
  if (!opt?.dataset.lat) return;
  await saveStation(opt.value, opt.dataset.lat, opt.dataset.lon);
});

let searchTimer;
$("#place-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = $("#place-search").value.trim();
  const box = $("#place-results");
  if (q.length < 2) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const results = await RaincheckWeather.searchPlaces(q);
      box.hidden = false;
      box.innerHTML = results
        .map(
          (r) =>
            `<button type="button" class="place-hit" data-name="${esc(r.label)}" data-lat="${r.lat}" data-lon="${r.lon}">${esc(r.label)}</button>`
        )
        .join("");
    } catch {
      box.hidden = true;
    }
  }, 280);
});

$("#place-results").addEventListener("click", async (event) => {
  const btn = event.target.closest(".place-hit");
  if (!btn) return;
  await saveStation(btn.dataset.name, btn.dataset.lat, btn.dataset.lon);
});

$("#thirst-watered").addEventListener("click", () => markWatered(thirstyPlants().map((d) => d.plant_id)));
$("#thirst-dismiss").addEventListener("click", () => dismissToday(thirstyPlants().map((d) => d.plant_id)));

$("#bed").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-plant]");
  if (!btn) return;
  openSheet(btn.dataset.plant);
});

$("#sheet").addEventListener("click", async (event) => {
  const act = event.target.dataset.sheet;
  if (!act || !state.openPlantId) return;
  const id = state.openPlantId;
  if (act === "watered") await markWatered([id]);
  if (act === "dismiss") await dismissToday([id]);
  closeSheet();
});

$("#sheet-backdrop").addEventListener("click", closeSheet);

document.addEventListener("click", (event) => {
  if (event.target.closest(".place-wrap")) return;
  $("#place-pop").hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

async function boot() {
  const response = await fetch("./library.json");
  if (!response.ok) throw new Error("library");
  state.library = await response.json();
  state.garden = RaincheckStore.load(state.library);
  renderAll();
  await refreshWeather();
}

boot().catch(() => {
  $("#temp").textContent = "—";
});
