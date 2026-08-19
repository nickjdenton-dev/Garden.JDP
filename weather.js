(function (root) {
  const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
  const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

  function zoneOffset(timeZone, at) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      year: "numeric",
    }).formatToParts(at);
    const name = (parts.find((part) => part.type === "timeZoneName") || {}).value || "GMT";
    if (name === "GMT" || name === "UTC") return "+00:00";
    return name.replace("GMT", "").replace("UTC", "") || "+00:00";
  }

  function parseWallTime(iso, timeZone) {
    const naive = iso.length === 16 ? `${iso}:00` : iso;
    const probe = new Date(`${naive}Z`);
    let offset = zoneOffset(timeZone, probe);
    if (!offset.startsWith("+") && !offset.startsWith("-")) offset = `+${offset}`;
    if (/^[+-]\d$/.test(offset)) offset = `${offset[0]}0${offset.slice(1)}:00`;
    if (/^[+-]\d{2}$/.test(offset)) offset = `${offset}:00`;
    return new Date(`${naive}${offset}`);
  }

  function wmoText(code, library) {
    if (code == null) return "Unknown";
    return (library.wmo && library.wmo[String(code)]) || `Code ${code}`;
  }

  async function fetchWeather(latitude, longitude, timezone) {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      timezone,
      past_days: "7",
      forecast_days: "7",
      current: "temperature_2m,relative_humidity_2m,weather_code,precipitation",
      hourly: "precipitation,precipitation_probability,temperature_2m,relative_humidity_2m",
      daily:
        "precipitation_sum,precipitation_hours,et0_fao_evapotranspiration,temperature_2m_max,weather_code",
    });
    const response = await fetch(`${OPEN_METEO}?${params}`);
    if (!response.ok) throw new Error("Weather fetch failed");
    const payload = await response.json();
    return parseForecast(payload, latitude, longitude, timezone);
  }

  function parseForecast(payload, latitude, longitude, timezone) {
    const current = payload.current || {};
    const hourly = payload.hourly || {};
    const daily = payload.daily || {};
    const hours = [];
    const times = hourly.time || [];
    const precips = hourly.precipitation || [];
    const temps = hourly.temperature_2m || [];
    const hums = hourly.relative_humidity_2m || [];
    const probs = hourly.precipitation_probability || [];
    for (let i = 0; i < times.length; i += 1) {
      const time = parseWallTime(times[i], timezone);
      hours.push({
        time,
        timeMs: time.getTime(),
        precip_mm: Number(precips[i] || 0),
        temp_c: temps[i] == null ? null : Number(temps[i]),
        humidity: hums[i] == null ? null : Number(hums[i]),
        precip_prob: probs[i] == null ? null : Number(probs[i]),
      });
    }
    const days = [];
    const dates = daily.time || [];
    for (let i = 0; i < dates.length; i += 1) {
      days.push({
        date: dates[i],
        precip_sum_mm: Number((daily.precipitation_sum || [])[i] || 0),
        precip_hours: Number((daily.precipitation_hours || [])[i] || 0),
        et0_mm: Number((daily.et0_fao_evapotranspiration || [])[i] || 0),
        temp_max_c: (daily.temperature_2m_max || [])[i] == null ? null : Number(daily.temperature_2m_max[i]),
        weather_code: (daily.weather_code || [])[i] == null ? null : Number(daily.weather_code[i]),
      });
    }
    const fetched = current.time ? parseWallTime(current.time, timezone) : new Date();
    return {
      latitude,
      longitude,
      timezone,
      fetched_at: fetched,
      current_temp_c: current.temperature_2m == null ? null : Number(current.temperature_2m),
      current_humidity: current.relative_humidity_2m == null ? null : Number(current.relative_humidity_2m),
      current_weather_code: current.weather_code == null ? null : Number(current.weather_code),
      hourly: hours,
      daily: days,
    };
  }

  async function searchPlaces(query) {
    const needle = query.trim();
    if (needle.length < 2) return [];
    const params = new URLSearchParams({
      name: needle,
      count: "8",
      language: "en",
      format: "json",
    });
    const response = await fetch(`${GEOCODE}?${params}`);
    if (!response.ok) throw new Error("Place search failed");
    const payload = await response.json();
    const results = (payload.results || []).map((row) => {
      const name = row.name || needle;
      const admin = row.admin1 || "";
      const country = row.country || "";
      const label = [name, admin, country].filter(Boolean).join(", ");
      return {
        name,
        label,
        admin1: admin,
        country,
        lat: Number(row.latitude),
        lon: Number(row.longitude),
      };
    });
    results.sort((a, b) => rank(a, needle) - rank(b, needle) || a.label.localeCompare(b.label));
    return results;
  }

  function rank(item, needle) {
    const label = item.label.toLowerCase();
    const q = needle.toLowerCase();
    const florida = label.includes("florida") ? 0 : 1;
    const exact = item.name.toLowerCase() === q ? 0 : 1;
    const us = item.country === "United States" ? 0 : 1;
    return florida * 100 + exact * 10 + us;
  }

  root.RaincheckWeather = {
    fetchWeather,
    parseForecast,
    searchPlaces,
    wmoText,
    parseWallTime,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
