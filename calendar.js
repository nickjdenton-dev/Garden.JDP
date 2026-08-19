(function (root) {
  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function stampUTC(date) {
    return (
      `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T` +
      `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
    );
  }

  function stampLocal(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}${map.month}${map.day}T${map.hour}${map.minute}${map.second}`;
  }

  function escapeText(text) {
    return String(text)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }

  function fold(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    let raw = bytes;
    const chunks = [];
    while (raw.length) {
      const take = chunks.length ? 74 : 75;
      let piece = raw.slice(0, take);
      while (true) {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(piece);
          chunks.push(chunks.length ? ` ${text}` : text);
          raw = raw.slice(piece.length);
          break;
        } catch {
          piece = piece.slice(0, -1);
        }
      }
    }
    return chunks.join("\r\n");
  }

  function summaryFor(decisions) {
    const water = decisions.filter((d) => d.action === "water");
    const watch = decisions.filter((d) => d.action === "watch");
    if (water.length) return "Water garden: " + water.map((d) => d.nickname).join(", ");
    if (watch.length) return "Check cactus drainage (do not water)";
    return "";
  }

  function eventLines(uid, dtstamp, startLocal, endLocal, summary, description) {
    return [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=America/New_York:${startLocal}`,
      `DTEND;TZID=America/New_York:${endLocal}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(summary)}`,
      "TRIGGER:-PT0S",
      "END:VALARM",
      "END:VEVENT",
    ];
  }

  function buildWeekIcs(days, timeZone) {
    const nowStamp = stampUTC(new Date());
    const chunks = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Raincheck//South Florida Garden//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Raincheck Garden",
      "X-WR-TIMEZONE:America/New_York",
    ];
    days.forEach((day, index) => {
      const summary = summaryFor(day.decisions);
      if (!summary) return;
      const desc = day.decisions
        .filter((d) => d.action !== "skip")
        .map((d) => `[${d.action.toUpperCase()}] ${d.nickname} — ${d.reason}`)
        .join("\n");
      const start = stampLocal(day.when, timeZone);
      const endDate = new Date(day.when.getTime() + 30 * 60 * 1000);
      const end = stampLocal(endDate, timeZone);
      chunks.push(
        ...eventLines(
          `raincheck-${day.date}-${index}@garden.local`,
          nowStamp,
          start,
          end,
          summary,
          desc
        )
      );
    });
    chunks.push("END:VCALENDAR");
    return chunks.map(fold).join("\r\n") + "\r\n";
  }

  function downloadIcs(text, filename) {
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "raincheck.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  root.RaincheckCalendar = { buildWeekIcs, downloadIcs, summaryFor };
})(typeof globalThis !== "undefined" ? globalThis : window);
