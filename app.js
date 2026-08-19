const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const NY = "America/New_York";
const APP_NAME = "garden.jdp";
const MIN_SCALE = 0.75;
const MAX_SCALE = 3.4;

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
  adding: false,
};

const mapView = { x: 0, y: 0, scale: 1 };
const pointers = new Map();
let lastPinch = 0;
let drag = null;
let mapMoved = false;
let holdTimer = null;
let movingPlant = null;

function clearHold() {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
}

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
  const raw = String(name || "Hobe Sound").trim();
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length >= 2 && /^-?\d+(\.\d+)?$/.test(parts[0]) && /^-?\d+(\.\d+)?$/.test(parts[1])) {
    return "Here";
  }
  return parts[0] || "Hobe Sound";
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

const CYCLES = {
  dry: {
    label: "Dry",
    weekly_need_mm: 6,
    kc: 0.2,
    skip_if_rain_mm: 4,
    lookback_hours: 168,
    min_interval_days: 10,
    max_interval_days: 21,
    overwater_sensitive: true,
    sprinkle_threshold_mm: 0.3,
    hourly_cap_mm: 8,
    dormant_months: [],
    dormant_factor: 1,
    water_method: "rare deep soak, then dry",
  },
  average: {
    label: "Average",
    weekly_need_mm: 18,
    kc: 0.7,
    skip_if_rain_mm: 12,
    lookback_hours: 72,
    min_interval_days: 3,
    max_interval_days: 7,
    overwater_sensitive: false,
    sprinkle_threshold_mm: 0.7,
    hourly_cap_mm: 10,
    dormant_months: [],
    dormant_factor: 1,
    water_method: "deep soak",
  },
  thirsty: {
    label: "Thirsty",
    weekly_need_mm: 28,
    kc: 0.95,
    skip_if_rain_mm: 18,
    lookback_hours: 48,
    min_interval_days: 1.5,
    max_interval_days: 3.5,
    overwater_sensitive: false,
    sprinkle_threshold_mm: 0.7,
    hourly_cap_mm: 12,
    dormant_months: [],
    dormant_factor: 1,
    water_method: "deep soak",
  },
  wet: {
    label: "Wet",
    weekly_need_mm: 34,
    kc: 1,
    skip_if_rain_mm: 22,
    lookback_hours: 36,
    min_interval_days: 1,
    max_interval_days: 2.5,
    overwater_sensitive: false,
    sprinkle_threshold_mm: 0.8,
    hourly_cap_mm: 12,
    dormant_months: [],
    dormant_factor: 1,
    water_method: "deep soak",
  },
};

function persist() {
  RaincheckStore.save(state.garden);
}

function speciesMap() {
  return { ...(state.library?.species || {}), ...(state.garden?.custom_species || {}) };
}

function speciesOf(id) {
  return speciesMap()[id] || {};
}

function inferCycle(parts) {
  const t = [parts.title, parts.extract, parts.description, parts.taxon, parts.family]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const score = { dry: 0, average: 1, thirsty: 0, wet: 0 };
  if (/cact|succulent|xerophyt|drought[- ]tolerant|arid|desert|agave|aloe|sedum|euphorbia|san pedro|trichocereus|echinopsis|crassula|lithops|jade/.test(t))
    score.dry += 6;
  if (/orchid|vanilla|epiphyt|tillandsia|bromeliad/.test(t)) score.dry += 2;
  if (/banana|musa|tropic|ginger|turmeric|curcuma|heliconia|canna|veg|tomato|pepper|cucumber|squash|loofah|luffa|melon|basil/.test(t))
    score.thirsty += 5;
  if (/wetland|marsh|bog|aquatic|rice|taro|colocasia|cyperus|papyrus|lotus|nymphaea/.test(t)) score.wet += 6;
  if (/rainforest|moisture-lov|evenly moist|keep moist/.test(t)) score.thirsty += 3;
  if (/well[- ]drained|moderate water|established trees are/.test(t)) score.average += 2;
  if (/cactaceae|asphodelaceae|crassulaceae|aizoaceae|agavaceae/.test(t)) score.dry += 4;
  if (/musaceae|zingiberaceae|cucurbitaceae/.test(t)) score.thirsty += 4;
  if (/araceae|cyperaceae|nelumbonaceae/.test(t)) score.wet += 3;
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
}

function applyCycle(species, cycleId) {
  const cycle = CYCLES[cycleId] || CYCLES.average;
  Object.keys(CYCLES.average).forEach((key) => {
    if (key === "label") return;
    if (cycle[key] != null) species[key] = cycle[key];
  });
  species.water_cycle = cycleId;
  return species;
}

function addRow(species, attrs) {
  return `<button type="button" class="add-row" ${attrs}>${RaincheckGlyphs.svg(species.id || "")}<span>${esc(
    species.common_name
  )}</span><b>+</b></button>`;
}

function gardenFileName() {
  return `your-garden-${todayNy()}.json`;
}

async function backupGarden() {
  const blob = RaincheckStore.backupBlob(state.garden);
  const name = gardenFileName();
  const file = new File([blob], name, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function restoreGarden(file) {
  if (!file) return;
  const garden = RaincheckStore.parseBackup(await file.text());
  state.garden = garden;
  persist();
  await refreshWeather();
}

function showTab(name) {
  $$(".tab").forEach((el) => el.classList.toggle("is-on", el.dataset.tab === name));
  $$(".panel").forEach((el) => el.classList.toggle("is-on", el.id === `panel-${name}`));
}

function nextNickname(species) {
  const base = species.common_name;
  const count = state.garden.plants.filter((p) => p.species_id === species.id).length;
  return count ? `${base} ${count + 1}` : base;
}

function plantSpot(plant) {
  if (plant.x != null && plant.y != null) return { x: plant.x, y: plant.y };
  if (BED[plant.id]) return BED[plant.id];
  const extras = state.garden.plants.filter((p) => !BED[p.id] && p.x == null);
  const n = Math.max(extras.findIndex((p) => p.id === plant.id), 0);
  return {
    x: 14 + (n % 4) * 24,
    y: 86 - Math.floor(n / 4) * 16,
  };
}

function clientToPercent(clientX, clientY) {
  const bedEl = $("#bed");
  const map = $("#bed-map");
  const rect = bedEl.getBoundingClientRect();
  const mx = (clientX - rect.left - mapView.x) / mapView.scale;
  const my = (clientY - rect.top - mapView.y) / mapView.scale;
  return {
    x: Math.min(96, Math.max(4, (mx / map.offsetWidth) * 100)),
    y: Math.min(96, Math.max(4, (my / map.offsetHeight) * 100)),
  };
}

async function addPlant(speciesId) {
  const species = speciesOf(speciesId);
  if (!species.id) return;
  const count = state.garden.plants.length;
  state.garden.plants.push({
    id: `${speciesId}-${Math.random().toString(16).slice(2, 10)}`,
    species_id: speciesId,
    nickname: nextNickname(species),
    notes: "",
    last_watered: null,
    active: true,
    weekly_need_override_mm: null,
    dismissed_on: null,
    x: 20 + (count % 4) * 20,
    y: 28 + Math.floor(count / 4) * 18,
  });
  persist();
  showTab("garden");
  closeSheet();
  await refreshWeather();
}

async function searchLibrary(query) {
  const q = query.toLowerCase();
  return Object.values(state.library.species).filter((s) => {
    const blob = [s.common_name, s.scientific_name, s.family, s.group, s.extract, s.id.replace(/-/g, " ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });
}

async function searchPlants(query) {
  const local = await searchLibrary(query);
  const params = new URLSearchParams({
    action: "opensearch",
    search: query,
    limit: "8",
    namespace: "0",
    origin: "*",
    format: "json",
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
  if (!response.ok) return { local, remote: [] };
  const data = await response.json();
  const localNames = new Set(local.map((s) => s.common_name.toLowerCase()));
  const remote = (data[1] || [])
    .map((title, index) => ({ title, snippet: (data[2] || [])[index] || "" }))
    .filter((row) => !localNames.has(row.title.toLowerCase()));
  return { local, remote };
}

async function wikiTaxon(qid) {
  if (!qid) return {};
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: qid,
    props: "labels|descriptions|claims",
    languages: "en",
    origin: "*",
    format: "json",
  });
  try {
    const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`);
    const data = await response.json();
    const ent = data.entities && data.entities[qid];
    if (!ent) return {};
    const taxonSnak = ent.claims && ent.claims.P225 && ent.claims.P225[0] && ent.claims.P225[0].mainsnak;
    const taxon = taxonSnak && taxonSnak.datavalue ? taxonSnak.datavalue.value : "";
    return {
      taxon,
      description: (ent.descriptions && ent.descriptions.en && ent.descriptions.en.value) || "",
      label: (ent.labels && ent.labels.en && ent.labels.en.value) || "",
    };
  } catch {
    return {};
  }
}

async function plantWiki(title) {
  const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!response.ok) return;
  const summary = await response.json();
  const extract = summary.extract || summary.description || title;
  const wiki = await wikiTaxon(summary.wikibase_item);
  const facts = await RaincheckEncyclopedia.facts(summary.wikibase_item);
  const scientific = facts.taxon || wiki.taxon || summary.description || "";
  const family = facts.family || "";
  const cycle = inferCycle({
    title: summary.title || title,
    extract,
    description: `${summary.description || ""} ${wiki.description || ""}`,
    taxon: scientific,
    family,
  });
  const common = summary.title || title;
  const wikiUrl =
    summary.content_urls && summary.content_urls.desktop ? summary.content_urls.desktop.page : "";
  const id = `wiki-${common.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Math.random().toString(16).slice(2, 6)}`;
  const species = applyCycle(
    {
      id,
      common_name: common,
      scientific_name: scientific,
      family,
      toxicity: "none",
      edible_parts: "",
      sun: "",
      soil: "",
      placement: "",
      amendments: [],
      notes: extract ? [extract] : [],
      warnings: [],
      climate_fit: "unknown",
      extract,
      image: (summary.thumbnail && summary.thumbnail.source) || "",
      wiki_title: summary.title || title,
      wiki_url: wikiUrl,
      wikidata_id: summary.wikibase_item || "",
      powo_id: facts.powo_id || "",
      gbif_id: facts.gbif_id || "",
      links: RaincheckEncyclopedia.links({
        wiki_url: wikiUrl,
        powo_id: facts.powo_id,
        gbif_id: facts.gbif_id,
        wikidata_id: summary.wikibase_item,
      }),
      custom: true,
      encyclopedia: true,
    },
    cycle
  );
  if (!state.garden.custom_species) state.garden.custom_species = {};
  state.garden.custom_species[id] = species;
  await addPlant(id);
}

function removePlant(id) {
  state.garden.plants = state.garden.plants.filter((p) => p.id !== id);
  persist();
  return refreshWeather();
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
  const map = speciesMap();
  const known = plants.filter((plant) => map[plant.species_id]);
  const decisions = RaincheckWatering.decideAll(
    withWaterTimes(known),
    snapshot,
    nowMs,
    map
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

function renderSaveButton() {
  const btn = $("#garden-file");
  if (!btn || !state.garden) return;
  const empty = !state.garden.plants.length;
  btn.textContent = empty ? "Upload" : "Save your garden";
  btn.dataset.mode = empty ? "upload" : "save";
}

function renderHeader() {
  const temp = state.briefing?.weather?.temp_f;
  $("#temp").textContent = temp == null ? "—" : `${temp}°`;
  $("#place-name").textContent = shortPlace(state.garden.settings.place_name);
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

function clampMap() {
  const bed = $("#bed");
  const map = $("#bed-map");
  if (!bed || !map) return;
  const w = bed.clientWidth;
  const h = bed.clientHeight;
  const sw = map.offsetWidth * mapView.scale;
  const sh = map.offsetHeight * mapView.scale;
  const minX = Math.min(0, w - sw);
  const minY = Math.min(0, h - sh);
  mapView.x = Math.min(0, Math.max(minX, mapView.x));
  mapView.y = Math.min(0, Math.max(minY, mapView.y));
}

function applyMapView() {
  clampMap();
  const map = $("#bed-map");
  if (!map) return;
  map.style.transform = `translate(${mapView.x}px, ${mapView.y}px) scale(${mapView.scale})`;
}

function zoomAt(clientX, clientY, nextScale) {
  const bed = $("#bed");
  const rect = bed.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const prev = mapView.scale;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
  const mx = (px - mapView.x) / prev;
  const my = (py - mapView.y) / prev;
  mapView.scale = scale;
  mapView.x = px - mx * scale;
  mapView.y = py - my * scale;
  applyMapView();
}

function zoomBy(factor) {
  const bed = $("#bed");
  const rect = bed.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, mapView.scale * factor);
}

function renderBed() {
  const decisions = state.briefing?.decisions || [];
  $("#bed-map").innerHTML = state.garden.plants
    .map((plant) => {
      const decision = decisions.find((d) => d.plant_id === plant.id);
      const kind = statusOf(decision, plant);
      const spot = plantSpot(plant);
      const glyph = RaincheckGlyphs.svg(plant.species_id);
      return `<button type="button" class="stem is-${kind}" style="left:${spot.x}%;top:${spot.y}%" data-plant="${esc(plant.id)}" role="listitem">${glyph}<b>${esc(plant.nickname)}</b></button>`;
    })
    .join("");
  applyMapView();
}

function featuredSpecies() {
  const seen = new Set();
  return SOILS.flatMap((group) => group.ids)
    .map((id) => state.library.species[id])
    .filter((s) => s && !seen.has(s.id) && seen.add(s.id));
}

function renderExplore() {
  const species = state.library.species;
  const q = ($("#explore-search") && $("#explore-search").value.trim().toLowerCase()) || "";
  $("#soils").innerHTML = SOILS.map((group) => {
    const items = group.ids
      .map((id) => species[id])
      .filter(Boolean)
      .map(
        (s) =>
          `<button type="button" class="soil-item" data-add="${esc(s.id)}">${RaincheckGlyphs.svg(s.id)}<span>${esc(s.common_name)}</span></button>`
      )
      .join("");
    return `<section class="soil"><h2>${group.name}</h2><div class="soil-row">${items}</div></section>`;
  }).join("");
  const groups = ["Fruit", "Vegetable", "Herb", "Vine", "Tree", "Shrub", "Succulent", "Ornamental", "Toxic"];
  const rows = Object.values(species).filter((s) => {
    if (!q) return true;
    const blob = [s.common_name, s.scientific_name, s.family, s.group, s.extract].filter(Boolean).join(" ").toLowerCase();
    return blob.includes(q);
  });
  $("#library").innerHTML = groups
    .map((name) => {
      const items = rows.filter((s) => (s.group || "Ornamental") === name);
      if (!items.length) return "";
      return `<section class="ency-group"><h2 class="section-label">${esc(name)}</h2><ul class="library">${items
        .map((s) => `<li><button type="button" class="lib-hit" data-add="${esc(s.id)}">${esc(s.common_name)}</button></li>`)
        .join("")}</ul></section>`;
    })
    .join("");
}

function encyclopedia(species) {
  const image = species.image || species.photo || species.image_url || "";
  const links = species.links || species.sources || [];
  return { image, links, extract: species.extract || "", species };
}

function listBlock(label, items) {
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return "";
  return `<section class="sheet-block"><h3 class="sheet-label">${esc(label)}</h3><ul>${rows.map((row) => `<li>${esc(row)}</li>`).join("")}</ul></section>`;
}

function linkBlock(links) {
  if (!Array.isArray(links) || !links.length) return "";
  const items = links
    .map((item) => {
      if (typeof item === "string") return { href: item, label: item };
      const href = item.url || item.href || "";
      if (!href) return null;
      return { href, label: item.title || item.label || href };
    })
    .filter(Boolean);
  if (!items.length) return "";
  return `<section class="sheet-block"><h3 class="sheet-label">Links</h3><ul class="sheet-links">${items
    .map((item) => `<li><a href="${esc(item.href)}" target="_blank" rel="noopener">${esc(item.label)}</a></li>`)
    .join("")}</ul></section>`;
}

function closePlace() {
  $("#place-sheet").hidden = true;
  if ($("#sheet").hidden) $("#sheet-backdrop").hidden = true;
}

function openPlace() {
  closeSheet();
  $("#place-sheet").hidden = false;
  $("#sheet-backdrop").hidden = false;
}

function closeSheet() {
  state.openPlantId = null;
  state.adding = false;
  $("#sheet").hidden = true;
  if ($("#place-sheet").hidden) $("#sheet-backdrop").hidden = true;
}

function openAddSheet() {
  if (!state.library) return;
  state.openPlantId = null;
  state.adding = true;
  closePlace();
  $("#sheet-body").innerHTML = `
    <input id="plant-search" type="search" placeholder="Plant" autocomplete="off" />
    <div id="plant-results" hidden></div>
    <div class="add-list">
      ${featuredSpecies()
        .map((s) => addRow(s, `data-add="${esc(s.id)}"`))
        .join("")}
    </div>
  `;
  $("#sheet").hidden = false;
  $("#sheet-backdrop").hidden = false;
}

function openSheet(plantId) {
  const plant = state.garden.plants.find((p) => p.id === plantId);
  if (!plant) return;
  const species = speciesOf(plant.species_id);
  const decision = (state.briefing?.decisions || []).find((d) => d.plant_id === plant.id);
  const kind = statusOf(decision, plant);
  const tox = toxLabel(species.toxicity);
  const info = encyclopedia(species);
  state.openPlantId = plantId;
  closePlace();
  $("#sheet-body").innerHTML = `
    ${info.image ? `<img class="sheet-photo" src="${esc(info.image)}" alt="">` : ""}
    <h2>${esc(plant.nickname)}</h2>
    <p class="latin">${esc(species.scientific_name || "")}</p>
    ${species.family ? `<p class="family">${esc(species.family)}</p>` : ""}
    <p class="status ${kind}">${statusLabel(kind)}</p>
    ${info.extract ? `<p class="extract">${esc(info.extract)}</p>` : ""}
    ${species.native_range ? `<p class="fact">${esc(species.native_range)}</p>` : ""}
    ${species.soil ? `<p class="fact">${esc(species.soil)}</p>` : ""}
    ${species.sun ? `<p class="fact">${esc(species.sun)}</p>` : ""}
    ${species.placement ? `<p class="fact">${esc(species.placement)}</p>` : ""}
    ${species.water_method ? `<p class="fact">${esc(species.water_method)}</p>` : ""}
    ${species.edible_parts ? `<p class="fact">${esc(species.edible_parts)}</p>` : ""}
    ${species.climate_fit && species.climate_fit !== "unknown" ? `<p class="fact">${esc(species.climate_fit)}</p>` : ""}
    ${tox ? `<p class="flag">${tox}</p>` : ""}
    ${listBlock("Notes", (species.notes || []).filter((row) => row !== info.extract))}
    ${listBlock("Amendments", species.amendments)}
    ${listBlock("Warnings", species.warnings)}
    ${linkBlock(info.links)}
    <div class="sheet-actions">
      <button type="button" data-sheet="watered">Watered</button>
      ${kind === "water" ? `<button type="button" class="ghost" data-sheet="dismiss">Dismiss</button>` : ""}
      <button type="button" class="ghost" data-sheet="remove">Remove</button>
    </div>
  `;
  $("#sheet").hidden = false;
  $("#sheet-backdrop").hidden = false;
}

function renderAll() {
  renderHeader();
  renderSaveButton();
  renderThirst();
  renderBed();
  renderExplore();
  fillPlaceSelect();
  if (state.adding) openAddSheet();
  else if (state.openPlantId) openSheet(state.openPlantId);
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
    new Notification(APP_NAME, { body, icon: "./icon.png" });
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
  closePlace();
  return refreshWeather();
}

async function useHere() {
  if (!navigator.geolocation) return;
  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
    });
  });
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  let name = "Here";
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      language: "en",
      format: "json",
    });
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?${params}`);
    const payload = await response.json();
    const row = (payload.results || [])[0];
    if (row) name = [row.name, row.admin1, row.country].filter(Boolean).join(", ");
  } catch {
    name = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
  await saveStation(name, lat, lon);
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

function waterAll() {
  return markWatered(state.garden.plants.map((plant) => plant.id));
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
    showTab(btn.dataset.tab);
    closeSheet();
    closePlace();
  });
});

$("#soils").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-add]");
  if (btn) addPlant(btn.dataset.add);
});

$("#library").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-add]");
  if (btn) addPlant(btn.dataset.add);
});

$("#explore-search").addEventListener("input", () => renderExplore());

$("#place-btn").addEventListener("click", (event) => {
  event.stopPropagation();
  if ($("#place-sheet").hidden) openPlace();
  else closePlace();
});

$("#place-select").addEventListener("change", async (event) => {
  const opt = event.target.selectedOptions[0];
  if (!opt?.dataset.lat) return;
  await saveStation(opt.value, opt.dataset.lat, opt.dataset.lon);
});

$("#here-btn").addEventListener("click", async (event) => {
  event.stopPropagation();
  try {
    await useHere();
  } catch {
    closePlace();
  }
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

$("#water-all").addEventListener("click", () => waterAll());
$("#garden-file").addEventListener("click", () => {
  if ($("#garden-file").dataset.mode === "upload") $("#restore-file").click();
  else backupGarden();
});
$("#restore-file").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  await restoreGarden(file);
});
$("#thirst-watered").addEventListener("click", () => markWatered(thirstyPlants().map((d) => d.plant_id)));
$("#thirst-dismiss").addEventListener("click", () => dismissToday(thirstyPlants().map((d) => d.plant_id)));

const bed = $("#bed");

bed.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".bed-tools") || event.target.closest(".add-fab")) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  bed.setPointerCapture(event.pointerId);
  mapMoved = false;
  const stem = event.target.closest("[data-plant]");
  if (stem && pointers.size === 1) {
    holdTimer = setTimeout(() => {
      movingPlant = stem.dataset.plant;
      stem.classList.add("is-lifted");
      mapMoved = true;
      drag = null;
    }, 420);
  }
  if (pointers.size === 1) {
    drag = { x: event.clientX, y: event.clientY, ox: mapView.x, oy: mapView.y };
  } else if (pointers.size === 2) {
    clearHold();
    const [a, b] = [...pointers.values()];
    lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
    drag = null;
  }
});

bed.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (movingPlant) {
    const plant = state.garden.plants.find((p) => p.id === movingPlant);
    if (!plant) return;
    const pct = clientToPercent(event.clientX, event.clientY);
    plant.x = pct.x;
    plant.y = pct.y;
    const el = document.querySelector(`[data-plant="${movingPlant}"]`);
    if (el) {
      el.style.left = `${pct.x}%`;
      el.style.top = `${pct.y}%`;
    }
    return;
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (lastPinch) {
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, mapView.scale * (dist / lastPinch));
      mapMoved = true;
    }
    lastPinch = dist;
    return;
  }
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (Math.hypot(dx, dy) > 8) {
    mapMoved = true;
    clearHold();
  }
  if (!mapMoved) return;
  mapView.x = drag.ox + dx;
  mapView.y = drag.oy + dy;
  applyMapView();
});

function endPointer(event) {
  const stem = event.target.closest("[data-plant]");
  pointers.delete(event.pointerId);
  if (pointers.size < 2) lastPinch = 0;
  if (pointers.size === 0) {
    clearHold();
    if (movingPlant) {
      const el = document.querySelector(`[data-plant="${movingPlant}"]`);
      if (el) el.classList.remove("is-lifted");
      persist();
      movingPlant = null;
      drag = null;
      return;
    }
    if (!mapMoved && stem) openSheet(stem.dataset.plant);
    drag = null;
  }
}

bed.addEventListener("pointerup", endPointer);
bed.addEventListener("pointercancel", endPointer);

bed.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(event.clientX, event.clientY, mapView.scale * factor);
  },
  { passive: false }
);

$("#add-plant").addEventListener("click", (event) => {
  event.stopPropagation();
  openAddSheet();
});

$("#zoom-in").addEventListener("click", (event) => {
  event.stopPropagation();
  zoomBy(1.2);
});

$("#zoom-out").addEventListener("click", (event) => {
  event.stopPropagation();
  zoomBy(1 / 1.2);
});

$("#sheet").addEventListener("click", async (event) => {
  const wiki = event.target.closest("[data-wiki]");
  if (wiki) {
    await plantWiki(wiki.dataset.wiki);
    return;
  }
  const add = event.target.closest("[data-add]");
  if (add) {
    await addPlant(add.dataset.add);
    return;
  }
  const act = event.target.dataset.sheet;
  if (!act || !state.openPlantId) return;
  const id = state.openPlantId;
  if (act === "watered") await markWatered([id]);
  if (act === "dismiss") await dismissToday([id]);
  if (act === "remove") await removePlant(id);
  closeSheet();
});

let plantSearchTimer;
$("#sheet").addEventListener("input", (event) => {
  if (event.target.id !== "plant-search") return;
  clearTimeout(plantSearchTimer);
  const q = event.target.value.trim();
  const box = $("#plant-results");
  if (!box) return;
  if (q.length < 2) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  plantSearchTimer = setTimeout(async () => {
    try {
      const { local, remote } = await searchPlants(q);
      box.hidden = false;
      box.innerHTML =
        local.map((s) => addRow(s, `data-add="${esc(s.id)}"`)).join("") +
        remote
          .map(
            (r) =>
              `<button type="button" class="add-row" data-wiki="${esc(r.title)}">${RaincheckGlyphs.svg("")}<span>${esc(
                r.title
              )}</span><b>+</b></button>`
          )
          .join("");
    } catch {
      box.hidden = true;
    }
  }, 280);
});

$("#sheet-backdrop").addEventListener("click", () => {
  closeSheet();
  closePlace();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
    reg.update();
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  });
}

async function boot() {
  const response = await fetch("./library.json");
  if (!response.ok) throw new Error("library");
  state.library = await response.json();
  state.garden = await RaincheckStore.loadAsync(state.library);
  renderAll();
  await refreshWeather();
}

boot().catch(() => {
  $("#temp").textContent = "—";
});
