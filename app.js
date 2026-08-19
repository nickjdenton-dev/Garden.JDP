const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  library: null,
  garden: null,
  snapshot: null,
  briefing: null,
  week: [],
};

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach((el) => el.classList.remove("is-on"));
    $$(".panel").forEach((el) => el.classList.remove("is-on"));
    btn.classList.add("is-on");
    $(`#panel-${btn.dataset.tab}`).classList.add("is-on");
  });
});

function toxLabel(toxicity) {
  if (toxicity === "high") return `<span class="badge high-tox">toxic</span>`;
  if (toxicity === "bioactive") return `<span class="badge bioactive">bioactive</span>`;
  return "";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function addDaysIso(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

function partsInZone(nowMs, timeZone) {
  const dateIso = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
  const [year, month, day] = dateIso.split("-").map(Number);
  return { year, month, day, dateIso };
}

function plantLastMs(plant) {
  if (!plant.last_watered) return null;
  const parsed = Date.parse(plant.last_watered);
  return Number.isNaN(parsed) ? null : parsed;
}

function withWaterTimes(plants) {
  return plants.map((plant) => ({ ...plant, last_watered_ms: plantLastMs(plant) }));
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
      temp_f: tempC == null ? null : Math.round((tempC * 9 / 5 + 32) * 10) / 10,
      humidity: snapshot.current_humidity,
      daily: snapshot.daily,
    },
    summary: RaincheckWatering.briefingSummary(decisions),
    needs_notification: Boolean(water.length || watch.length),
    water,
    watch,
    skip,
  };
}

function weekPlan(snapshot, plants, nowMs) {
  const tz = state.garden.settings.timezone;
  const today = partsInZone(nowMs, tz);
  const days = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDaysIso(today.dateIso, offset);
    const when = RaincheckWeather.parseWallTime(`${date}T07:00`, tz);
    const decisions = RaincheckWatering.decideAll(
      withWaterTimes(plants),
      snapshot,
      when.getTime(),
      state.library.species
    );
    days.push({
      date,
      when,
      summary: RaincheckWatering.briefingSummary(decisions),
      water: decisions.filter((d) => d.action === "water").map((d) => d.nickname),
      watch: decisions.filter((d) => d.action === "watch").map((d) => d.nickname),
      decisions,
    });
  }
  return days;
}

function renderInstall() {
  const card = $("#install-card");
  if (!card) return;
  card.hidden = isStandalone();
}

function renderStation() {
  const b = state.briefing;
  if (!b) return;
  const w = b.weather;
  $("#station-meta").innerHTML = `
    <div>${b.place_name}</div>
    <div>${Number(b.latitude).toFixed(4)}, ${Number(b.longitude).toFixed(4)}</div>
    <div>${w.text} · ${w.temp_f ?? "—"}°F</div>
    <div>RH ${w.humidity ?? "—"}%</div>
  `;
  $("#summary").textContent = b.summary;
  const groups = [
    ...b.water.map((d) => ({ ...d, kind: "water" })),
    ...b.watch.map((d) => ({ ...d, kind: "watch" })),
    ...b.skip.map((d) => ({ ...d, kind: "skip" })),
  ];
  $("#orders").innerHTML = groups
    .map(
      (d) => `
      <article class="card ${d.kind}">
        <div class="stamp ${d.kind}">${d.kind === "water" ? "Water" : d.kind === "watch" ? "Watch" : "Skip"}</div>
        <h3>${d.nickname}${toxLabel(d.toxicity)}${d.urgency === "high" && d.kind === "water" ? '<span class="badge high">due</span>' : ""}</h3>
        <p class="sci">${d.scientific_name}</p>
        <p class="reason">${d.reason}</p>
        <div class="meta-row">
          useful rain ${d.rain_effective_mm} mm / raw ${d.rain_raw_mm} mm · ${d.lookback_hours}h window
          · ${d.apply_label}${d.apply_mm ? ` · ${d.apply_mm} mm` : ""}
        </div>
      </article>`
    )
    .join("");
  $("#week").innerHTML = state.week
    .map((day) => {
      const label = day.water.length ? day.water.join(", ") : day.watch.length ? "drainage check" : "rain covered";
      return `<div class="day ${day.water.length ? "needs" : ""}"><strong>${day.date.slice(5)}</strong><span>${label}</span></div>`;
    })
    .join("");
  const today = partsInZone(Date.now(), state.garden.settings.timezone).dateIso;
  $("#rain-table").innerHTML = w.daily
    .map((d) => {
      const mark = d.date === today ? "today" : "";
      return `<div class="rain-row"><b>${d.date} ${mark}</b><span>${d.precip_sum_mm.toFixed(1)} mm over ${d.precip_hours} h</span><span>ET₀ ${d.et0_mm.toFixed(1)} mm</span></div>`;
    })
    .join("");
}

function fillPlaceSelect() {
  const select = $("#place-select");
  const places = state.library.places;
  const name = state.garden.settings.place_name;
  select.innerHTML =
    places.map((p) => `<option value="${p.name}" data-lat="${p.lat}" data-lon="${p.lon}">${p.name}</option>`).join("") +
    `<option value="custom">Custom coordinates</option>`;
  select.value = places.some((p) => p.name === name) ? name : "custom";
}

function renderSpecimens() {
  const select = $("#species-select");
  select.innerHTML = Object.values(state.library.species)
    .map((s) => `<option value="${s.id}">${s.common_name} — ${s.scientific_name}</option>`)
    .join("");
  const decisions = [...state.briefing.water, ...state.briefing.watch, ...state.briefing.skip];
  $("#specimens").innerHTML = state.garden.plants
    .map((p) => {
      const s = state.library.species[p.species_id] || {};
      const decision = decisions.find((d) => d.plant_id === p.id);
      return `
        <article class="specimen card ${decision ? decision.action : ""}">
          <div>
            <h3>${p.nickname}</h3>
            <p class="sci">${s.scientific_name || p.species_id}</p>
            <p>${p.notes || ""}</p>
            ${s.warnings && s.warnings.length ? `<p class="danger">${s.warnings[0]}</p>` : ""}
            <p class="meta-row">weekly ${s.weekly_need_mm} mm · last watered ${p.last_watered || "never"} · ${s.sun || ""}</p>
            <div class="specimen-actions">
              <button data-water="${p.id}">Watered today</button>
              <button class="ghost" data-off="${p.id}">${p.active !== false ? "Pause" : "Resume"}</button>
              <button class="ghost" data-del="${p.id}">Remove</button>
            </div>
          </div>
        </article>`;
    })
    .join("");
}

function renderAdvice() {
  const a = state.library.advice;
  $("#advice").innerHTML = `
    <h2>${a.title}</h2>
    <p>${a.region}</p>
    <h2 class="ruled">Layout</h2>
    <ul>${a.layout.map((x) => `<li>${x}</li>`).join("")}</ul>
    <h2 class="ruled">Amendments</h2>
    <ul>${a.amendments_general.map((x) => `<li>${x}</li>`).join("")}</ul>
    <h2 class="ruled">Safety</h2>
    <ul>${a.safety.map((x) => `<li>${x}</li>`).join("")}</ul>
    <h2 class="ruled">Season</h2>
    <ul>${a.seasonal.map((x) => `<li>${x}</li>`).join("")}</ul>
    ${Object.values(state.library.species)
      .map(
        (s) => `
        <h2 class="ruled">${s.common_name} <em>${s.scientific_name}</em></h2>
        <p>${s.edible_parts} ${toxLabel(s.toxicity)}</p>
        <p><strong>Soil.</strong> ${s.soil}</p>
        <p><strong>Place.</strong> ${s.placement}</p>
        <ul>${s.amendments.map((x) => `<li>${x}</li>`).join("")}</ul>
        <ul>${s.notes.map((x) => `<li>${x}</li>`).join("")}</ul>
        ${s.warnings.length ? `<ul class="danger">${s.warnings.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}
      `
      )
      .join("")}
  `;
}

function renderSettings() {
  const form = $("#station-form");
  const settings = state.garden.settings;
  fillPlaceSelect();
  form.latitude.value = settings.latitude;
  form.longitude.value = settings.longitude;
  $("#settings-place-name").value = settings.place_name;
  $("#settings-timezone").value = settings.timezone;
}

function persist() {
  RaincheckStore.save(state.garden);
}

async function refreshWeather() {
  const { latitude, longitude, timezone, place_name } = state.garden.settings;
  state.snapshot = await RaincheckWeather.fetchWeather(Number(latitude), Number(longitude), timezone);
  state.snapshot.place_name = place_name;
  const nowMs = Date.now();
  state.briefing = buildBriefing(state.snapshot, state.garden.plants, nowMs);
  state.week = weekPlan(state.snapshot, state.garden.plants, nowMs);
  renderInstall();
  renderStation();
  renderSpecimens();
  renderAdvice();
  renderSettings();
  maybeNotify(state.briefing);
}

function maybeNotify(briefing) {
  if (!briefing.needs_notification || !window.Notification || Notification.permission !== "granted") return;
  const body = briefing.summary;
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "WATERING", body });
  } else {
    new Notification("Raincheck", { body, icon: "./icon.png" });
  }
}

function saveStation(placeName, latitude, longitude) {
  state.garden.settings.place_name = placeName;
  state.garden.settings.latitude = Number(latitude);
  state.garden.settings.longitude = Number(longitude);
  persist();
  return refreshWeather();
}

$("#add-plant").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  state.garden.plants.push({
    id: `${data.species_id}-${Math.random().toString(16).slice(2, 10)}`,
    species_id: data.species_id,
    nickname: data.nickname,
    notes: data.notes || "",
    last_watered: null,
    active: true,
    weekly_need_override_mm: null,
  });
  persist();
  event.target.reset();
  await refreshWeather();
});

$("#specimens").addEventListener("click", async (event) => {
  const water = event.target.dataset.water;
  const off = event.target.dataset.off;
  const del = event.target.dataset.del;
  if (water) {
    const plant = state.garden.plants.find((p) => p.id === water);
    if (plant) plant.last_watered = new Date().toISOString();
  }
  if (off) {
    const plant = state.garden.plants.find((p) => p.id === off);
    if (plant) plant.active = plant.active === false;
  }
  if (del && confirm("Remove this plant from the roster?")) {
    state.garden.plants = state.garden.plants.filter((p) => p.id !== del);
  }
  if (water || off || del) {
    persist();
    await refreshWeather();
  }
});

$("#mark-due").addEventListener("click", async () => {
  const due = new Set(state.briefing.water.map((d) => d.plant_id));
  const stamp = new Date().toISOString();
  state.garden.plants.forEach((plant) => {
    if (due.has(plant.id)) plant.last_watered = stamp;
  });
  persist();
  await refreshWeather();
});

$("#calendar-btn").addEventListener("click", () => {
  const ics = RaincheckCalendar.buildWeekIcs(state.week, state.garden.settings.timezone);
  RaincheckCalendar.downloadIcs(ics, "raincheck.ics");
});

$("#notify-btn").addEventListener("click", async () => {
  const perm = await Notification.requestPermission();
  if (perm === "granted" && state.briefing) maybeNotify(state.briefing);
});

$("#place-select").addEventListener("change", (event) => {
  const opt = event.target.selectedOptions[0];
  if (opt && opt.dataset.lat) {
    const form = $("#station-form");
    form.latitude.value = opt.dataset.lat;
    form.longitude.value = opt.dataset.lon;
  }
});

$("#station-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const select = $("#place-select");
  const place =
    select.value === "custom" ? $("#place-search").value.trim() || "Custom station" : select.value;
  await saveStation(place, form.latitude.value, form.longitude.value);
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
      if (!results.length) {
        box.hidden = false;
        box.innerHTML = "<p class='hint'>No towns matched. Try a fuller name or type coordinates.</p>";
        return;
      }
      box.hidden = false;
      box.innerHTML = results
        .map(
          (r) =>
            `<button type="button" class="place-hit" data-name="${r.label}" data-lat="${r.lat}" data-lon="${r.lon}">${r.label}</button>`
        )
        .join("");
    } catch (err) {
      box.hidden = false;
      box.innerHTML = `<p class="danger">${err.message}</p>`;
    }
  }, 280);
});

$("#place-results").addEventListener("click", async (event) => {
  const btn = event.target.closest(".place-hit");
  if (!btn) return;
  $("#place-search").value = btn.dataset.name;
  $("#place-results").hidden = true;
  await saveStation(btn.dataset.name, btn.dataset.lat, btn.dataset.lon);
});

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.garden.settings.place_name = $("#settings-place-name").value;
  state.garden.settings.timezone = $("#settings-timezone").value || "America/New_York";
  persist();
  await refreshWeather();
});

$("#reset-garden").addEventListener("click", async () => {
  if (!confirm("Replace your plant list with the original Hobe Sound roster?")) return;
  const settings = { ...state.garden.settings };
  state.garden = RaincheckStore.reset(state.library);
  state.garden.settings = { ...state.garden.settings, ...settings };
  persist();
  await refreshWeather();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

async function boot() {
  const response = await fetch("./library.json");
  if (!response.ok) throw new Error("Could not load plant library");
  state.library = await response.json();
  state.garden = RaincheckStore.load(state.library);
  await refreshWeather();
}

boot().catch((err) => {
  $("#summary").textContent = `Could not load station: ${err.message}`;
});
