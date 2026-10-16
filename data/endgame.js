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
      "https://poe2db.tw/us/",
      "https://www.poe2wiki.net/wiki/Atlas_Passive_Tree",
    ],
    // Waystone tier from area level: T1 = 65 ... T11 = 75 ... T16 = 80.
    tierOffset: 64,
    groups: [
      { id: "fortress", name: "Fortress (Origins of Divinity)" },
      { id: "pinnacles", name: "Pinnacle bosses" },
      { id: "masters", name: "Atlas masters" },
      { id: "atlas", name: "Atlas points" },
    ],
    milestones: [
      { id: "first-map", group: "fortress", name: "Clear your first map from the Ziggurat", verified: true },
      { id: "first-tower", group: "fortress", name: "Complete a Precursor Tower (the Fortress rises)", verified: true },
      { id: "ancient-gateway", group: "fortress", name: "Ancient Gateway", verified: true },
      { id: "enigma-east", group: "fortress", name: "Eastern Enigma Chamber (Crisis Fragment)", verified: true },
      { id: "enigma-west", group: "fortress", name: "Western Enigma Chamber (Crisis Fragment)", verified: true },
      { id: "arbiter-ash", group: "fortress", name: "Arbiter of Ash at the Burning Monolith", verified: true },
      { id: "matriarch-halls", group: "fortress", name: "Matriarch Halls (Origin Cradle, T15)", verified: true },
      { id: "patriarch-halls", group: "fortress", name: "Patriarch Halls (Origin Spark, T15)", verified: true },
      { id: "arbiter-divinity", group: "fortress", name: "Arbiter of Divinity at the Origin Tower", verified: true },
      { id: "arbiter-divinity-5", group: "fortress", name: "Arbiter of Divinity killed 5 times (Fortress complete)", verified: true },

      { id: "xesht", group: "pinnacles", name: "Xesht (Breach, key from Tul & Esh)", verified: true },
      { id: "kulemak", group: "pinnacles", name: "Vessel of Kulemak (Abyss, Well of Souls)", verified: true },
      { id: "tangmazu", group: "pinnacles", name: "Tangmazu, the Raven Trickster (Delirium)", verified: true },
      { id: "king-in-the-mists", group: "pinnacles", name: "King in the Mists (Ritual)", verified: true },
      { id: "bodach", group: "pinnacles", name: "The Bodach (Ritual, after the Rite of the Nameless)", verified: false },
      { id: "atziri", group: "pinnacles", name: "Atziri, Queen of the Vaal (Fate of the Vaal)", verified: true },
      { id: "olroth", group: "pinnacles", name: "Olroth, last Runes of Aldur faction leader (league pinnacle key)", verified: true },

      { id: "master-doryani", group: "masters", name: "Unlock Doryani (Corruption Nexus)", verified: false },
      { id: "master-hilda", group: "masters", name: "Unlock Hilda (Great Beast hunt)", verified: false },
      { id: "master-jado", group: "masters", name: "Unlock Jado (Sealed Vault)", verified: false },

      { id: "atlas-section-2", group: "atlas", name: "Atlas tree section 2 (after the Gateways and Arbiter of Ash)", verified: false },
      { id: "atlas-section-3", group: "atlas", name: "Atlas tree section 3 (after the Enigma Chambers)", verified: false },
      { id: "atlas-full", group: "atlas", name: "Atlas tree fully allocated", verified: true },
    ],
  };
  global.ENDGAME = ENDGAME;
  if (typeof module !== "undefined" && module.exports) module.exports = ENDGAME;
})(typeof window !== "undefined" ? window : globalThis);
