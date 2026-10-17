/* pob.js: decode a Path of Building 2 export code and summarise it.
 * Format: XML -> zlib deflate -> base64 with the URL-safe alphabet (-_).
 * Decompression uses the browser's native DecompressionStream("deflate"),
 * which handles zlib-wrapped data, so no third-party library is needed. */
(function (global) {
  "use strict";

  class PobError extends Error {}

  function base64UrlToBytes(code) {
    let s = code.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!s) throw new PobError("The build code is empty.");
    if (/[^A-Za-z0-9+/=]/.test(s)) {
      throw new PobError(/^https?:/i.test(code.trim())
        ? "That looks like a link. Paste the raw PoB2 export code instead (PoB2 > Import/Export > Generate)."
        : "The code contains characters that are not valid base64.");
    }
    s = s.replace(/=+$/, "");
    s += "=".repeat((4 - (s.length % 4)) % 4);
    try {
      const bin = atob(s);
      return Uint8Array.from(bin, ch => ch.charCodeAt(0));
    } catch (_) { throw new PobError("The code is not valid base64."); }
  }

  const MAX_COMPRESSED = 512 * 1024;       // 512 KiB compressed
  const MAX_DECOMPRESSED = 4 * 1024 * 1024; // 4 MiB decompressed

  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined")
      throw new PobError("This browser cannot decompress build codes (no DecompressionStream).");
    if (bytes.length > MAX_COMPRESSED)
      throw new PobError("Build code is too large to decompress safely.");
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
      const reader = stream.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_DECOMPRESSED) {
          try { await reader.cancel(); } catch (_) {}
          throw new PobError("Build expands past the safe size limit.");
        }
        chunks.push(value);
      }
      return new TextDecoder("utf-8").decode(await new Blob(chunks).arrayBuffer());
    } catch (e) {
      if (e instanceof PobError) throw e;
      throw new PobError("The code could not be decompressed. Is it complete?");
    }
  }

  const attr = (el, name) => (el && el.getAttribute(name)) || "";

  /** Turn PoB XML into the small summary object the character panel shows. */
  function summarise(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new PobError("Decoded data is not valid XML.");
    const root = doc.documentElement;
    if (!/^PathOfBuilding/.test(root.nodeName)) throw new PobError("Decoded XML is not a Path of Building build.");
    const build = root.querySelector("Build");
    if (!build) throw new PobError("The build has no <Build> section.");

    // Skills: use the active skill set if there is one, otherwise all skills.
    const skillsEl = root.querySelector("Skills");
    const activeSet = attr(skillsEl, "activeSkillSet");
    const setEl = activeSet && skillsEl && Array.from(skillsEl.querySelectorAll("SkillSet"))
      .find(el => attr(el, "id") === activeSet);
    const skills = Array.from((setEl || skillsEl || root).querySelectorAll("Skill"));
    const mainIdx = parseInt(attr(build, "mainSocketGroup"), 10) - 1;
    const groups = skills.filter(s => attr(s, "enabled") !== "false").map((s, i) => {
      const gems = Array.from(s.querySelectorAll("Gem")).filter(g => attr(g, "enabled") !== "false");
      const isSupport = g => /^Support/.test(attr(g, "skillId")) || /Support/.test(attr(g, "gemId"));
      const name = g => attr(g, "nameSpec") || attr(g, "skillId") || "Unknown gem";
      return {
        actives: gems.filter(g => !isSupport(g)).map(g => `${name(g)} (${attr(g, "level") || "?"})`),
        supports: gems.filter(isSupport).map(name),
        main: skills.indexOf(s) === mainIdx,
        dps: attr(s, "includeInFullDPS") === "true",
        label: attr(s, "label"),
      };
    }).filter(g => g.actives.length);
    // Main skills first, then those counted in full DPS.
    groups.sort((a, b) => (b.main - a.main) || (b.dps - a.dps));

    const stats = {};
    root.querySelectorAll("Build > PlayerStat").forEach(p => { stats[attr(p, "stat")] = attr(p, "value"); });
    const spec = root.querySelector("Tree > Spec");
    const nodes = attr(spec, "nodes");

    return {
      className: attr(build, "className") || "Unknown",
      ascendancy: attr(build, "ascendClassName") && attr(build, "ascendClassName") !== "None"
        ? attr(build, "ascendClassName") : "",
      level: attr(build, "level") || "?",
      version: attr(build, "targetVersion"),
      skills: groups.slice(0, 8),
      passives: nodes ? nodes.split(",").filter(Boolean).length : 0,
      items: root.querySelectorAll("Items > Item").length,
      stats: ["Life", "EnergyShield", "Mana", "Spirit", "CombinedDPS"]
        .filter(k => stats[k]).map(k => [k, Math.round(parseFloat(stats[k])).toLocaleString()]),
      notes: (root.querySelector("Notes")?.textContent || "").trim().slice(0, 600),
      imported: new Date().toISOString(),
    };
  }

  async function decode(code) {
    const xml = await inflate(base64UrlToBytes(String(code || "")));
    return summarise(xml);
  }

  /** "Smith of Kitava", "smith-of-kitava" and "Witch Hunter" all compare equal to the in-game spelling. */
  const key = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

  /**
   * The basic class (and ascendancy, by its in-game name) for an imported build, from the class list in
   * data/class_notes.js. The class name wins; an ascendancy (or an alias such as Abyssal Lich) finds its class
   * when PoB names only that. Null when nothing matches.
   */
  function classFor(build, classes) {
    if (!build) return null;
    const list = Array.isArray(classes) ? classes : [];
    const ascOf = c => {
      const want = key(build.ascendancy);
      if (!want) return "";
      const alias = Object.entries(c.ascendancyAliases || {}).find(([a]) => key(a) === want);
      return alias ? alias[1] : (c.ascendancies || []).find(a => key(a) === want) || "";
    };
    const cls = list.find(c => key(c.name) === key(build.className)) || list.find(c => ascOf(c));
    return cls ? { cls, ascendancy: ascOf(cls) } : null;
  }

  global.PoB = { decode, inflate, base64UrlToBytes, classFor, PobError, MAX_COMPRESSED, MAX_DECOMPRESSED };
})(window);
