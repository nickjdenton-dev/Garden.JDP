(function (root) {
  function mark(inner) {
    return (
      `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      inner +
      `</svg>`
    );
  }

  const GLYPHS = {
    "dwarf-banana": mark(
      `<path d="M24 42 V22"/>
       <path d="M24 24 C16 20 10 14 8 8"/>
       <path d="M24 23 C18 18 16 10 18 4"/>
       <path d="M24 23 C30 18 32 10 30 4"/>
       <path d="M24 24 C32 20 38 14 40 8"/>
       <path d="M24 26 C20 28 16 32 14 38"/>
       <path d="M24 26 C28 28 32 32 34 38"/>`
    ),
    "mona-lisa-banana": mark(
      `<path d="M24 41 V24"/>
       <path d="M24 25 C17 22 12 16 11 10"/>
       <path d="M24 24 C20 18 19 12 21 7"/>
       <path d="M24 24 C28 18 29 12 27 7"/>
       <path d="M24 25 C31 22 36 16 37 10"/>
       <path d="M22 30 C20 33 18 36 18 39"/>
       <path d="M24 30 C24 33 24 36 24 39"/>
       <path d="M26 30 C28 33 30 36 30 39"/>`
    ),
    passionflower: mark(
      `<circle cx="24" cy="22" r="4.5"/>
       <circle cx="24" cy="22" r="10"/>
       <path d="M24 12 V8 M24 32 V36 M14 22 H10 M34 22 H38"/>
       <path d="M17 15 L14 11 M31 15 L34 11 M17 29 L14 33 M31 29 L34 33"/>
       <path d="M24 22 L21 16 M24 22 L27 16 M24 22 L24 30"/>
       <path d="M18 40 C22 36 26 36 30 40"/>`
    ),
    vanilla: mark(
      `<path d="M12 40 C16 32 18 24 20 14"/>
       <path d="M20 22 C24 18 30 16 36 18"/>
       <path d="M16 30 C20 28 22 32 20 34"/>
       <path d="M18 24 C22 22 24 26 22 28"/>
       <path d="M28 16 C30 12 34 11 36 14 C38 11 42 13 40 17 C42 19 40 23 36 22 C32 24 28 20 28 16 Z"/>
       <circle cx="36" cy="17" r="1.4" fill="currentColor" stroke="none"/>`
    ),
    mulberry: mark(
      `<path d="M24 42 V26"/>
       <path d="M14 28 C14 16 34 16 34 28 C34 34 24 38 24 38 C24 38 14 34 14 28 Z"/>
       <circle cx="18" cy="26" r="2.1"/>
       <circle cx="24" cy="24" r="2.1"/>
       <circle cx="30" cy="26" r="2.1"/>
       <circle cx="21" cy="31" r="2.1"/>
       <circle cx="27" cy="31" r="2.1"/>`
    ),
    turmeric: mark(
      `<path d="M16 40 C18 34 22 32 24 26"/>
       <path d="M32 40 C30 34 26 32 24 26"/>
       <path d="M24 28 C16 24 12 16 14 8"/>
       <path d="M24 26 C20 18 22 10 26 6"/>
       <path d="M24 26 C28 18 26 10 22 6"/>
       <path d="M24 28 C32 24 36 16 34 8"/>
       <path d="M18 40 H30"/>`
    ),
    "san-pedro": mark(
      `<path d="M16 40 V16 C16 12 20 12 20 16 V40"/>
       <path d="M18 16 V40"/>
       <path d="M26 40 V10 C26 6 30 6 30 10 V40"/>
       <path d="M28 10 V40"/>
       <path d="M34 40 V20 C34 16 38 16 38 20 V40"/>
       <path d="M36 20 V40"/>
       <path d="M14 40 H40"/>`
    ),
    loofah: mark(
      `<path d="M10 38 C18 30 28 18 38 10"/>
       <path d="M22 28 C26 24 30 26 28 30"/>
       <path d="M30 20 C34 16 38 18 36 22"/>
       <ellipse cx="18" cy="18" rx="4" ry="9" transform="rotate(-28 18 18)"/>
       <ellipse cx="32" cy="32" rx="3.5" ry="8" transform="rotate(-28 32 32)"/>`
    ),
    "deadly-nightshade": mark(
      `<path d="M24 42 V26"/>
       <path d="M24 30 C16 26 12 20 16 14"/>
       <path d="M24 28 C32 24 36 18 32 12"/>
       <path d="M16 16 C14 12 18 8 22 12 C20 16 16 18 16 16 Z"/>
       <path d="M32 14 C30 10 34 6 38 10 C36 14 32 16 32 14 Z"/>
       <circle cx="20" cy="34" r="3.2"/>
       <circle cx="28" cy="36" r="2.6"/>`
    ),
    "butterfly-pea": mark(
      `<path d="M12 40 C18 32 22 24 24 14"/>
       <path d="M24 22 C18 16 14 18 16 24 C20 26 24 24 24 22 Z"/>
       <path d="M24 22 C30 16 34 18 32 24 C28 26 24 24 24 22 Z"/>
       <path d="M24 22 C22 26 22 32 24 36 C26 32 26 26 24 22 Z"/>
       <path d="M20 18 C22 12 26 12 28 18"/>
       <circle cx="24" cy="22" r="1.5" fill="currentColor" stroke="none"/>`
    ),
  };

  const fallback = mark(
    `<circle cx="24" cy="24" r="10"/>
     <path d="M24 34 V42"/>
     <path d="M18 20 C20 14 24 12 24 12 C24 12 28 14 30 20"/>`
  );

  function svg(speciesId) {
    return GLYPHS[speciesId] || fallback;
  }

  root.RaincheckGlyphs = { svg, all: GLYPHS };
})(typeof globalThis !== "undefined" ? globalThis : window);
