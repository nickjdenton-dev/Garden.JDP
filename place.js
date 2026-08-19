const RaincheckPlace = (() => {
  const LOCAL_RE = /florida|uf\/ifas|miami limestone|hobe sound|south florida/i;
  const HARDINESS = {
    "dwarf-banana": { min: 9, max: 12, form: "tender" },
    "mona-lisa-banana": { min: 9, max: 12, form: "tender" },
    "passionflower": { min: 9, max: 12, form: "tender" },
    vanilla: { min: 10, max: 12, form: "tender" },
    mulberry: { min: 5, max: 10, form: "woody" },
    turmeric: { min: 8, max: 12, form: "tender" },
    "san-pedro": { min: 9, max: 11, form: "succulent" },
    loofah: { min: 10, max: 12, form: "annual" },
    "deadly-nightshade": { min: 5, max: 9, form: "perennial" },
    "butterfly-pea": { min: 9, max: 12, form: "annual" },
  };

  function nearby(profile, lat, lon) {
    if (!profile) return false;
    return Math.abs(profile.lat - lat) < 0.04 && Math.abs(profile.lon - lon) < 0.04;
  }

  function usdaFromMinC(minC) {
    const f = minC * (9 / 5) + 32;
    const zone = Math.max(1, Math.min(13, Math.floor((f + 60) / 10) + 1));
    const letter = (f + 60) % 10 < 5 ? "a" : "b";
    return { min_c: minC, min_f: Math.round(f), zone, letter, zone_label: `${zone}${letter}` };
  }

  function isFlorida(name, lat, lon) {
    const label = String(name || "").toLowerCase();
    if (/florida/.test(label)) return true;
    return lat >= 24.4 && lat <= 31.2 && lon >= -87.7 && lon <= -79.8;
  }

  function climateOf(name, lat, lon, zone) {
    if (isFlorida(name, lat, lon) && lat < 28.6) return "tropical";
    if (isFlorida(name, lat, lon) || (zone >= 9 && lat < 33)) return "subtropical";
    if (zone <= 5 || lat >= 45) return "cold";
    if (lat < 37 && lon <= -102 && lon >= -125) return "arid";
    return "temperate";
  }

  function fallbackSoil(name, lat, lon) {
    const label = String(name || "").toLowerCase();
    if (isFlorida(name, lat, lon) || /georgia.*coast|gulf/.test(label)) {
      return {
        texture: "sand",
        drainage: "fast",
        label: "sandy, low organic matter",
        organic: "low",
      };
    }
    if (/virginia|carolina|maryland|piedmont|georgia/.test(label) || (lat > 33 && lat < 41 && lon > -85 && lon < -75)) {
      if (lon > -77.1) {
        return { texture: "loam", drainage: "medium", label: "coastal loam or sandy loam", organic: "medium" };
      }
      return { texture: "clay", drainage: "slow", label: "clay or clay loam", organic: "medium" };
    }
    return { texture: "loam", drainage: "medium", label: "loam", organic: "medium" };
  }

  function soilFromFractions(sand, clay) {
    if (sand == null && clay == null) return null;
    if (sand >= 70) return { texture: "sand", drainage: "fast", label: "sandy", organic: "low" };
    if (clay >= 40) return { texture: "clay", drainage: "slow", label: "clay", organic: "medium" };
    if (clay >= 27) return { texture: "clay", drainage: "slow", label: "clay loam", organic: "medium" };
    if (sand >= 50) return { texture: "loam", drainage: "medium", label: "sandy loam", organic: "medium" };
    return { texture: "loam", drainage: "medium", label: "loam", organic: "medium" };
  }

  function guessZoneFromLat(lat) {
    const zone = Math.max(4, Math.min(11, Math.round(11 - (lat - 25) / 3.2)));
    return { min_c: null, min_f: null, zone, letter: "a", zone_label: `${zone}a` };
  }

  function guess(name, lat, lon) {
    const usda = guessZoneFromLat(lat);
    if (isFlorida(name, lat, lon) && lat < 28.6) {
      usda.zone = 10;
      usda.letter = "a";
      usda.zone_label = "10a";
    }
    const climate = climateOf(name, lat, lon, usda.zone);
    const soil = fallbackSoil(name, lat, lon);
    const florida = isFlorida(name, lat, lon);
    return {
      name,
      lat,
      lon,
      florida,
      climate,
      soil,
      frost: usda.zone <= 9,
      ...usda,
      wet_season: florida,
      wet_start: florida ? [5, 1] : null,
      wet_end: florida ? [10, 15] : null,
      wet_label: florida ? "May–mid-October" : "no tropical wet season",
      fetched_at: new Date().toISOString(),
      source: "guess",
    };
  }

  async function fetchClimate(lat, lon) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      start_date: "2019-01-01",
      end_date: "2024-12-31",
      daily: "temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration",
      timezone: "auto",
    });
    const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
    if (!response.ok) throw new Error("climate");
    const data = await response.json();
    const daily = data.daily || {};
    const years = {};
    const monthP = Array(12).fill(0);
    const monthE = Array(12).fill(0);
    (daily.time || []).forEach((stamp, i) => {
      const year = stamp.slice(0, 4);
      const month = Number(stamp.slice(5, 7)) - 1;
      const min = daily.temperature_2m_min[i];
      if (min != null) {
        if (!years[year]) years[year] = min;
        else years[year] = Math.min(years[year], min);
      }
      monthP[month] += Number(daily.precipitation_sum[i] || 0);
      monthE[month] += Number(daily.et0_fao_evapotranspiration[i] || 0);
    });
    const annual = Object.values(years);
    if (!annual.length) throw new Error("climate");
    const meanMin = annual.reduce((a, b) => a + b, 0) / annual.length - 2;
    const nYears = annual.length;
    const wetMonths = [];
    for (let i = 0; i < 12; i += 1) {
      if (monthP[i] / nYears > (monthE[i] / nYears) * 1.15) wetMonths.push(i + 1);
    }
    return { usda: usdaFromMinC(meanMin), wetMonths, timezone: data.timezone };
  }

  async function fetchSoil(lat, lon) {
    const params = new URLSearchParams({
      lon: String(lon),
      lat: String(lat),
      property: "sand",
      property: "clay",
      depth: "5-15cm",
      value: "mean",
    });
    const response = await fetch(`https://rest.isric.org/soilgrids/v2.0/properties/query?${params}`);
    if (!response.ok) return null;
    const data = await response.json();
    const layers = (data.properties && data.properties.layers) || [];
    const read = (name) => {
      const layer = layers.find((row) => row.name === name);
      const raw = layer && layer.depths && layer.depths[0] && layer.depths[0].values && layer.depths[0].values.mean;
      if (raw == null) return null;
      const factor = (layer.unit_measure && layer.unit_measure.d_factor) || 10;
      return raw / factor;
    };
    return soilFromFractions(read("sand"), read("clay"));
  }

  function wrapWetSeason(months) {
    if (!months.length) return { wet_season: false, wet_start: null, wet_end: null, wet_label: "no tropical wet season" };
    const set = new Set(months);
    let best = [];
    for (let start = 1; start <= 12; start += 1) {
      if (!set.has(start) || set.has(start === 1 ? 12 : start - 1)) continue;
      const run = [];
      for (let step = 0; step < 12; step += 1) {
        const month = ((start - 1 + step) % 12) + 1;
        if (!set.has(month)) break;
        run.push(month);
      }
      if (run.length > best.length) best = run;
    }
    if (best.length < 2) {
      return { wet_season: false, wet_start: null, wet_end: null, wet_label: "no tropical wet season" };
    }
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return {
      wet_season: true,
      wet_start: [best[0], 1],
      wet_end: [best[best.length - 1], 28],
      wet_label: `${names[best[0] - 1]}–${names[best[best.length - 1] - 1]}`,
    };
  }

  async function profile(name, lat, lon) {
    const base = guess(name, lat, lon);
    try {
      const [climate, soil] = await Promise.all([fetchClimate(lat, lon).catch(() => null), fetchSoil(lat, lon).catch(() => null)]);
      if (climate) {
        Object.assign(base, climate.usda);
        base.frost = base.zone <= 9;
        base.climate = climateOf(name, lat, lon, base.zone);
        if (base.florida) {
          base.wet_season = true;
          base.wet_start = [5, 1];
          base.wet_end = [10, 15];
          base.wet_label = "May–mid-October";
        } else {
          Object.assign(base, wrapWetSeason(climate.wetMonths || []));
        }
        if (climate.timezone) base.timezone = climate.timezone;
      }
      if (soil) base.soil = soil;
      base.source = climate ? "climate" : "guess";
      base.fetched_at = new Date().toISOString();
    } catch {
      /* guess is enough to stop Florida copy leaking */
    }
    return base;
  }

  function locked(text) {
    return LOCAL_RE.test(String(text || ""));
  }

  function keepGeneric(items) {
    return (items || []).filter((row) => row && !locked(row));
  }

  function hardinessOf(species) {
    if (HARDINESS[species.id]) return HARDINESS[species.id];
    const blob = [species.id, species.common_name, species.scientific_name, species.family, species.group, species.extract]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (/cact|succulent|agave|opuntia|crassula|echeveria|kalanchoe|adenium/.test(blob) || species.overwater_sensitive) {
      return { min: 9, max: 11, form: "succulent" };
    }
    if (/musaceae|banana|mango|papaya|coconut|vanilla|zingiber|turmeric|plumeria|annona|carica/.test(blob)) {
      return { min: 9, max: 12, form: "tender" };
    }
    if (/citrus|rutaceae/.test(blob)) return { min: 9, max: 11, form: "tender" };
    if (/tomato|pepper|capsicum|luffa|loofah|basil|okra|cucumber|zucchini|eggplant/.test(blob)) {
      return { min: 10, max: 12, form: "annual" };
    }
    if (/brassica|kale|collard|cabbage/.test(blob)) return { min: 6, max: 11, form: "annual" };
    if (/malus|apple|pyrus|prunus|cherry|pear|plum/.test(blob)) return { min: 4, max: 8, form: "woody" };
    if (/atropa|belladonna|digitalis|foxglove/.test(blob)) return { min: 5, max: 9, form: "perennial" };
    if (species.group === "Vegetable" || species.group === "Herb") return { min: 7, max: 11, form: "annual" };
    return { min: 7, max: 11, form: "perennial" };
  }

  function sunLine(species, place) {
    const raw = locked(species.sun) ? "" : species.sun;
    if (raw) return raw;
    if (place.climate === "tropical" || place.climate === "subtropical") {
      if (/vanilla|turmeric|atropa|fern|orchid/.test(`${species.id} ${species.common_name} ${species.family}`.toLowerCase())) {
        return "Morning sun, afternoon shade. Airflow after storms.";
      }
      return "Full sun. Light shade is tolerated.";
    }
    if (place.climate === "temperate" || place.climate === "cold") {
      return "Full sun in the growing season. Give winter light if you overwinter it indoors.";
    }
    return "Full sun, sharp drainage.";
  }

  function soilLine(species, place) {
    const succulent = hardinessOf(species).form === "succulent" || species.overwater_sensitive;
    const sand = place.soil.texture === "sand";
    const clay = place.soil.texture === "clay";
    if (succulent) {
      if (clay) return `Local soil is ${place.soil.label}. Use a mineral pot or a raised grit mound — clay holds winter wet and rots cactus.`;
      if (sand) return `Local soil is ${place.soil.label}. That drainage is a gift for cactus; still skip organic-rich beds.`;
      return `Local soil is ${place.soil.label}. Plant on a slope or in grit so the collar dries.`;
    }
    if (sand) return `Local soil is ${place.soil.label}. Compost and mulch are how you hold water. Do not expect native sand to feed a banana or tomato.`;
    if (clay) return `Local soil is ${place.soil.label}. Compost opens it. Raise the crown on wet weeks. Do not add sand as a “fix.”`;
    return `Local soil is ${place.soil.label}. Compost and mulch; water to the plant, not a calendar.`;
  }

  function placementLine(species, place) {
    const form = hardinessOf(species).form;
    const toxic = species.toxicity === "high" || species.toxicity === "bioactive";
    const bits = [];
    if (toxic) bits.push("Isolated, labeled, off the food path.");
    if (form === "tender" && place.frost) bits.push("Not a year-round outdoor plant here. Pot it, or plan to lose it to frost.");
    if (form === "succulent" && place.soil.drainage === "slow") bits.push("Hottest, fastest-draining spot, or a pot under an eave.");
    if (form === "annual") bits.push("In the ground after frost, or start in a pot.");
    if (!bits.length && species.placement && !locked(species.placement)) return species.placement;
    return bits.join(" ");
  }

  function climateLine(species, place) {
    const hard = hardinessOf(species);
    const zone = place.zone;
    if (hard.form === "annual") {
      if (place.frost) return `Seasonal here (USDA ${place.zone_label}). Plant after frost; frost ends the crop.`;
      return `Long season here (USDA ${place.zone_label}). You can often keep it going most of the year.`;
    }
    if (hard.form === "tender") {
      if (zone < hard.min) {
        return `Tender tropical (about zone ${hard.min}–${hard.max}). USDA ${place.zone_label} will frost it. Overwinter indoors or treat as a summer annual.`;
      }
      return `Fits this climate (USDA ${place.zone_label}).`;
    }
    if (hard.form === "succulent") {
      if (zone < hard.min) {
        return `Wants a dry, barely-frost climate (about zone ${hard.min}+). USDA ${place.zone_label}: protect from freeze and from winter wet.`;
      }
      if (place.florida) return `Fair here: the wet season is the danger, not drought.`;
      return `USDA ${place.zone_label}. Cold is one risk; wet ${place.soil.label} is the other.`;
    }
    if (zone > hard.max) {
      return `A cool-climate plant (about zone ${hard.min}–${hard.max}). USDA ${place.zone_label} heat and wet can make it sulk. Pot, shade, and drainage help.`;
    }
    if (zone < hard.min) {
      return `Woody/perennial range is about zone ${hard.min}–${hard.max}. USDA ${place.zone_label} is cold for it — mulch, or grow in a pot.`;
    }
    return `Fits USDA ${place.zone_label}.`;
  }

  function notesFor(species, place) {
    const hard = hardinessOf(species);
    const notes = [];
    notes.push(climateLine(species, place));
    if (place.florida) {
      keepGeneric(species.notes).forEach((row) => notes.push(row));
      (species.notes || []).filter((row) => locked(row)).forEach((row) => notes.push(row));
    } else {
      keepGeneric(species.notes).forEach((row) => notes.push(row));
      if (hard.form === "tender" && place.frost) {
        notes.push(`${place.name || "This town"} gets frost. Do not follow frost-free in-ground calendars for this plant.`);
      }
      if (hard.form === "succulent") {
        notes.push(
          place.wet_season
            ? `Wet stretch here is ${place.wet_label}. That is when you refuse extra water and check drainage.`
            : "No tropical wet season here. Summer drought can still want a deep soak; winter wet is the rot risk."
        );
      } else if (place.wet_season) {
        notes.push(`Local wet stretch ${place.wet_label}: rain often covers a watering. Dry stretches still need a soak.`);
      } else {
        notes.push("Water to rain and the pot, not a tropical wet-season calendar.");
      }
      if (place.soil.texture === "clay" && (hard.form === "tender" || species.weekly_need_mm >= 24)) {
        notes.push("Clay holds water. Mulch, but do not leave the crown in a puddle after a nor’easter or summer storm.");
      }
      if (place.soil.texture === "sand") {
        notes.push("Sand dries fast. Mulch thickly on food plants; check rainless afternoons.");
      }
    }
    return [...new Set(notes.filter(Boolean))];
  }

  function amendmentsFor(species, place) {
    if (place.florida) {
      const local = species.amendments || [];
      if (local.length) return local;
    }
    const rows = [];
    const hard = hardinessOf(species);
    if (hard.form === "succulent") {
      rows.push("Grit, pumice, or a cactus mix. No manure, no banana fertilizer.");
    } else if (place.soil.texture === "sand") {
      rows.push("Compost and 3 inches of mulch. That is the water-holding amendment.");
      if ((species.common_name || "").toLowerCase().includes("banana")) rows.push("Potassium-forward feed. Bananas are potassium hogs.");
    } else if (place.soil.texture === "clay") {
      rows.push("Compost every season. Raised bed or mound if the plant hates wet feet.");
      rows.push("Skip dumping sand into clay. Skip extra lime or chelates unless a soil test says so.");
    } else {
      rows.push("Compost and mulch. Feed only if the plant is a heavy cropper.");
    }
    return rows;
  }

  function warningsFor(species, place) {
    const rows = keepGeneric(species.warnings || []);
    if (place.florida) (species.warnings || []).filter((row) => locked(row)).forEach((row) => rows.push(row));
    if (species.toxicity === "high") rows.push("High toxicity. Isolated pot, label, not on a food path.");
    if (species.toxicity === "bioactive") rows.push("Bioactive. Ornamental only. Do not ingest from garden advice in this app.");
    return [...new Set(rows)];
  }

  function advice(species, place) {
    const here = place || guess("", 27.06, -80.14);
    return {
      here: `USDA ${here.zone_label} · ${here.soil.label}${here.frost ? " · frost" : ""}`,
      climate_fit: climateLine(species, here),
      soil: soilLine(species, here),
      sun: sunLine(species, here),
      placement: placementLine(species, here),
      notes: notesFor(species, here),
      amendments: amendmentsFor(species, here),
      warnings: warningsFor(species, here),
    };
  }

  return { nearby, guess, profile, advice, locked, isFlorida };
})();
