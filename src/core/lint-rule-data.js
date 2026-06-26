export const REQUIRED_COLUMNS = {
  "armor.txt": ["code"],
  "cubemain.txt": ["description", "enabled", "numinputs", "input 1", "output", "op", "param", "value"],
  "itemstatcost.txt": ["stat"],
  "itemtypes.txt": ["code"],
  "misc.txt": ["code"],
  "missiles.txt": ["missile", "range"],
  "properties.txt": ["code"],
  "setitems.txt": ["index"],
  "treasureclassex.txt": ["treasure class", "picks", "item1", "prob1"],
  "uniqueitems.txt": ["index"],
  "weapons.txt": ["code"]
};

export const DUPLICATE_KEYS = {
  "armor.txt": ["code"],
  "itemstatcost.txt": ["stat"],
  "itemtypes.txt": ["code"],
  "levels.txt": ["id"],
  "lvlprest.txt": ["def"],
  "lvltypes.txt": ["name"],
  "lvlwarp.txt": ["name"],
  "missiles.txt": ["missile"],
  "misc.txt": ["code"],
  "monai.txt": ["ai"],
  "monmode.txt": ["code", "name"],
  "monplace.txt": ["code"],
  "monsounds.txt": ["id"],
  "monstats.txt": ["id"],
  "monstats2.txt": ["id"],
  "monumod.txt": ["uniquemod", "id"],
  "npc.txt": ["npc"],
  "objects.txt": ["class"],
  "overlay.txt": ["overlay"],
  "pettype.txt": ["pet type"],
  "properties.txt": ["code"],
  "shrines.txt": ["name"],
  "skills.txt": ["skill"],
  "states.txt": ["state"],
  "superuniques.txt": ["superunique"],
  "treasureclassex.txt": ["treasure class"],
  "weapons.txt": ["code"]
};

export const PROFILE_ACCEPTED_COLUMNS = {
  RotW: {
    "charstats.txt": ["twohandedoffhandrestrictitemtype", "twohandeddamageasonehanded"],
    "levels.txt": ["completiontotalroomsoverride"],
    "monpet.txt": [
      "calc1", "calc2", "calc3", "calc4", "calc5",
      "boundstat1", "boundcalc1",
      "boundstat2", "boundcalc2",
      "boundstat3", "boundcalc3",
      "boundstat4", "boundcalc4",
      "boundstat5", "boundcalc5"
    ],
    "soundenviron.txt": ["inheritenvironment", "inheritenvrionment"]
  }
};

export const PROFILE_NON_STANDARD_COLUMNS = {
  "2.4": {
    "charstats.txt": ["twohandedoffhandrestrictitemtype", "twohandeddamageasonehanded"],
    "levels.txt": ["completiontotalroomsoverride"]
  }
};

export const VERSION_CHECKS = [
  ["armor.txt", "name", "version"],
  ["misc.txt", "name", "version"],
  ["weapons.txt", "name", "version"],
  ["magicprefix.txt", "name", "version"],
  ["magicsuffix.txt", "name", "version"],
  ["monumod.txt", "uniquemod", "version"],
  ["overlay.txt", "overlay", "version"],
  ["rareprefix.txt", "name", "version"],
  ["raresuffix.txt", "name", "version"],
  ["sets.txt", "index", "version"],
  ["uniqueitems.txt", "index", "version"],
  ["itemratio.txt", "function", "version"]
];

export const BOOLEAN_FIELDS = {
  "misc.txt": ["autobelt", "multibuy"],
  "monstats.txt": ["enabled", "rangedtype", "placespawn", "setboss", "bossxfer", "isspawn", "ismelee", "npc", "zoo", "cannotdesecrate"],
  "states.txt": ["remhit", "nosend", "transform", "aura", "curable", "curse", "active", "restrict", "notondead", "canstack"],
  "superuniques.txt": ["autopos", "stacks", "replaceable"],
  "weapons.txt": ["1or2handed", "2handed"]
};

const TREASURE_PROBABILITY_BOUNDS = Object.fromEntries(
  Array.from({ length: 10 }, (_, index) => [`prob${index + 1}`, [0, Number.POSITIVE_INFINITY]])
);

export const NUMERIC_BOUNDS = {
  "treasureclassex.txt": {
    picks: [-1024, 1024],
    unique: [0, 1024],
    set: [0, 1024],
    rare: [0, 1024],
    magic: [0, 1024],
    level: [0, 125],
    "group": [0, Number.POSITIVE_INFINITY],
    ...TREASURE_PROBABILITY_BOUNDS
  },
  "itemstatcost.txt": {
    op: [0, 13]
  },
  "levels.txt": {
    intensity: [0, 128]
  },
  "missiles.txt": {
    pcltdofunc: [0, 76]
  },
  "monstats.txt": {
    velocity: [0, 20],
    run: [0, 20]
  }
};

export const PROFILE_NUMERIC_BOUNDS = {
  RotW: {
    "missiles.txt": {
      pcltdofunc: [0, 77]
    }
  }
};
