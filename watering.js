/* Raincheck watering engine — keep in lockstep with garden/watering.py */
(function (root) {
  const WET_START = [5, 1];
  const WET_END = [10, 15];

  function round1(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function isWetSeason(when, snapshot) {
    if (snapshot && snapshot.wet_season === false) return false;
    const startPair = (snapshot && snapshot.wet_start) || WET_START;
    const endPair = (snapshot && snapshot.wet_end) || WET_END;
    const key = when.month * 100 + when.day;
    const start = startPair[0] * 100 + startPair[1];
    const end = endPair[0] * 100 + endPair[1];
    if (start <= end) return start <= key && key <= end;
    return key >= start || key <= end;
  }

  function effectiveHourMm(precipMm, sprinkleThresholdMm, hourlyCapMm) {
    if (precipMm < sprinkleThresholdMm) return 0;
    return Math.min(precipMm, hourlyCapMm);
  }

  function rainInLookback(snapshot, nowMs, species) {
    const startMs = nowMs - species.lookback_hours * 3600 * 1000;
    let raw = 0;
    let effective = 0;
    let usefulHours = 0;
    for (const hour of snapshot.hourly) {
      if (hour.timeMs >= startMs && hour.timeMs < nowMs) {
        raw += hour.precip_mm;
        const useful = effectiveHourMm(
          hour.precip_mm,
          species.sprinkle_threshold_mm,
          species.hourly_cap_mm
        );
        effective += useful;
        if (useful > 0) usefulHours += 1;
      }
    }
    return { effective, raw, usefulHours };
  }

  function todayForecast(snapshot, dateIso) {
    return snapshot.daily.find((day) => day.date === dateIso) || null;
  }

  function rainProbabilityToday(snapshot, nowMs) {
    const end = nowMs + 24 * 3600 * 1000;
    const probs = snapshot.hourly
      .filter((hour) => hour.timeMs >= nowMs && hour.timeMs < end && hour.precip_prob != null)
      .map((hour) => hour.precip_prob);
    if (!probs.length) return null;
    return Math.max(...probs);
  }

  function daysSince(lastMs, nowMs) {
    if (lastMs == null) return null;
    return (nowMs - lastMs) / 86400000;
  }

  function decisionRecord(plant, species, fields) {
    return {
      plant_id: plant.id,
      nickname: plant.nickname,
      species_id: plant.species_id,
      scientific_name: species.scientific_name,
      apply_label: species.water_method,
      lookback_hours: species.lookback_hours,
      toxicity: species.toxicity,
      climate_fit: species.climate_fit,
      water_method: species.water_method,
      ...fields,
    };
  }

  function partsInZone(nowMs, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateIso = fmt.format(new Date(nowMs));
    const [year, month, day] = dateIso.split("-").map(Number);
    return { year, month, day, dateIso };
  }

  function decideOne(plant, snapshot, nowMs, speciesMap) {
    const species = speciesMap[plant.species_id];
    const now = partsInZone(nowMs, snapshot.timezone);
    let weekly = plant.weekly_need_override_mm || species.weekly_need_mm;
    if ((species.dormant_months || []).includes(now.month)) {
      weekly *= species.dormant_factor;
    }

    const { effective, raw, usefulHours } = rainInLookback(snapshot, nowMs, species);
    const forecast = todayForecast(snapshot, now.dateIso);
    const forecastMm = forecast ? forecast.precip_sum_mm : 0;
    const forecastHours = forecast ? forecast.precip_hours : 0;
    const rainProb = rainProbabilityToday(snapshot, nowMs);
    const since = daysSince(plant.last_watered_ms, nowMs);
    const wet = isWetSeason(now, snapshot);
    const cycleDays = Math.max(species.lookback_hours / 24, 1);
    const needInWindow = weekly * (cycleDays / 7);
    let remaining = Math.max(0, needInWindow - effective);
    let applyLabel = species.water_method;
    let urgency = "normal";
    let action = "water";
    let reason = "";
    let applyMm = remaining;

    const finish = (extra) =>
      decisionRecord(plant, species, {
        action,
        reason: reason.trim(),
        apply_mm: round1(applyMm),
        apply_label: applyLabel,
        rain_effective_mm: round1(effective),
        rain_raw_mm: round1(raw),
        rain_hours: usefulHours,
        urgency,
        ...extra,
      });

    if (species.overwater_sensitive && wet) {
      const boneDry =
        since != null && since >= species.max_interval_days && effective < species.skip_if_rain_mm;
      if (!boneDry) {
        action = "watch";
        applyMm = 0;
        urgency = "low";
        reason =
          `Wet season. Do not add water. Useful rain in the last ${species.lookback_hours} h: ${effective.toFixed(1)} mm ` +
          `(raw ${raw.toFixed(1)} mm). Check that pots drain and that the base is not sitting in a saucer.`;
        return finish();
      }
    }

    if (species.overwater_sensitive && effective >= species.skip_if_rain_mm) {
      action = "skip";
      applyMm = 0;
      urgency = "low";
      reason = `${effective.toFixed(1)} mm of useful rain already landed in the last ${species.lookback_hours} h. Extra water risks rot.`;
    } else if (effective >= species.skip_if_rain_mm && usefulHours >= 1) {
      action = "skip";
      applyMm = 0;
      urgency = "low";
      reason = `Rain covered this cycle: ${effective.toFixed(1)} mm useful (${raw.toFixed(1)} mm raw over ${usefulHours.toFixed(0)} h).`;
    } else if (
      forecastMm >= species.skip_if_rain_mm &&
      (rainProb == null || rainProb >= 50) &&
      forecastHours >= 1 &&
      !(since != null && since >= species.max_interval_days)
    ) {
      action = "skip";
      applyMm = 0;
      urgency = "low";
      reason = `Forecast ${forecastMm.toFixed(1)} mm over about ${forecastHours.toFixed(0)} h today. Wait for the sky instead of watering.`;
    } else if (since != null && since < species.min_interval_days) {
      action = "skip";
      applyMm = 0;
      urgency = "low";
      reason = `Last watered ${since.toFixed(1)} days ago; minimum interval is ${species.min_interval_days.toFixed(1)} days.`;
    } else if (remaining <= 0.5 && effective > 0) {
      action = "skip";
      applyMm = 0;
      urgency = "low";
      reason = `Useful rain (${effective.toFixed(1)} mm) already met the ${needInWindow.toFixed(1)} mm need for this window.`;
    } else {
      let sprinkleNote = "";
      if (raw > 0 && effective + 0.05 < raw) {
        sprinkleNote =
          ` Raw rain was ${raw.toFixed(1)} mm but only ${effective.toFixed(1)} mm counted — short sprinkles evaporate on hot sand.`;
      }
      if (since == null || since >= species.max_interval_days) urgency = "high";
      else if (remaining >= needInWindow * 0.75) urgency = "high";
      action = "water";
      applyMm = round1(Math.max(remaining, urgency === "high" ? weekly / 7 : remaining));
      if (species.overwater_sensitive) {
        applyMm = Math.min(applyMm, 8);
        applyLabel = species.water_method;
      }
      reason =
        `Not enough useful rain in the last ${species.lookback_hours} h (${effective.toFixed(1)} mm vs ~${needInWindow.toFixed(0)} mm needed).` +
        `${sprinkleNote} ${applyLabel.charAt(0).toUpperCase()}${applyLabel.slice(1)} about ${applyMm.toFixed(0)} mm.`;
    }

    return finish({ apply_label: applyLabel });
  }

  function decideAll(plants, snapshot, nowMs, speciesMap) {
    const order = { water: 0, watch: 1, skip: 2 };
    const urgencyOrder = { high: 0, normal: 1, low: 2 };
    return plants
      .filter((plant) => plant.active !== false)
      .map((plant) => decideOne(plant, snapshot, nowMs, speciesMap))
      .sort(
        (a, b) =>
          order[a.action] - order[b.action] ||
          urgencyOrder[a.urgency] - urgencyOrder[b.urgency] ||
          a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase())
      );
  }

  function briefingSummary(decisions) {
    const water = decisions.filter((d) => d.action === "water");
    const watch = decisions.filter((d) => d.action === "watch");
    if (!water.length && !watch.length) return "Rain covered the garden. No watering today.";
    const bits = [];
    if (water.length) bits.push("Water: " + water.map((d) => d.nickname).join(", ") + ".");
    if (watch.length) bits.push("Check drainage (do not water): " + watch.map((d) => d.nickname).join(", ") + ".");
    return bits.join(" ");
  }

  root.RaincheckWatering = {
    isWetSeason,
    effectiveHourMm,
    decideOne,
    decideAll,
    briefingSummary,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
