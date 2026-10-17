/* clean.js: one text cleaner for names and labels from saves, imports and ghost codes.
 * Strips control characters, the soft hyphen, the Arabic letter mark, zero-width and
 * bidi/RTL controls, collapses whitespace and caps the length. */
(function (global) {
  "use strict";

  const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;

  function text(v, max, fallback = "") {
    if (typeof v !== "string" && typeof v !== "number") return fallback;
    const s = String(v).replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, max);
    return s || fallback;
  }
  /** Character and ghost names: 80 characters at most. */
  const name = (v, fallback, max = 80) => text(v, max, fallback);

  const Clean = { text, name, INVISIBLE };
  global.Clean = Clean;
  if (typeof module !== "undefined" && module.exports) module.exports = Clean;
})(typeof window !== "undefined" ? window : globalThis);
