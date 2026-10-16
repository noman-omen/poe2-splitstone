/*
 * Community tools shown on the Tools tab. Links open in the system browser.
 * Keep to https URLs. Checked live on 2026-10-16.
 */
(function (global) {
  "use strict";
  const TOOLS = [
    { name: "Trade (official)", url: "https://www.pathofexile.com/trade2", desc: "GGG's PoE2 trade site and currency exchange." },
    { name: "poe2db", url: "https://poe2db.tw/us/", desc: "Datamined items, mods, bosses and patch diffs." },
    { name: "PoE2 Wiki", url: "https://www.poe2wiki.net/", desc: "Community wiki for mechanics, areas and uniques." },
    { name: "Path of Building 2", url: "https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2", desc: "Offline build planner. Download from the releases page." },
    { name: "poe.ninja builds", url: "https://poe.ninja/poe2/builds", desc: "What the ladder is playing, by class and skill." },
    { name: "poe.ninja economy", url: "https://poe.ninja/poe2/economy", desc: "Currency and item prices for the current league." },
    { name: "Craft of Exile", url: "https://www.craftofexile.com/?game=poe2", desc: "Crafting simulator and mod weights for PoE2." },
    { name: "Maxroll PoE2", url: "https://maxroll.gg/poe2", desc: "Build guides, leveling guides and tier lists." },
  ];
  global.TOOLS = TOOLS;
  if (typeof module !== "undefined" && module.exports) module.exports = TOOLS;
})(typeof window !== "undefined" ? window : globalThis);
