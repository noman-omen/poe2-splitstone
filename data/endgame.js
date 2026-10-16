/*
 * Endgame reference data: atlas milestones and waystone tiers.
 * Edit this file to refresh for a new patch; the app reads it as-is.
 *
 * verified: true  = confirmed in GGG patch notes or poe2db/poe2wiki.
 * verified: false = from community guides only; shown with a "?" in the app.
 */
(function (global) {
  "use strict";
  const ENDGAME = {
    patch: "0.5.5",
    checked: "2026-10-16",
    sources: [
      "https://www.pathofexile.com/forum/view-thread/3932540 (0.5.0 patch notes)",
      "https://www.pathofexile.com/forum/view-thread/4000864 (0.5.5 patch notes)",
      "https://poe2db.tw/us/",
      "https://www.poe2wiki.net/wiki/Atlas_Passive_Tree",
    ],
    // Waystone tier from area level: T1 = 65 ... T11 = 75 ... T16 = 80.
    tierOffset: 64,
    groups: [
      { id: "fortress", name: "Fortress (Origins of Divinity)" },
      { id: "fortress-side", name: "Storyline steps" },
      { id: "pinnacles", name: "Pinnacle bosses" },
      { id: "masters", name: "Atlas masters" },
      { id: "atlas", name: "Atlas points" },
    ],
    milestones: [
      { id: "first-map", group: "fortress", name: "Clear your first map from the Ziggurat", verified: true },
      { id: "first-tower", group: "fortress", name: "Complete a Precursor Tower (the Fortress rises)", verified: true },
      { id: "ancient-gateway", group: "fortress", name: "Ancient Gateway", verified: true },
      { id: "eastern-gateway", group: "fortress", name: "Eastern Gateway", verified: true },
      { id: "western-gateway", group: "fortress", name: "Western Gateway", verified: true },
      { id: "enigma-east", group: "fortress", name: "Eastern Enigma Chamber (Crisis Fragment)", verified: true },
      { id: "enigma-west", group: "fortress", name: "Western Enigma Chamber (Crisis Fragment)", verified: true },
      { id: "arbiter-ash", group: "fortress", name: "Arbiter of Ash at the Burning Monolith (3 Crisis Fragments: Ancient, Faded, Weathered)", verified: true },
      { id: "matriarch-halls", group: "fortress", name: "Matriarch Halls: Phya, Sentinel of the Cradle (Origin Cradle, T15)", verified: false },
      { id: "patriarch-halls", group: "fortress", name: "Patriarch Halls: Phyx, Sentinel of the Spark (Origin Spark, T15)", verified: false },
      { id: "arbiter-divinity", group: "fortress", name: "Arbiter of Divinity at the Origin Tower", verified: true },
      { id: "arbiter-divinity-5", group: "fortress", name: "Arbiter of Divinity killed 5 times (Fortress complete)", verified: true },
      { id: "king-in-the-mists", group: "fortress-side", name: "King in the Mists (Ritual mid-chain; his head opens the Rite of the Nameless)", verified: true },

      { id: "xesht", group: "pinnacles", name: "Xesht (Breach, key from Tul & Esh)", verified: true },
      { id: "kulemak", group: "pinnacles", name: "Vessel of Kulemak (Abyss, Well of Souls)", verified: true },
      { id: "tangmazu", group: "pinnacles", name: "Tangmazu, the Raven Trickster (Delirium)", verified: true },
      { id: "bodach", group: "pinnacles", name: "The Bodach (Ritual, after the Rite of the Nameless)", verified: true },
      { id: "atziri", group: "pinnacles", name: "Atziri, Queen of the Vaal (Fate of the Vaal)", verified: false },
      { id: "aberration", group: "pinnacles", name: "The Aberration (Expedition; Olroth drops the key)", verified: true },

      { id: "master-doryani", group: "masters", name: "Unlock Doryani (clear a Corrupted Nexus)", verified: true },
      { id: "master-hilda", group: "masters", name: "Unlock Hilda (Great Beast hunt at her campsite, SW of the atlas start)", verified: true },
      { id: "master-jado", group: "masters", name: "Unlock Jado (Sealed Vault / anomaly map near the start)", verified: false },

      { id: "atlas-section-2", group: "atlas", name: "Atlas tree section 2 (after the Eastern and Western Gateways plus Arbiter of Ash; area level 70+)", verified: false },
      { id: "atlas-section-3", group: "atlas", name: "Atlas tree section 3 (after both Enigma Chambers; area level 75+)", verified: false },
      { id: "atlas-full", group: "atlas", name: "Atlas tree fully allocated", verified: true },
    ],
  };
  global.ENDGAME = ENDGAME;
  if (typeof module !== "undefined" && module.exports) module.exports = ENDGAME;
})(typeof window !== "undefined" ? window : globalThis);
