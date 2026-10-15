// Gear & gem checkpoints along the campaign (universal + per basic class).
// Each entry: { kind, short, text, sources[], uncertain? }
// kind: weapon | gem | support | vendor | craft | respec | spirit | tip
// short = glanceable label in zone list / now bar (keep ≤28 chars).
window.GEAR_CHECKPOINTS = {
  meta: {
    patch: "0.5.5",
    disclaimer: "Campaign gear/gem timing defaults. Not a full build guide — class picks refine skill/support choices. Labelled uncertain when guides disagree or area data is thin.",
    sources: {
      malura: "Malura 0.5.5 speed route (XP / vendor / lvl-16 weapon / gem pickups)",
      campaign: "Local data/campaign.js route objectives & tips",
      maxroll: "https://maxroll.gg/poe2/getting-started/comprehensive-league-start-leveling-guide",
      monk_route: "Monk Hollow Palm route notes (Maxroll Manni / GuyThatDies / Havoc)",
      merc_gtd: "https://mobalytics.gg/poe-2/builds/mercenary-grenades-leaguestarter",
      warrior_lund: "https://mobalytics.gg/poe-2/builds/warrior-league-start-lundburgerr",
      warrior_game8: "https://game8.co/games/Path-of-Exile-2/archives/572625",
      spark_vault: "https://www.poe-vault.com/poe2/sorceress/stormweaver/spark-leveling-build",
      game8_list: "https://game8.co/games/Path-of-Exile-2/archives/512964",
    },
  },
};

(function () {
  const S = (kind, short, text, sources, extra) =>
    Object.assign({ kind, short, text, sources: sources || ["malura"] }, extra || {});

  // —— Universal (every class) ————————————————
  const shared = {
    "act1-01": [
      S("weapon", "Starter weapon", "Equip the Riverbank starter weapon; grab large chests on the way into town.", ["campaign", "malura"]),
    ],
    "act1-02": [
      S("gem", "1st skill gem", "Renly: first Uncut Skill Gem — cut your class clear skill (see class notes).", ["campaign", "malura"]),
      S("vendor", "Town vendor", "Sell junk; check Renly for a usable magic weapon if Riverbank drops were poor.", ["malura"]),
    ],
    "act1-03": [
      S("gem", "Campsite gem", "Mysterious Campsite: guaranteed Uncut Skill Gem (often a second skill / exposure tool).", ["malura", "campaign"]),
    ],
    "act1-04": [
      S("support", "Areagne support", "Areagne's hut: Uncut Support Gem — socket onto your main skill.", ["malura", "campaign"]),
      S("vendor", "Weapon check", "No usable Red Vale weapon later: buy magic flat/% phys (lightning ideal) and transmute good whites from here on.", ["malura"]),
    ],
    "act1-05": [
      S("gem", "Rust King gem", "Rust King: Lv3 Uncut Skill Gem — level your main skill.", ["campaign"]),
      S("weapon", "Weapon racks", "Click weapon racks (Refined Arms): reliable bases for your class weapon type.", ["malura"], { uncertain: true }),
    ],
    "act1-09": [
      S("tip", "Rings / gloves", "Cemetery loot: Iron Ring and flat-damage gloves/rings are big attack upgrades after the weapon.", ["malura"], { uncertain: true }),
    ],
    "act1-12": [
      S("gem", "Lachlann gem", "Lachlann: Lv3 Uncut Skill Gem — upgrade a secondary or main skill.", ["campaign"]),
    ],
    "act1-13": [
      S("gem", "Crowbell gem", "Crowbell often drops a Lv3 gem (mobility / utility skill on many guides).", ["malura"], { uncertain: true }),
    ],
    "act1-14": [
      S("spirit", "Gembloom Spirit", "King in the Mists: Gembloom / Spirit gem — first Herald (or aura) for clear.", ["campaign", "malura"]),
    ],
    "act1-15": [
      S("vendor", "Lvl 10 weapons", "Around level 10: check Finn/Una vendors for new weapon bases and a Greater Life flask.", ["malura", "campaign"]),
      S("craft", "Charm slot", "Finn: pick a Charm (elemental res for the next big check).", ["campaign"]),
    ],
    "act1-17": [
      S("craft", "Save for lvl 16", "Smithing Tools + Blank Rune + Artificer's Orb: save the rune/orb for the level-16 weapon craft.", ["malura", "campaign"]),
      S("support", "Executioner support", "Executioner area: Uncut Support Gem for your main setup.", ["malura"], { uncertain: true }),
    ],
    "act1-18": [
      S("gem", "Leitis Lv5 gem", "Leitis: Lv5 Uncut Skill Gem — often your first big skill upgrade or a gem you save for lvl 14.", ["campaign", "malura"]),
      S("craft", "Renly hand-in", "Hand Smithing Tools to Renly; trade Blank Rune for a Lesser Rune (keep Artificer's for lvl 16).", ["malura"]),
    ],
    "act1-20": [
      S("tip", "Geonor ready", "Fight Geonor at character 14 when possible (gem level 5 needs char 14). Sapphire charm if cold-res short.", ["campaign", "malura"]),
    ],
    "act2-01": [
      S("gem", "Zarka skill gem", "After Rathbreaker: Zarka Uncut Skill Gem in the caravan.", ["campaign"]),
      S("vendor", "Sell + vendor", "Sell inventory before the desert; check caravan vendors.", ["malura"]),
    ],
    "act2-03": [
      S("craft", "Lvl 16 weapon", "At level 16: craft your campaign weapon (transmute → augment → …; socket Lesser Runes + Artificer's).", ["malura", "maxroll"]),
    ],
    "act2-08": [
      S("gem", "Zarka Lv7 gem", "Zarka: Lv7 Uncut Skill Gem after Halani Gates.", ["campaign"]),
    ],
    "act2-21": [
      S("respec", "1st Ascendancy", "Trial of the Sekhemas (Lv28 Barya from Deshar is the common plan) — pick ascendancy; respec tree if the guide swaps.", ["malura", "campaign"]),
    ],
    "act3-02": [
      S("vendor", "Oswald shop", "Oswald opens — check weapons/armour; Servi for caster bases later.", ["campaign", "malura"]),
    ],
    "act3-11": [
      S("spirit", "Gemrot Spirit", "Ignagduk: Gemrot Skull / +30 Spirit — second Spirit gem / Herald upgrade.", ["campaign"]),
    ],
    "act3-13": [
      S("respec", "2nd Ascendancy", "Trial of Chaos (Chimeral Ultimatum) — second ascendancy points.", ["campaign"]),
    ],
    "act3-16": [
      S("craft", "Reforging Bench", "Mektul → Hammer of Kamasa to Oswald unlocks the Reforging Bench.", ["campaign"]),
    ],
    "act4-01": [
      S("vendor", "Kingsmarch gear", "Before sailing: sell junk, check Kingsmarch vendors for ~lvl 40–42 weapon/armour upgrades.", ["campaign", "malura"], { uncertain: true }),
    ],
    "act4-02": [
      S("support", "Beast Pen support", "Optional Beast Pen: Uncut Support Gem Lv4. Blind Beast: Greater Blank Rune.", ["campaign"]),
    ],
    "act4-03": [
      S("weapon", "Weapon piece 1/3", "Krutog (or free Matiki): Tavakai weapon piece 1/3 — track all three before Arastas.", ["campaign"]),
      S("tip", "Nest ring", "Optional Nest: Ruby/Topaz Ring if your fire/lightning res is soft.", ["campaign"], { uncertain: true }),
    ],
    "act4-05": [
      S("gem", "Tujen skill gem", "After Omniphobia: Tujen Uncut Skill Gem + Mist-shrouded Tome (+2 passives).", ["campaign"]),
      S("vendor", "Mid-Act4 vendor", "Around here: refresh weapon if DPS stalled — island content is dense.", ["malura"], { uncertain: true }),
    ],
    "act4-06": [
      S("craft", "Goddess flask", "Optional Goddess of Justice: +30% life or mana flask recovery (swappable).", ["campaign"]),
    ],
    "act4-07": [
      S("weapon", "Weapon piece 2/3", "The Prisoner (or Matiki): weapon piece 2/3.", ["campaign"]),
    ],
    "act4-08": [
      S("weapon", "Weapon piece 3/3", "Scourge of the Skies (or Matiki): final weapon piece — Arastas unlocks after all three.", ["campaign"]),
    ],
    "act4-09": [
      S("tip", "Shark Fin", "Great White One → Shark Fin for Kaimana's permanent Lesson after Tavakai.", ["campaign"]),
      S("support", "Crabshell support", "Optional Crabshell Cavern: Uncut Support Gem.", ["campaign"]),
    ],
    "act4-10": [
      S("craft", "Humming Pearl", "Optional Diamora: Humming Pearl → Rog Pearlescent Amulet (all res) — strong campaign neck.", ["campaign"]),
    ],
    "act4-11": [
      S("spirit", "Waterfall Spirit", "Eye of Hinekora: Spirit Gem in the waterfall chest; Silent Hall +5% max mana.", ["campaign"]),
    ],
    "act4-12": [
      S("craft", "Halls tattoos", "3 permanent tattoos: each +5% fire/cold/lightning res OR +5 Str/Int/Dex — pick for your softest check.", ["campaign"]),
    ],
    "act4-13": [
      S("tip", "Hinekora tattoo", "Navali: Tattoo of Hinekora (+2 passive points).", ["campaign"]),
    ],
    "act4-14": [
      S("weapon", "Pieces → Arastas", "Confirm all 3 weapon pieces before Makoru sails to Arastas.", ["campaign"]),
      S("tip", "Ange hideout", "Optional Ange: claim hideout before the siege push.", ["campaign"]),
    ],
    "act4-15": [
      S("craft", "Verisium Anvil", "Runeseeker Expedition → Farrow / Verisium Anvil in hideout (crafting bench upgrade).", ["campaign"]),
    ],
    "act4-16": [
      S("tip", "Arastas bells", "Optional bells: 3 Exalted + 3 Regal — nice currency spike before Benedictus.", ["campaign"]),
      S("vendor", "Pre-Tavakai gear", "Last big vendor pass before Ngakanu: weapon + res for Tavakai (~46–48).", ["malura"], { uncertain: true }),
    ],
    "act4-19": [
      S("tip", "Tavakai fight", "Final Act 4 boss — bring flask charges and a sapphire/topaz charm if ele-res soft.", ["campaign"], { uncertain: true }),
    ],
    "act4-20": [
      S("craft", "Kaimana Lesson", "Shark Fin → Kaimana: permanent Lesson (Kaom's or Rakiata's). Interludes unlock after Hooded One.", ["campaign"]),
    ],

    // —— Interlude 2 · part 1 ——
    "interludes-01": [
      S("vendor", "Bazaar gear", "Khari Bazaar (~50): refresh weapon/armour before the desert stretch.", ["campaign", "malura"], { uncertain: true }),
    ],
    "interludes-02": [
      S("craft", "+5% max life", "Skullmaw: Molten One's Gift — permanent +5% maximum life.", ["campaign"]),
    ],
    "interludes-04": [
      S("tip", "+2 passives", "Akthi & Anundr → Risu Book of Specialisation (+2 passives).", ["campaign"]),
    ],

    // —— Interlude 3 ——
    "interludes-06": [
      S("gem", "Monument gem", "Optional Ancient Monument: Uncut Skill Gem ~Lv14.", ["campaign"]),
    ],
    "interludes-07": [
      S("spirit", "+40 Spirit", "Lythara: Gemcrust Skull (+40 Spirit) + Uncut Spirit Gem ~Lv14 — big aura/Herald upgrade.", ["campaign"]),
    ],
    "interludes-08": [
      S("tip", "Icy Tusks +2", "Abominable Yeti → Hilda Book of Specialisation (+2 passives).", ["campaign"]),
    ],
    "interludes-10": [
      S("tip", "Free Unique", "Elder Madox: pick one Unique — favour a weapon or res/life chest if still on rares.", ["campaign"], { uncertain: true }),
    ],

    // —— Interlude 2 · part 2 ——
    "interludes-13": [
      S("tip", "Barya wishes", "Optional Elzarah: rare ring/amulet/jewel wishes — fill res holes.", ["campaign"], { uncertain: true }),
    ],
    "interludes-15": [
      S("craft", "Qimah Boon", "Seven Pillars boon (swappable): Tabana +5% all ele res is the safe campaign pick.", ["campaign"]),
    ],

    // —— Interlude 1 ——
    "interludes-17": [
      S("vendor", "Refuge / Ogham", "Interlude 1 (~57): last campaign vendor pass before maps — weapon + flasks.", ["malura"], { uncertain: true }),
    ],
    "interludes-20": [
      S("craft", "Greater Runes", "Optional Soul of the Ferryman: Greater Runes (~2000g) for endgame sockets.", ["campaign"]),
    ],
    "interludes-21": [
      S("tip", "Warden +2", "Oswin: Warden's Ledger (+2 passive points).", ["campaign"]),
    ],
    "interludes-24": [
      S("tip", "Siege Book +2", "Hooded One: Book of Specialisation (+2) before Oriath / maps.", ["campaign"]),
    ],
    "interludes-25": [
      S("tip", "Maps next", "Ziggurat Map Device — campaign complete; roll first maps with your Act 4 / Interlude gear.", ["campaign"]),
    ],
  };

  // —— Class overlays (short glanceables; details stay in class_notes) ——
  const byClass = {
    warrior: {
      "act1-02": [S("gem", "→ Rolling Slam", "Cut Renly gem into Rolling Slam (often keep gem level 1 for stun setup).", ["warrior_lund", "warrior_game8"])],
      "act1-03": [S("gem", "→ Boneshatter", "Campsite → Boneshatter; Mud Burrow Devourer upgrades Slam + Impact Shockwave support.", ["warrior_game8"])],
      "act1-18": [S("gem", "→ Perfect Strike", "Leitis Lv5 → Perfect Strike for Geonor (Window of Opportunity when you can).", ["warrior_lund"])],
      "act2-01": [S("weapon", "Mace / shield", "Keep upgrading mace; Shield Wall becomes main clear ~22.", ["warrior_lund"], { uncertain: true })],
      "act2-03": [S("craft", "Mace at 16", "Level-16 craft: best two-hand or one-hand mace base you can afford.", ["warrior_lund", "malura"], { uncertain: true })],
    },
    sorceress: {
      "act1-01": [S("gem", "Keep Spark", "Riverbank Spark is your main projectile — don't vendor it.", ["spark_vault"])],
      "act1-02": [S("gem", "→ Frost Bomb", "Renly → Frost Bomb (Exposure + Cold Infusions for Spark).", ["spark_vault"])],
      "act1-05": [S("gem", "→ Orb of Storms", "Rust King → Orb of Storms for boss DPS.", ["spark_vault"])],
      "act2-03": [S("craft", "Staff / wand 16", "Level-16 craft: staff or wand with spell/flat elemental; Servi-style bases later in Act 3.", ["spark_vault", "malura"], { uncertain: true })],
    },
    ranger: {
      "act1-02": [S("gem", "Bow clear skill", "Renly → Ice Shot (cold) or your poison clear — guides vary.", ["game8_list"], { uncertain: true })],
      "act1-04": [S("support", "Multishot / Pierce", "Areagne support → Multishot I or Pierce on the main bow skill.", ["game8_list"], { uncertain: true })],
      "act2-03": [S("craft", "Bow at 16", "Level-16 craft: highest DPS bow base; flat elemental / % phys.", ["malura", "maxroll"], { uncertain: true })],
    },
    monk: {
      "act1-02": [S("gem", "→ Glacial Cascade", "Renly → Glacial Cascade until Ice Strike at 14.", ["monk_route"])],
      "act1-03": [S("gem", "→ Frost Bomb + Locus", "Campsite Frost Bomb; Mud Burrow → Frozen Locus + Concentrated Area on Cascade.", ["monk_route"])],
      "act1-07": [S("weapon", "Talisman / Pounce", "Chain-link Talisman on weapon set 2 → Pounce mobility (~33g at Renly).", ["monk_route", "malura"])],
      "act1-18": [S("gem", "Save Lv5 gem", "Leitis Lv5: often SAVE for Ice Strike at character 14 (Manni).", ["monk_route"])],
      "act1-19": [S("respec", "Hollow Palm ~13", "Allocate Hollow Palm Technique ~13; unequip staff unless it's clearly stronger.", ["monk_route"])],
      "act2-03": [S("craft", "Skip staff craft?", "Hollow Palm monks may skip a heavy lvl-16 staff and stack Evasion/ES armour instead.", ["monk_route"], { uncertain: true })],
    },
    mercenary: {
      "act1-02": [S("gem", "→ Explosive Grenade", "Renly → Explosive Grenade.", ["merc_gtd"])],
      "act1-12": [S("gem", "→ Flash Grenade", "Lachlann → Flash Grenade.", ["merc_gtd"])],
      "act1-18": [S("gem", "Upgrade Explosive", "Leitis Lv5: priority Explosive > Flash.", ["merc_gtd"])],
      "act1-20": [S("gem", "→ Gas Grenade", "Gas Grenade around level 14 for clear (guide timing varies).", ["merc_gtd"], { uncertain: true })],
      "act2-01": [S("weapon", "Save for crossbow", "Bank currency for a strong Act 2 crossbow — biggest Merc gear spike.", ["merc_gtd"])],
      "act2-03": [S("craft", "Crossbow at 16", "Level-16 craft / buy: best crossbow you can fund.", ["merc_gtd", "malura"])],
    },
    witch: {
      "act1-02": [S("gem", "Contagion or Spark", "Renly → Contagion (chaos) or Spark (caster plan) — pick one lane early.", ["game8_list", "spark_vault"], { uncertain: true })],
      "act1-03": [S("gem", "Exposure tool", "Campsite → Frost Bomb if you went Spark/Contagion without Exposure yet.", ["spark_vault"])],
      "act2-03": [S("craft", "Caster weapon 16", "Level-16 craft: staff/wand; minion witches still want +level / spirit-friendly sticks.", ["game8_list", "malura"], { uncertain: true })],
    },
  };

  window.GEAR_CHECKPOINTS.shared = shared;
  window.GEAR_CHECKPOINTS.byClass = byClass;
})();
