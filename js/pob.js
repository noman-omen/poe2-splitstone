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

  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined")
      throw new PobError("This browser cannot decompress build codes (no DecompressionStream).");
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
      return await new Response(stream).text();
    } catch (_) { throw new PobError("The code could not be decompressed. Is it complete?"); }
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
    const setEl = activeSet && skillsEl.querySelector(`SkillSet[id="${activeSet}"]`);
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

  global.PoB = { decode, PobError };
})(window);
