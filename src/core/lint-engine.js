const PROFILE_OPTIONS = ["RotW", "2.4"];
const DEFAULT_PROFILE = "RotW";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const LINT_RULE_GROUPS = [
  {
    group: "Basic",
    rules: [
      rule("Basic/NoDuplicateExcel", "No duplicate Excel IDs", true),
      rule("Basic/ExcelColumns", "Required Excel columns", true),
      rule("Basic/LinkedExcel", "Linked Excel references", true),
      rule("Basic/MissileRangeFieldSemantics", "Missile range field semantics", true, true, ["2.4"]),
      rule("Basic/MonstatsDesecratedTreasureClassSemantics", "Desecrated treasure class semantics", true, true, ["2.4"]),
      rule("Basic/MonEquipLevelOrder", "Monster equipment level order", true, true, ["2.4"]),
      rule("Basic/StringCheck", "String references", true),
      rule("Basic/NumericBounds", "Numeric bounds", true),
      rule("Basic/BooleanFields", "Boolean fields", true)
    ]
  },
  {
    group: "Cube",
    rules: [
      rule("Cube/ValidInputs", "Valid cube inputs", true),
      rule("Cube/ValidOutputs", "Valid cube outputs", true),
      rule("Cube/ValidOp", "Valid cube op", true)
    ]
  },
  {
    group: "Items",
    rules: [
      rule("Items/ValidSockets", "Valid sockets", true),
      rule("Items/NoIllegalGambling", "No illegal gambling", true),
      rule("Items/ValidStatParameters", "Valid stat parameters", true)
    ]
  },
  {
    group: "Level",
    rules: [
      rule("Level/ValidWarp", "Valid warps", true),
      rule("Level/ValidWPs", "Valid waypoints", true)
    ]
  },
  { group: "Monsters", rules: [rule("Monsters/ValidChains", "Valid monster chains", true)] },
  { group: "Skills", rules: [rule("Skills/EqualSkills", "Equal skills", true)] },
  { group: "String", rules: [rule("String/NoUntranslated", "No untranslated strings", true)] },
  {
    group: "TC",
    rules: [
      rule("TC/ValidTreasure", "Valid treasure references", true),
      rule("TC/ValidNegativePicks", "Valid negative picks", true),
      rule("TC/ValidProbs", "Valid probabilities", true)
    ]
  }
];

export const LINT_RULES = LINT_RULE_GROUPS.flatMap((group) =>
  group.rules.map((entry) => ({ ...entry, group: group.group }))
);

const IMPLEMENTED_RUNNERS = {
  "Basic/ExcelColumns": lintExcelColumns,
  "Basic/NoDuplicateExcel": lintNoDuplicateExcel,
  "Basic/LinkedExcel": lintLinkedExcel,
  "Basic/MissileRangeFieldSemantics": lintMissileRangeFieldSemantics,
  "Basic/MonstatsDesecratedTreasureClassSemantics": lintMonstatsDesecratedTreasureClassSemantics,
  "Basic/MonEquipLevelOrder": lintMonEquipLevelOrder,
  "Basic/StringCheck": lintStringCheck,
  "Basic/NumericBounds": lintNumericBounds,
  "Basic/BooleanFields": lintBooleanFields,
  "Cube/ValidInputs": lintCubeInputs,
  "Cube/ValidOutputs": lintCubeOutputs,
  "Cube/ValidOp": lintCubeOp,
  "Items/ValidSockets": lintItemSockets,
  "Items/NoIllegalGambling": lintNoIllegalGambling,
  "Items/ValidStatParameters": lintValidStatParameters,
  "Level/ValidWarp": lintValidWarp,
  "Level/ValidWPs": lintValidWaypoints,
  "Monsters/ValidChains": lintMonsterChains,
  "Skills/EqualSkills": lintEqualSkills,
  "String/NoUntranslated": lintNoUntranslatedStrings,
  "TC/ValidTreasure": lintTreasureReferences,
  "TC/ValidNegativePicks": lintTreasureNegativePicks,
  "TC/ValidProbs": lintTreasureProbabilities
};

const REQUIRED_COLUMNS = {
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

const DUPLICATE_KEYS = {
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

const PROFILE_ACCEPTED_COLUMNS = {
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

const PROFILE_NON_STANDARD_COLUMNS = {
  "2.4": {
    "charstats.txt": ["twohandedoffhandrestrictitemtype", "twohandeddamageasonehanded"],
    "levels.txt": ["completiontotalroomsoverride"]
  }
};

const VERSION_CHECKS = [
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

const BOOLEAN_FIELDS = {
  "misc.txt": ["autobelt", "multibuy"],
  "monstats.txt": ["enabled", "rangedtype", "placespawn", "setboss", "bossxfer", "isspawn", "ismelee", "npc", "zoo", "cannotdesecrate"],
  "states.txt": ["remhit", "nosend", "transform", "aura", "curable", "curse", "active", "restrict", "notondead", "canstack"],
  "superuniques.txt": ["autopos", "stacks", "replaceable"],
  "weapons.txt": ["1or2handed", "2handed"]
};

const NUMERIC_BOUNDS = {
  "treasureclassex.txt": {
    picks: [-1024, 1024],
    unique: [0, 1024],
    set: [0, 1024],
    rare: [0, 1024],
    magic: [0, 1024],
    level: [0, 125],
    "group": [0, Number.POSITIVE_INFINITY]
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

const PROFILE_NUMERIC_BOUNDS = {
  RotW: {
    "missiles.txt": {
      pcltdofunc: [0, 77]
    }
  }
};

for (let index = 1; index <= 10; index += 1) {
  NUMERIC_BOUNDS["treasureclassex.txt"][`prob${index}`] = [0, Number.POSITIVE_INFINITY];
}

export function createDefaultLintSettings() {
  return {
    enabled: true,
    profile: DEFAULT_PROFILE,
    profiles: Object.fromEntries(PROFILE_OPTIONS.map((profile) => [profile, createDefaultProfileSettings(profile)]))
  };
}

export function normalizeLintSettings(value = {}) {
  const defaults = createDefaultLintSettings();
  const profile = PROFILE_OPTIONS.includes(value.profile) ? value.profile : defaults.profile;
  const profiles = {};
  for (const profileOption of PROFILE_OPTIONS) {
    profiles[profileOption] = { rules: {} };
    for (const entry of rulesForProfile(profileOption)) {
      const current = value.profiles?.[profileOption]?.rules?.[entry.id] ?? value.rules?.[entry.id] ?? {};
      const defaultRule = defaults.profiles[profileOption].rules[entry.id];
      profiles[profileOption].rules[entry.id] = {
        enabled: Boolean(entry.implemented && (current.enabled ?? defaultRule.enabled)),
        severity: ["error", "warning", "info"].includes(current.severity) ? current.severity : defaultRule.severity
      };
    }
  }
  return {
    enabled: value.enabled !== false,
    profile,
    profiles
  };
}

export function lintProfileOptions() {
  return [...PROFILE_OPTIONS];
}

export function rulesForProfile(profile) {
  const normalized = PROFILE_OPTIONS.includes(profile) ? profile : DEFAULT_PROFILE;
  return LINT_RULES.filter((entry) => entry.profiles.includes(normalized));
}

export function lintRuleGroupsForProfile(profile) {
  const rules = rulesForProfile(profile);
  return LINT_RULE_GROUPS.map((group) => ({
    group: group.group,
    rules: rules.filter((entry) => entry.group === group.group)
  })).filter((group) => group.rules.length);
}

export function runLint(documents, settings = createDefaultLintSettings()) {
  const normalized = normalizeLintSettings(settings);
  if (!normalized.enabled) return [];
  const docs = uniqueDocuments(documents);
  const index = buildWorkspaceIndex(docs, normalized.profile);
  return runLintWithWorkspaceIndex(index, normalized);
}

export function runLintWithWorkspaceIndex(index, settings = createDefaultLintSettings()) {
  const normalized = normalizeLintSettings(settings);
  if (!normalized.enabled) return [];
  const diagnostics = [];
  for (const entry of rulesForProfile(normalized.profile)) {
    const ruleSetting = normalized.profiles[normalized.profile]?.rules?.[entry.id];
    const runner = IMPLEMENTED_RUNNERS[entry.id];
    if (!entry.implemented || !ruleSetting?.enabled || !runner) continue;
    const before = diagnostics.length;
    runner(index, makeRuleContext(entry.id, ruleSetting.severity, diagnostics, index.profile));
    for (let i = before; i < diagnostics.length; i += 1) {
      diagnostics[i].ruleLabel = entry.label;
      diagnostics[i].group = entry.group;
    }
  }
  diagnostics.sort(compareDiagnostics);
  diagnostics.forEach((diagnostic, index) => {
    diagnostic.id = `${diagnostic.profile}:${diagnostic.ruleId}:${diagnostic.fileName}:${diagnostic.rowIndex}:${diagnostic.columnIndex}:${diagnostic.message}`;
  });
  return diagnostics;
}

function createDefaultProfileSettings(profile) {
  return {
    rules: Object.fromEntries(rulesForProfile(profile).map((entry) => [
      entry.id,
      {
        enabled: Boolean(entry.implemented && entry.defaultEnabled),
        severity: "warning"
      }
    ]))
  };
}

export function buildWorkspaceIndex(documents, profile = DEFAULT_PROFILE) {
  const tables = uniqueDocuments(documents).map(tableFromDocument).filter(Boolean);
  const tablesByName = new Map();
  for (const table of tables) tablesByName.set(table.fileName, table);
  const itemCodes = unionSets(setFromColumn(tablesByName, "armor.txt", "code"), setFromColumn(tablesByName, "misc.txt", "code"), setFromColumn(tablesByName, "weapons.txt", "code"));
  const properties = setFromColumn(tablesByName, "properties.txt", "code", { caseSensitive: true });
  const propertyGroups = setFromColumn(tablesByName, "propertygroups.txt", "code", { caseSensitive: true });
  const propertyReferenceValues = profile === "RotW" ? unionSets(properties, propertyGroups) : properties;
  return {
    profile,
    files: buildWorkspaceFileStates(
      tables.map((table) => ({ path: table.path || table.displayName, name: table.displayName })),
      tables.map((table) => table.doc)
    ),
    tables,
    tablesByName,
    columnsByFile: new Map(tables.map((table) => [table.fileKey, [...table.headers]])),
    rowLabelsByFile: new Map(tables.map((table) => [table.fileKey, rowLabelsForTable(table)])),
    hasWorkspace: tables.length > 1,
    itemCodes,
    allProperties: propertyReferenceValues,
    itemTypes: setFromColumn(tablesByName, "itemtypes.txt", "code"),
    monModes: setFromColumn(tablesByName, "monmode.txt", "code"),
    monSounds: setFromColumn(tablesByName, "monsounds.txt", "id"),
    missiles: setFromColumn(tablesByName, "missiles.txt", "missile"),
    overlays: setFromColumn(tablesByName, "overlay.txt", "overlay"),
    sounds: setFromColumn(tablesByName, "sounds.txt", "sound"),
    states: setFromColumn(tablesByName, "states.txt", "state"),
    setItems: setFromColumn(tablesByName, "setitems.txt", "index"),
    uniqueItems: setFromColumn(tablesByName, "uniqueitems.txt", "index"),
    properties,
    propertyGroups,
    itemStats: setFromColumn(tablesByName, "itemstatcost.txt", "stat"),
    skills: unionSets(setFromColumn(tablesByName, "skills.txt", "skill"), setFromColumn(tablesByName, "skills.txt", "Id")),
    skillDescs: setFromColumn(tablesByName, "skilldesc.txt", "skilldesc"),
    treasureClasses: setFromColumn(tablesByName, "treasureclassex.txt", "treasure class")
  };
}

export function buildWorkspaceFileStates(explorerFiles = [], documents = [], parseErrors = new Map()) {
  const docsByKey = new Map(uniqueDocuments(documents).map((doc) => [documentKey(doc), doc]));
  const files = new Map();
  for (const file of explorerFiles) {
    const filePath = file.path ?? file.filePath ?? file.name ?? file.fileName ?? "";
    const fileName = file.name ?? file.fileName ?? baseName(filePath);
    const key = normalizePath(filePath || fileName);
    const doc = docsByKey.get(key);
    const parseError = parseErrors instanceof Map ? parseErrors.get(key) : parseErrors?.[key];
    files.set(key, {
      filePath,
      fileName,
      listedInExplorer: true,
      openedInTab: Boolean(doc?.openedInTab),
      readForLint: Boolean(doc || parseError),
      loadedForIndex: Boolean(doc || parseError),
      parsedForLint: Boolean(doc && !parseError),
      parseError: parseError || "",
      columns: doc?.headers ?? doc?.rows?.[0] ?? [],
      rowCount: doc?.rowCount ?? doc?.rows?.length ?? 0,
      rowLabels: doc ? rowLabelsForTable(tableFromDocument(doc)) : new Map(),
      table: doc ? tableFromDocument(doc) : null
    });
  }
  for (const doc of documents) {
    const key = documentKey(doc);
    if (files.has(key)) continue;
    files.set(key, {
      filePath: doc.path ?? "",
      fileName: doc.name ?? baseName(doc.path ?? ""),
      listedInExplorer: false,
      openedInTab: Boolean(doc.openedInTab),
      readForLint: true,
      loadedForIndex: true,
      parsedForLint: true,
      parseError: "",
      columns: doc.headers ?? doc.rows?.[0] ?? [],
      rowCount: doc.rowCount ?? doc.rows?.length ?? 0,
      rowLabels: rowLabelsForTable(tableFromDocument(doc)),
      table: tableFromDocument(doc)
    });
  }
  return files;
}

export function groupDiagnosticsByCell(diagnostics) {
  const grouped = new Map();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.rowIndex}:${diagnostic.columnIndex}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(diagnostic);
  }
  return grouped;
}

export function diagnosticsForDocument(diagnostics, doc) {
  const key = documentKey(doc);
  return diagnostics.filter((diagnostic) => diagnostic.fileKey === key);
}

function lintExcelColumns(index, ctx) {
  for (const table of index.tables) {
    const required = REQUIRED_COLUMNS[table.fileName];
    if (required) {
      for (const columnName of required) {
        if (!table.hasColumn(columnName)) {
          ctx.add(table, 0, 0, `Missing required column "${columnName}".`, {
            d2rMessage: `${table.displayName} - missing column '${columnName}'`
          });
        }
      }
    }
    const accepted = acceptedColumnsForProfile(index.profile, table.fileName);
    const nonStandard = nonStandardColumnsForProfile(index.profile, table.fileName);
    for (const header of table.headers) {
      const normalized = normalizeHeader(header);
      if (accepted.has(normalized)) continue;
      if (nonStandard.has(normalized)) {
        ctx.add(table, 0, header, `Non-standard column "${header}" found.`, {
          d2rMessage: `${table.displayName} - non-standard column '${normalized}' found`
        });
      }
    }
  }
}

function lintNoDuplicateExcel(index, ctx) {
  for (const table of index.tables) {
    const keys = DUPLICATE_KEYS[table.fileName] ?? [];
    for (const key of keys) {
      if (!table.hasColumn(key)) continue;
      const column = table.columnIndex(key);
      const seen = new Map();
      for (let i = 1; i < table.rows.length; i += 1) {
        const value = clean(table.rows[i]?.[column]);
        if (!value || value === "Expansion") continue;
        const previousRows = seen.get(value);
        if (previousRows) {
          for (const previous of previousRows) {
            ctx.add(table, i, key, `Duplicate ${key} "${value}" also appears on row ${previous + 1}.`, {
              d2rMessage: `${table.displayName} - duplicate detected on lines ${previous + 1} and ${i + 1} for field '${key}' (${value})`,
              d2rSortLine: previous + 1
            });
          }
          previousRows.push(i);
        } else {
          seen.set(value, [i]);
        }
      }
    }
  }
}

function lintLinkedExcel(index, ctx) {
  const optional = { allowNull: true };
  const propertyOptional = { allowNull: true, caseSensitive: true };
  const allProperties = index.allProperties;

  for (const table of [index.tablesByName.get("armor.txt"), index.tablesByName.get("misc.txt"), index.tablesByName.get("weapons.txt")]) {
    for (const field of ["stat1", "stat2", "stat3"]) {
      mustExist(index, ctx, table, field, "code", index.itemStats, optional);
    }
  }

  for (const table of [index.tablesByName.get("magicprefix.txt"), index.tablesByName.get("magicsuffix.txt")]) {
    for (const field of numberedFields("mod", "code", 3)) {
      mustExist(index, ctx, table, field, "name", allProperties, propertyOptional);
    }
    for (const field of [...numberedFields("itype", "", 7), ...numberedFields("etype", "", 5)]) {
      mustExist(index, ctx, table, field, "name", index.itemTypes, optional);
    }
  }

  if (index.profile === "RotW") {
    const propertyGroups = index.tablesByName.get("propertygroups.txt");
    for (const field of numberedFields("prop", "", 8)) {
      mustExist(index, ctx, propertyGroups, field, "code", allProperties, propertyOptional);
    }
  }

  const setItems = index.tablesByName.get("setitems.txt");
  for (const field of [...numberedFields("prop", "", 9), ...numberedFields("aprop", "a", 5), ...numberedFields("aprop", "b", 5)]) {
    mustExist(index, ctx, setItems, field, "index", allProperties, propertyOptional);
  }

  const uniqueItems = index.tablesByName.get("uniqueitems.txt");
  for (const field of numberedFields("prop", "", 12)) {
    mustExist(index, ctx, uniqueItems, field, "index", allProperties, propertyOptional);
  }

  mustExist(index, ctx, index.tablesByName.get("missiles.txt"), "skill", "missile", index.skills, optional);

  const monStats = index.tablesByName.get("monstats.txt");
  mustExist(index, ctx, monStats, "monsound", "id", index.monSounds, optional);
  mustExist(index, ctx, monStats, "umonsound", "id", index.monSounds, optional);

  const skills = index.tablesByName.get("skills.txt");
  mustExist(index, ctx, skills, "skilldesc", "skill", index.skillDescs, optional);
  for (const field of ["srvmissile", "srvmissilea", "srvmissileb", "srvmissilec", "cltmissile", "cltmissilea", "cltmissileb", "cltmissilec", "cltmissiled"]) {
    mustExist(index, ctx, skills, field, "skill", index.missiles, optional);
  }
  validateSkillSummode(index, ctx, skills);

  requiredString(index, ctx, index.tablesByName.get("armor.txt"), "namestr", "name");
  requiredString(index, ctx, index.tablesByName.get("misc.txt"), "namestr", "name");
  requiredString(index, ctx, index.tablesByName.get("weapons.txt"), "namestr", "name");
}

function lintMissileRangeFieldSemantics(index, ctx) {
  if (index.profile !== "2.4") return;
  const table = index.tablesByName.get("missiles.txt");
  if (!table?.hasColumn("range")) return;
  table.eachRow((row) => {
    const value = clean(row.get("range"));
    if (value && !isIntegerText(value)) ctx.add(table, row.rowIndex, "range", "D2R 2.4 expects missiles.range to be a plain integer.");
  });
}

function lintMonstatsDesecratedTreasureClassSemantics(index, ctx) {
  if (index.profile !== "2.4") return;
  const table = index.tablesByName.get("monstats.txt");
  if (!table) return;
  const groups = [
    ["Normal", "treasureclassdesecrated", "treasureclassdesecratedchamp", "treasureclassdesecratedunique"],
    ["Nightmare", "treasureclassdesecrated(n)", "treasureclassdesecratedchamp(n)", "treasureclassdesecratedunique(n)"],
    ["Hell", "treasureclassdesecrated(h)", "treasureclassdesecratedchamp(h)", "treasureclassdesecratedunique(h)"]
  ];
  table.eachRow((row) => {
    for (const [label, base, champ, unique] of groups) {
      if (!table.hasColumn(base) || !table.hasColumn(champ) || !table.hasColumn(unique)) continue;
      const filled = [champ, unique].filter((columnName) => clean(row.get(columnName)));
      if (filled.length && !clean(row.get(base))) {
        ctx.add(table, row.rowIndex, base, `${filled.join(" / ")} is populated but ${base} is blank; ${label} desecrated drops require the base desecrated treasure class in 2.4.`);
      }
    }
  });
}

function lintMonEquipLevelOrder(index, ctx) {
  const table = index.tablesByName.get("monequip.txt");
  if (!table?.hasColumn("monster") || !table.hasColumn("level")) return;
  let currentMonster = "";
  let previousLevel = null;
  let previousRow = -1;
  table.eachRow((row) => {
    const monster = clean(row.get("monster"));
    if (!monster || monster === "*end*  do not remove") {
      currentMonster = "";
      previousLevel = null;
      previousRow = -1;
      return;
    }
    const rawLevel = clean(row.get("level"));
    const level = rawLevel ? integerValue(rawLevel) : 0;
    if (level === null) {
      ctx.add(table, row.rowIndex, "level", `Invalid level "${rawLevel}" for "${monster}".`);
      return;
    }
    if (monster !== currentMonster) {
      currentMonster = monster;
      previousLevel = level;
      previousRow = row.rowIndex;
      return;
    }
    if (previousLevel !== null && level > previousLevel) {
      ctx.add(table, row.rowIndex, "level", `Level ${level} for "${monster}" appears after lower level ${previousLevel} on row ${previousRow + 1}; rows for the same monster should be ordered highest to lowest.`);
    }
    previousLevel = level;
    previousRow = row.rowIndex;
  });
}

function lintStringCheck(index, ctx) {
  const seenIds = new Map();
  for (const table of index.tables.filter(isStringLikeTable)) {
    table.eachRow((row) => {
      const id = clean(row.get("id"));
      const key = clean(row.get("key")) || clean(row.get("Key"));
      if (!id || !key) return;
      const normalizedId = normalizeToken(id);
      const found = seenIds.get(normalizedId);
      if (found && normalizeToken(found.key) !== normalizeToken(key)) {
        ctx.add(table, row.rowIndex, "id", `String "${key}" shares ID "${id}" with string "${found.key}" in ${found.fileName}.`);
      } else if (!found) {
        seenIds.set(normalizedId, { key, fileName: table.displayName });
      }
    });
  }
}

function lintItemSockets(index, ctx) {
  const itemTypes = index.tablesByName.get("itemtypes.txt");
  const armor = index.tablesByName.get("armor.txt");
  const misc = index.tablesByName.get("misc.txt");
  const weapons = index.tablesByName.get("weapons.txt");
  if (!armor || !misc || !weapons || !itemTypes) return;
  const itemTypeRows = rowsByKey(itemTypes, "code");
  itemTypes.eachRow((row) => {
    const threshold1 = integerFromRow(row, "maxsocketslevelthreshold1");
    const threshold2 = integerFromRow(row, "maxsocketslevelthreshold2");
    const sockets = ["maxsockets1", "maxsockets2", "maxsockets3"].map((columnName) => [columnName, integerFromRow(row, columnName)]);
    if (threshold1 !== null && threshold2 !== null && threshold1 > threshold2) ctx.add(itemTypes, row.rowIndex, "maxsocketslevelthreshold1", "MaxSocketsLevelThreshold1 must be less than or equal to MaxSocketsLevelThreshold2.");
    for (let socketIndex = 0; socketIndex < sockets.length; socketIndex += 1) {
      const [columnName, value] = sockets[socketIndex];
      if (value === null) continue;
      if (value < 0 || value > 6) ctx.add(itemTypes, row.rowIndex, columnName, `${columnName} must be between 0 and 6.`);
      const next = sockets[socketIndex + 1]?.[1];
      if (next !== undefined && next !== null && value > next) ctx.add(itemTypes, row.rowIndex, columnName, `${columnName} must be less than or equal to ${sockets[socketIndex + 1][0]}.`);
    }
  });
  for (const table of [misc, armor, weapons]) {
    table.eachRow((row) => {
      const hasInv = integerFromRow(row, "hasinv");
      if (hasInv !== 1) return;
      const gemSockets = integerFromRow(row, "gemsockets");
      const gemApplyType = integerFromRow(row, "gemapplytype");
      const invWidth = integerFromRow(row, "invwidth") ?? 0;
      const invHeight = integerFromRow(row, "invheight") ?? 0;
      const typeLimit = Math.max(maxSocketsForType(itemTypeRows.get(normalizeToken(rowValue(row, "type")))), maxSocketsForType(itemTypeRows.get(normalizeToken(rowValue(row, "type2")))));
      const name = clean(row.get("name")) || rowLabelFor(table, row.rowIndex);
      const d2rLine = row.rowIndex + 3;
      if (gemSockets !== null && gemSockets > typeLimit) {
        ctx.add(table, row.rowIndex, "gemsockets", `gemsockets (${gemSockets}) exceeds the socket limit (${typeLimit}) from type/type2.`, {
          d2rMessage: `${table.displayName}, line ${d2rLine}: gemsockets (${gemSockets}) won't spawn on '${name}' because its type(s) won't allow more than ${typeLimit} sockets.`
        });
      }
      if (gemApplyType !== null && (gemApplyType < 0 || gemApplyType > 3)) ctx.add(table, row.rowIndex, "gemapplytype", "gemapplytype must be between 0 and 3.");
      if (gemSockets !== null && invWidth > 0 && invHeight > 0 && gemSockets > invWidth * invHeight) {
        ctx.add(table, row.rowIndex, "gemsockets", `gemsockets (${gemSockets}) exceeds inventory size ${invWidth} x ${invHeight}.`, {
          d2rMessage: `${table.displayName}, line ${d2rLine}: '${name}' has more gemsockets (${gemSockets}) than inventory spaces used (${invWidth} x ${invHeight} = ${invWidth * invHeight})`
        });
      }
    });
  }
}

function lintNoIllegalGambling(index, ctx) {
  const gamble = index.tablesByName.get("gamble.txt");
  const itemTypes = rowsByKey(index.tablesByName.get("itemtypes.txt"), "code");
  if (!gamble || !itemTypes.size) return;
  const items = new Map();
  for (const fileName of ["armor.txt", "misc.txt", "weapons.txt"]) {
    const table = index.tablesByName.get(fileName);
    if (!table) continue;
    table.eachRow((row) => items.set(normalizeToken(rowValue(row, "code")), { type: rowValue(row, "type"), type2: rowValue(row, "type2") }));
  }
  gamble.eachRow((row) => {
    const code = clean(rowValue(row, "code")) || clean(rowValue(row, "item"));
    if (!code) return;
    const item = items.get(normalizeToken(code));
    if (!item) return;
    if (itemTypeReaches(itemTypes, item.type, "char") || itemTypeReaches(itemTypes, item.type2, "char")) {
      ctx.add(gamble, row.rowIndex, gamble.hasColumn("code") ? "code" : "item", `Item "${code}" belongs to the char item type tree and cannot be gambled.`);
    }
  });
}

function lintValidStatParameters(index, ctx) {
  const properties = rowsByKey(index.tablesByName.get("properties.txt"), "code");
  const itemStatCost = rowsByKey(index.tablesByName.get("itemstatcost.txt"), "stat");
  const skillsTable = index.tablesByName.get("skills.txt");
  if (!properties.size || !itemStatCost.size || !skillsTable) return;
  const skillRows = skillsTable.rows?.length ?? 0;
  for (const table of index.tables) {
    const columns = propertyTupleColumns(table);
    if (!columns.length) continue;
    table.eachRow((row) => {
      for (const tuple of columns) {
        const propertyCode = clean(row.get(tuple.property));
        if (!propertyCode) continue;
        const property = properties.get(normalizeToken(propertyCode));
        if (!property) continue;
        const min = tuple.min ? integerFromRow(row, tuple.min) : null;
        const max = tuple.max ? integerFromRow(row, tuple.max) : null;
        if (tuple.min && clean(row.get(tuple.min)) && min === null) ctx.add(table, row.rowIndex, tuple.min, `${tuple.min} must be an integer.`);
        if (tuple.max && clean(row.get(tuple.max)) && max === null) ctx.add(table, row.rowIndex, tuple.max, `${tuple.max} must be an integer.`);
        for (const stat of propertyStats(property)) {
          const statRow = itemStatCost.get(normalizeToken(stat.stat));
          if (!statRow) continue;
          if (tuple.param && isEncodedSkillStat(statRow)) {
            validateSkillParameter(index, ctx, table, row, tuple, propertyCode, skillRows);
            if (normalizeToken(propertyCode) === "skill-rand") continue;
          }
          validateSavedStatRange(ctx, table, row, tuple, statRow, min ?? 0, max ?? 0, stat.func);
        }
      }
    });
  }
}

function lintValidWarp(index, ctx) {
  const levels = index.tablesByName.get("levels.txt");
  const lvlWarp = index.tablesByName.get("lvlwarp.txt");
  if (!levels || !lvlWarp) return;
  levels.eachRow((row) => {
    if (clean(row.get("name")) === "Expansion") return;
    const id = integerFromRow(row, "id");
    const line = row.rowIndex - 1;
    for (let slot = 0; slot <= 7; slot += 1) {
      const visColumn = `vis${slot}`;
      const warpColumn = `warp${slot}`;
      if (!levels.hasColumn(visColumn)) continue;
      const vis = integerFromRow(row, visColumn);
      const warp = levels.hasColumn(warpColumn) ? integerFromRow(row, warpColumn) : 0;
      if (vis === null || vis <= 0) continue;
      if (isHardcodedWarpException(id, warpColumn)) continue;
      if (vis >= levels.rows.length - 1) {
        ctx.add(levels, row.rowIndex, visColumn, `${visColumn} points to missing level index ${vis}.`, {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: invalid ${visColumn} for level '${clean(row.get("name"))}'`
        });
      }
      if (warp !== null && (warp < 0 || warp >= lvlWarp.rows.length - 1)) {
        ctx.add(levels, row.rowIndex, warpColumn, `${warpColumn} points outside lvlwarp.txt.`, {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: invalid ${warpColumn} for level '${clean(row.get("name"))}'`
        });
      }
      if (clean(row.get("act")) === "4") continue;
      const targetRow = levels.rows[vis + 1];
      if (!targetRow) {
        ctx.add(levels, row.rowIndex, visColumn, `Invalid level index ${vis}.`, {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: invalid level '${vis}' for level '${clean(row.get("name"))}'`
        });
        continue;
      }
      const target = {
        table: levels,
        rowIndex: vis + 1,
        get: (columnName) => levels.rows[vis + 1]?.[levels.columnIndex(columnName)] ?? ""
      };
      const backlink = Array.from({ length: 8 }, (_, backlinkSlot) => `vis${backlinkSlot}`).some((columnName) => levels.hasColumn(columnName) && clean(target.get(columnName)) === String(line));
      if (!backlink) {
        ctx.add(levels, row.rowIndex, visColumn, `Target level ${vis} does not link back to ${line}.`, {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: level '${clean(target.get("name"))}' doesn't have a vis field pointing at us for level '${clean(row.get("name"))}'`
        });
      }
    }
  });
}

function lintValidWaypoints(index, ctx) {
  const table = index.tablesByName.get("levels.txt");
  if (!table?.hasColumn("waypoint")) return;
  const seen = new Map();
  table.eachRow((row) => {
    const waypoint = clean(row.get("waypoint"));
    if (!waypoint || waypoint === "255") return;
    if (seen.has(waypoint)) {
      ctx.add(table, row.rowIndex, "waypoint", `Waypoint ${waypoint} is also used by ${seen.get(waypoint).label}.`);
    } else {
      seen.set(waypoint, { label: rowLabelFor(table, row.rowIndex) });
    }
  });
}

function lintMonsterChains(index, ctx) {
  const table = index.tablesByName.get("monstats.txt");
  if (!table?.hasColumn("id") || !table.hasColumn("baseid") || !table.hasColumn("nextinclass")) return;
  const chains = [];
  table.eachRow((row) => {
    const boss = clean(row.get("boss"));
    const primeevil = clean(row.get("primeevil"));
    if (boss && boss !== "0" || primeevil && primeevil !== "0") return;
    const baseId = clean(row.get("baseid"));
    const id = clean(row.get("id"));
    const nextInChain = clean(row.get("nextinclass"));
    const foundIndex = chains.findIndex((chain) => chain.baseId === baseId);
    if (foundIndex < 0) {
      chains.push({ baseId, id, nextInChain, rowIndex: row.rowIndex });
      return;
    }
    const found = chains[foundIndex];
    if (found.nextInChain !== id) {
      ctx.add(table, found.rowIndex, "nextinclass", `Broken baseId chain "${baseId}".`, {
        d2rMessage: `${table.displayName}, line ${found.rowIndex + 1}: broken baseId chain '${baseId}', nextInClass for '${found.id}' should point to '${id}' but it points to '${found.nextInChain}' instead`
      });
    }
    chains.splice(foundIndex, 1, { baseId, id, nextInChain, rowIndex: row.rowIndex });
  });
  for (const chain of chains) {
    if (!chain.nextInChain) continue;
    ctx.add(table, chain.rowIndex, "nextinclass", `nextInClass for "${chain.id}" (${chain.nextInChain}) does not exist.`, {
      d2rMessage: `${table.displayName}, line ${chain.rowIndex + 1}: nextInClass for '${chain.id}' (${chain.nextInChain}) doesn't exist.`
    });
  }
}

function lintEqualSkills(index, ctx) {
  const skills = index.tablesByName.get("skills.txt");
  const playerClass = index.tablesByName.get("playerclass.txt");
  if (!skills?.hasColumn("charclass") || !playerClass?.hasColumn("code")) return;
  const counts = new Map();
  skills.eachRow((row) => {
    const code = normalizeToken(row.get("charclass"));
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  });
  const expected = Math.max(...counts.values(), 0);
  playerClass.eachRow((row) => {
    const code = normalizeToken(row.get("code"));
    if (!code) return;
    const count = counts.get(code) ?? 0;
    if (count !== expected) ctx.add(playerClass, row.rowIndex, "code", `Player class "${clean(row.get("code"))}" has ${count} skills; expected ${expected} to match the other classes.`);
  });
}

function lintNoUntranslatedStrings(index, ctx) {
  const languageColumns = ["enus", "eng", "dede", "frfr", "eses", "itit", "plpl", "ruru", "kokr", "zhcn", "zhtw"];
  for (const table of index.tables.filter(isStringLikeTable)) {
    const presentLanguages = table.headers.filter((header) => languageColumns.includes(normalizeHeader(header)));
    if (!presentLanguages.length) continue;
    table.eachRow((row) => {
      const key = clean(row.get("key")) || clean(row.get("Key")) || clean(row.get("id"));
      if (!key) return;
      for (const columnName of presentLanguages) {
        if (!clean(row.get(columnName))) ctx.add(table, row.rowIndex, columnName, `String "${key}" is missing a ${columnName} translation.`);
      }
    });
  }
}

function lintNumericBounds(index, ctx) {
  for (const [fileName, labelColumn, versionColumn] of VERSION_CHECKS) {
    validVersion(index.tablesByName.get(fileName), ctx, labelColumn, versionColumn);
  }
  validVersion(index.tablesByName.get("cubemain.txt"), ctx, "description", "version", (row) => clean(row.get("enabled")) === "1");

  for (const table of index.tables) {
    const rules = numericBoundsForProfile(index.profile, table.fileName);
    if (!rules) continue;
    for (const [columnName, [min, max]] of Object.entries(rules)) {
      if (!table.hasColumn(columnName)) continue;
      table.eachRow((row) => {
        if (table.fileName === "monstats.txt" && ["colossal1", "colossal2", "colossal3"].includes(clean(row.get("id")))) return;
        const value = clean(row.get(columnName));
        if (!value) return;
        const number = Number.parseInt(value, 10);
        const label = numericBoundsLabel(table, row);
        if (Number.isNaN(number)) {
          ctx.add(table, row.rowIndex, columnName, `"${columnName}" must be an integer.`, {
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${columnName}' is not a number for '${label}'`
          });
          return;
        }
        if (number < min || number > max) {
          ctx.add(table, row.rowIndex, columnName, `"${columnName}" must be between ${formatBound(min)} and ${formatBound(max)}.`, {
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${columnName}' is out of range for '${label}', expected number between ${min} and ${max} (inclusive), found ${number}`
          });
        }
      });
    }
  }
}

function acceptedColumnsForProfile(profile, fileName) {
  return new Set(PROFILE_ACCEPTED_COLUMNS[profile]?.[fileName] ?? []);
}

function nonStandardColumnsForProfile(profile, fileName) {
  return new Set(PROFILE_NON_STANDARD_COLUMNS[profile]?.[fileName] ?? []);
}

function numericBoundsForProfile(profile, fileName) {
  const base = NUMERIC_BOUNDS[fileName];
  const override = PROFILE_NUMERIC_BOUNDS[profile]?.[fileName];
  if (!base) return override;
  if (!override) return base;
  return { ...base, ...override };
}

function lintBooleanFields(index, ctx) {
  for (const table of index.tables) {
    const fields = BOOLEAN_FIELDS[table.fileName] ?? [];
    for (const columnName of fields) {
      if (!table.hasColumn(columnName)) continue;
      table.eachRow((row) => {
        const value = clean(row.get(columnName));
        if (value && value !== "0" && value !== "1") ctx.add(table, row.rowIndex, columnName, `"${columnName}" must be 0 or 1.`);
      });
    }
  }
}

function lintCubeInputs(index, ctx) {
  const table = index.tablesByName.get("cubemain.txt");
  if (!table) return;
  table.eachRow((row) => {
    if (!isEnabled(row.get("enabled"))) return;
    const inputs = inputColumns(row, table).map((columnName) => ({ columnName, parsed: parseCubeItem(row.get(columnName)) })).filter((entry) => entry.parsed.raw);
    const declared = clean(row.get("numinputs"));
    const description = rawRowValue(table, row.rowIndex, "description");
    if (!declared || declared === "0") {
      ctx.add(table, row.rowIndex, "numinputs", `No inputs for recipe "${clean(row.get("description"))}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: no inputs for recipe '${description}'`
      });
      return;
    }
    const declaredNumber = Number.parseInt(declared, 10);
    if (Number.isNaN(declaredNumber)) {
      ctx.add(table, row.rowIndex, "numinputs", `Invalid numinputs value "${declared}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid value for 'numinputs' for recipe '${description}'`
      });
      return;
    }
    const actual = inputs.reduce((sum, entry) => sum + cubeInputCount(entry.parsed.raw), 0);
    if (declaredNumber !== actual) {
      ctx.add(table, row.rowIndex, "numinputs", `numinputs is ${declared}, but the recipe contains ${actual} input item(s).`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: wrong numinputs. expected ${actual}, found ${declaredNumber} in recipe '${description}'`
      });
    }
    for (const input of inputs) {
      validateCubeItemReference(index, ctx, table, row.rowIndex, input.columnName, input.parsed, "input");
      validateInputQualifiers(ctx, table, row.rowIndex, input.columnName, input.parsed);
    }
  });
}

function lintCubeOutputs(index, ctx) {
  const table = index.tablesByName.get("cubemain.txt");
  if (!table || !index.tablesByName.has("cubemod.txt")) return;
  table.eachRow((row) => {
    if (!isEnabled(row.get("enabled"))) return;
    for (const columnName of ["output", "output b", "output c"]) {
      if (!table.hasColumn(columnName)) continue;
      const parsed = parseCubeItem(row.get(columnName));
      if (!parsed.raw) continue;
      validateCubeItemReference(index, ctx, table, row.rowIndex, columnName, parsed, "output");
      validateOutputQualifiers(ctx, table, row.rowIndex, columnName, parsed);
    }
    for (const propColumn of CUBE_OUTPUT_MOD_COLUMNS) {
      if (!table.hasColumn(propColumn)) continue;
      const property = clean(row.get(propColumn));
      if (property && index.hasWorkspace && index.tablesByName.has("properties.txt") && !index.properties.has(property) && !index.propertyGroups.has(property)) {
        ctx.add(table, row.rowIndex, propColumn, `Unknown cube output property "${property}".`, {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid property '${property}' for '${propColumn}' in recipe '${rawRowValue(table, row.rowIndex, "description")}'`
        });
      }
    }
  });
}

function lintCubeOp(index, ctx) {
  const table = index.tablesByName.get("cubemain.txt");
  if (!table) return;
  table.eachRow((row) => {
    const op = clean(row.get("op"));
    const description = rawRowValue(table, row.rowIndex, "description");
    if (!op || op === "0" || op === "28") return;
    const opNumber = Number.parseInt(op, 10);
    if (Number.isNaN(opNumber) || opNumber < 0 || opNumber > 28) {
      ctx.add(table, row.rowIndex, "op", "Cube op must be an integer from 0 through 28.", {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid opcode for '${description}'`
      });
      return;
    }
    if (opNumber === 27 || opNumber === 2) return;
    const param = clean(row.get("param"));
    const value = clean(row.get("value"));
    if (!param) {
      ctx.add(table, row.rowIndex, "param", "Cube op requires a param value.", {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: opcode '${opNumber}' for recipe '${description}' requires a param, but none set`
      });
    } else {
      const paramNumber = Number.parseInt(param, 10);
      if (Number.isNaN(paramNumber) || paramNumber < 0 || paramNumber >= itemStatCostRowCount(index)) {
        ctx.add(table, row.rowIndex, "param", `Cube op param "${param}" is not a valid item stat index.`, {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid param for recipe '${description}'`
        });
      }
    }
    if (!value) {
      ctx.add(table, row.rowIndex, "value", "Cube op requires a value.", {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: opcode '${opNumber}' for recipe '${description}' requires a value, but none set`
      });
    }
  });
}

function lintTreasureReferences(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  table.eachRow((row) => {
    const className = clean(row.get("treasure class"));
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const columnName = `item${indexNo}`;
      if (!table.hasColumn(columnName)) continue;
      const value = clean(row.get(columnName));
      const tokenValue = treasureFormulaItem(value);
      if (!tokenValue || isAutoTreasureClass(tokenValue) || normalizeToken(tokenValue) === "gld") continue;
      if (!index.hasWorkspace) continue;
      const token = normalizeToken(tokenValue);
      const valid = index.itemCodes.has(token) || index.itemTypes.has(token) || index.setItems.has(token) || index.uniqueItems.has(token) || index.treasureClasses.has(token);
      if (!valid) {
        ctx.add(table, row.rowIndex, columnName, `Unknown treasure reference "${value}" in ${className || "Treasure Class"}.`, {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: can't find '${tokenValue}' for '${columnName}' in TC '${className}'`
        });
      }
    }
  });
}

function lintTreasureNegativePicks(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  table.eachRow((row) => {
    const picks = clean(row.get("picks"));
    if (!picks || !isIntegerText(picks) || Number(picks) >= 0) return;
    let total = 0;
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const columnName = `prob${indexNo}`;
      if (!table.hasColumn(columnName)) continue;
      const value = clean(row.get(columnName));
      if (!value) continue;
      if (!isIntegerText(value)) {
        ctx.add(table, row.rowIndex, columnName, `Probability ${columnName} must be numeric when picks is negative.`);
      } else {
        total += Number(value);
      }
    }
    if (Math.abs(Number(picks)) !== total) {
      ctx.add(table, row.rowIndex, "picks", `Negative picks expects probability total ${Math.abs(Number(picks))}, but found ${total}.`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: 'picks' (${Number(picks)}) doesn't match negative sum of probs (${-total}) for '${clean(row.get("treasure class"))}'`
      });
    }
  });
}

function lintTreasureProbabilities(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  table.eachRow((row) => {
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const itemColumn = `item${indexNo}`;
      const probColumn = `prob${indexNo}`;
      if (!table.hasColumn(itemColumn) || !table.hasColumn(probColumn)) continue;
      const item = clean(row.get(itemColumn));
      const probability = clean(row.get(probColumn));
      if (item && !probability) ctx.add(table, row.rowIndex, probColumn, `${probColumn} is required when ${itemColumn} is set.`);
      if (probability && !isIntegerText(probability)) ctx.add(table, row.rowIndex, probColumn, `${probColumn} must be numeric.`);
    }
  });
}

function makeRuleContext(ruleId, severity, diagnostics, profile) {
  return {
    add(table, rowIndex, columnName, message, meta = {}) {
      const columnIndex = typeof columnName === "number" ? columnName : table.columnIndex(columnName);
      const header = typeof columnName === "number" ? table.headerAt(columnName) : table.headerAt(columnIndex);
      const rowLabel = rowLabelFor(table, rowIndex);
      const primaryLocationLabel = rowLabel ? `${rowLabel} > ${header}` : header;
      const technicalLocationLabel = `R${rowIndex + 1}:C${Math.max(0, columnIndex) + 1}`;
      diagnostics.push({
        id: "",
        ruleId,
        profile,
        severity,
        message,
        fileName: table.displayName,
        fileKey: table.fileKey,
        filePath: table.path,
        rowIndex,
        columnIndex: Math.max(0, columnIndex),
        columnName: header,
        rowLabel,
        primaryLocationLabel,
        technicalLocationLabel,
        locationLabel: primaryLocationLabel,
        offendingValue: table.rows[rowIndex]?.[Math.max(0, columnIndex)] ?? "",
        ...meta
      });
    }
  };
}

function tableFromDocument(doc) {
  if (!doc || !isTxtLikeName(doc.name) && !isTxtLikeName(doc.path)) return null;
  const fileName = baseName(doc.path || doc.name).toLowerCase();
  const headerMap = new Map();
  const headers = doc.headers ?? doc.rows?.[0] ?? [];
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized && !headerMap.has(normalized)) headerMap.set(normalized, index);
  });
  return {
    doc,
    path: doc.path ?? "",
    fileName,
    fileKey: documentKey(doc),
    displayName: baseName(doc.path || doc.name || fileName),
    headers,
    rows: doc.rows ?? [],
    headerAt(column) {
      return headers[column] ?? `Column ${column + 1}`;
    },
    hasColumn(columnName) {
      return headerMap.has(normalizeHeader(columnName));
    },
    columnIndex(columnName) {
      return headerMap.get(normalizeHeader(columnName)) ?? 0;
    },
    eachRow(callback) {
      for (let rowIndex = 1; rowIndex < this.rows.length; rowIndex += 1) {
        callback({
          table: this,
          rowIndex,
          get: (columnName) => this.rows[rowIndex]?.[this.columnIndex(columnName)] ?? ""
        });
      }
    }
  };
}

function setFromColumn(tablesByName, fileName, columnName, options = {}) {
  const table = tablesByName.get(fileName);
  const values = new Set();
  if (!table?.hasColumn(columnName)) return values;
  table.eachRow((row) => {
    const value = clean(row.get(columnName));
    if (value) values.add(options.caseSensitive ? value : normalizeToken(value));
  });
  return values;
}

function numberedFields(prefix, suffix, count, start = 1) {
  const fields = [];
  for (let value = start; value < start + count; value += 1) fields.push(`${prefix}${value}${suffix}`);
  return fields;
}

function mustExist(index, ctx, table, fieldName, labelColumn, targetValues, options = {}) {
  if (!table?.hasColumn(fieldName) || !table.hasColumn(labelColumn)) return;
  if (!(targetValues instanceof Set) || targetValues.size === 0) return;
  const allowNull = options.allowNull === true;
  const nullChecker = options.nullChecker ?? ((value) => clean(value) === "" || value === undefined);
  const normalizeReference = options.caseSensitive ? clean : normalizeToken;
  table.eachRow((row) => {
    const label = clean(row.get(labelColumn));
    if (!label || label === "Expansion" || label === "*end*  do not remove" || label.startsWith("@")) return;
    const value = clean(row.get(fieldName));
    if (allowNull && nullChecker(value)) return;
    if (!targetValues.has(normalizeReference(value))) {
      ctx.add(table, row.rowIndex, fieldName, `${fieldName} "${value}" not found for "${label}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${fieldName} '${value}' not found for '${label}'`
      });
    }
  });
}

function requiredString(index, ctx, table, fieldName, labelColumn) {
  if (!table?.hasColumn(fieldName) || !table.hasColumn(labelColumn)) return;
  table.eachRow((row) => {
    const label = clean(row.get(labelColumn));
    if (!label || label === "Expansion" || label === "Null" || label === "Elite Uniques" || label.startsWith("@")) return;
    if (!clean(row.get(fieldName))) {
      ctx.add(table, row.rowIndex, fieldName, `${fieldName} is blank but required for "${label}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${fieldName} for '${label}' is blank but required`
      });
    }
  });
}

function validateSkillSummode(index, ctx, table) {
  if (!table?.hasColumn("summon") || !table.hasColumn("summode") || !table.hasColumn("skill")) return;
  if (!(index.monModes instanceof Set) || index.monModes.size === 0) return;
  table.eachRow((row) => {
    const summon = clean(row.get("summon"));
    if (!summon) return;
    const summode = clean(row.get("summode"));
    const skill = clean(row.get("skill"));
    if (!index.monModes.has(normalizeToken(summode))) {
      ctx.add(table, row.rowIndex, "summode", `Invalid summode "${summode}" for "${skill}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid summode '${summode}' for '${skill}'`
      });
    }
  });
}

function rowLabelFor(table, rowIndex) {
  if (rowIndex === 0) return "Header";
  const candidates = ROW_LABEL_COLUMNS[table.fileName] ?? DEFAULT_ROW_LABEL_COLUMNS;
  for (const columnName of candidates) {
    if (!table.hasColumn(columnName)) continue;
    const value = clean(table.rows[rowIndex]?.[table.columnIndex(columnName)]);
    if (value) return value;
  }
  const firstValue = clean(table.rows[rowIndex]?.find((value) => clean(value)));
  return firstValue || `Row ${rowIndex + 1}`;
}

function rowLabelsForTable(table) {
  const labels = new Map();
  for (let rowIndex = 1; rowIndex < table.rows.length; rowIndex += 1) labels.set(rowIndex, rowLabelFor(table, rowIndex));
  return labels;
}

const DEFAULT_ROW_LABEL_COLUMNS = ["treasure class", "code", "id", "index", "name", "skill", "state", "description"];
const ROW_LABEL_COLUMNS = {
  "armor.txt": ["code", "name"],
  "cubemain.txt": ["description", "output", "input 1"],
  "itemstatcost.txt": ["stat"],
  "itemtypes.txt": ["code", "itemtype"],
  "misc.txt": ["code", "name"],
  "missiles.txt": ["missile"],
  "properties.txt": ["code"],
  "setitems.txt": ["index"],
  "skills.txt": ["skill"],
  "states.txt": ["state"],
  "superuniques.txt": ["superunique", "name"],
  "treasureclassex.txt": ["treasure class"],
  "uniqueitems.txt": ["index"],
  "weapons.txt": ["code", "name"]
};

const CUBE_OUTPUT_MOD_COLUMNS = [
  ...numberedFields("mod ", "", 5),
  ...numberedFields("b mod ", "", 5),
  ...numberedFields("c mod ", "", 5)
];

const STAT_PARAMETER_TUPLES = new Map([
  ["automagic.txt", buildStatTuples(
    numberedFields("mod", "code", 3),
    numberedFields("mod", "param", 3),
    numberedFields("mod", "min", 3),
    numberedFields("mod", "max", 3)
  )],
  ["gems.txt", buildStatTuples(
    [
      ...numberedFields("weaponmod", "code", 3),
      ...numberedFields("helmmod", "code", 3),
      ...numberedFields("shieldmod", "code", 3)
    ],
    [
      ...numberedFields("weaponmod", "param", 3),
      ...numberedFields("helmmod", "param", 3),
      ...numberedFields("shieldmod", "param", 3)
    ],
    [
      ...numberedFields("weaponmod", "min", 3),
      ...numberedFields("helmmod", "min", 3),
      ...numberedFields("shieldmod", "min", 3)
    ],
    [
      ...numberedFields("weaponmod", "max", 3),
      ...numberedFields("helmmod", "max", 3),
      ...numberedFields("shieldmod", "max", 3)
    ]
  )],
  ["magicprefix.txt", buildStatTuples(
    numberedFields("mod", "code", 3),
    numberedFields("mod", "param", 3),
    numberedFields("mod", "min", 3),
    numberedFields("mod", "max", 3)
  )],
  ["magicsuffix.txt", buildStatTuples(
    numberedFields("mod", "code", 3),
    numberedFields("mod", "param", 3),
    numberedFields("mod", "min", 3),
    numberedFields("mod", "max", 3)
  )],
  ["monprop.txt", buildStatTuples(
    [
      ...numberedFields("prop", "", 6),
      ...numberedFields("prop", " (n)", 6),
      ...numberedFields("prop", " (h)", 6)
    ],
    [
      ...numberedFields("par", "", 6),
      ...numberedFields("par", " (n)", 6),
      ...numberedFields("par", " (h)", 6)
    ],
    [
      ...numberedFields("min", "", 6),
      ...numberedFields("min", " (n)", 6),
      ...numberedFields("min", " (h)", 6)
    ],
    [
      "max1", "max2", "max3", "max5", "max5", "max6",
      ...numberedFields("max", " (n)", 6),
      ...numberedFields("max", " (h)", 6)
    ]
  )],
  ["qualityitems.txt", buildStatTuples(
    numberedFields("mod", "code", 2),
    numberedFields("mod", "param", 2),
    numberedFields("mod", "min", 2),
    numberedFields("mod", "max", 2)
  )],
  ["runes.txt", buildStatTuples(
    numberedFields("t1code", "", 7),
    numberedFields("t1param", "", 7),
    numberedFields("t1min", "", 7),
    numberedFields("t1max", "", 7)
  )],
  ["setitems.txt", buildStatTuples(
    [
      ...numberedFields("prop", "", 9),
      ...numberedFields("aprop", "a", 5),
      ...numberedFields("aprop", "b", 5)
    ],
    [
      ...numberedFields("par", "", 9),
      ...numberedFields("apar", "a", 5),
      ...numberedFields("apar", "b", 5)
    ],
    [
      ...numberedFields("min", "", 9),
      ...numberedFields("amin", "a", 5),
      ...numberedFields("amin", "b", 5)
    ],
    [
      ...numberedFields("max", "", 9),
      ...numberedFields("amax", "a", 5),
      ...numberedFields("amax", "b", 5)
    ]
  )],
  ["sets.txt", buildStatTuples(
    [
      ...numberedFields("pcode", "a", 4, 2),
      ...numberedFields("pcode", "b", 4, 2),
      ...numberedFields("fcode", "", 8)
    ],
    [
      ...numberedFields("pparam", "a", 4, 2),
      ...numberedFields("pparam", "b", 4, 2),
      ...numberedFields("fparam", "", 8)
    ],
    [
      ...numberedFields("pmin", "a", 4, 2),
      ...numberedFields("pmin", "b", 4, 2),
      ...numberedFields("fmin", "", 8)
    ],
    [
      ...numberedFields("pmax", "a", 4, 2),
      ...numberedFields("pmax", "b", 4, 2),
      ...numberedFields("fmax", "", 8)
    ]
  )],
  ["uniqueitems.txt", buildStatTuples(
    numberedFields("prop", "", 12),
    numberedFields("par", "", 12),
    numberedFields("min", "", 12),
    numberedFields("max", "", 12)
  )]
]);

function unionSets(...sets) {
  const values = new Set();
  for (const set of sets) for (const value of set) values.add(value);
  return values;
}

function rowsByKey(table, columnName) {
  const rows = new Map();
  if (!table?.hasColumn(columnName)) return rows;
  table.eachRow((row) => {
    const key = normalizeToken(row.get(columnName));
    if (key && !rows.has(key)) rows.set(key, row);
  });
  return rows;
}

function rowValue(row, columnName) {
  if (row?.table && !row.table.hasColumn(columnName)) return "";
  return row?.get(columnName) ?? "";
}

function integerValue(value) {
  const text = clean(value);
  return text && isIntegerText(text) ? Number(text) : null;
}

function integerFromRow(row, columnName) {
  const value = rowValue(row, columnName);
  if (!clean(value)) return null;
  return integerValue(value);
}

function maxSocketsForType(row) {
  if (!row) return 0;
  return Math.max(integerFromRow(row, "maxsockets1") ?? 0, integerFromRow(row, "maxsockets2") ?? 0, integerFromRow(row, "maxsockets3") ?? 0);
}

function itemTypeReaches(itemTypes, code, target, seen = new Set()) {
  const token = normalizeToken(code);
  const targetToken = normalizeToken(target);
  if (!token || seen.has(token)) return false;
  if (token === targetToken) return true;
  seen.add(token);
  const row = itemTypes.get(token);
  if (!row) return false;
  return itemTypeReaches(itemTypes, rowValue(row, "equiv1"), targetToken, seen) || itemTypeReaches(itemTypes, rowValue(row, "equiv2"), targetToken, seen);
}

function isStringLikeTable(table) {
  return table?.hasColumn("id") && table.hasColumn("key");
}

function propertyTupleColumns(table) {
  const tuples = STAT_PARAMETER_TUPLES.get(table?.fileName);
  if (!table || !tuples) return [];
  return tuples.map((tuple) => ({
    property: table.hasColumn(tuple.property) ? tuple.property : "",
    param: table.hasColumn(tuple.param) ? tuple.param : "",
    min: table.hasColumn(tuple.min) ? tuple.min : "",
    max: table.hasColumn(tuple.max) ? tuple.max : ""
  })).filter((tuple) => tuple.property && (tuple.param || tuple.min || tuple.max));
}

function buildStatTuples(properties, params, mins, maxs) {
  return properties.map((property, index) => ({
    property,
    param: params[index] ?? "",
    min: mins[index] ?? "",
    max: maxs[index] ?? ""
  }));
}

function propertyStats(propertyRow) {
  const stats = [];
  const implicitStatByFunction = {
    "5": "mindamage",
    "6": "maxdamage",
    "7": "item_mindamage_percent"
  };
  for (let index = 1; index <= 7; index += 1) {
    const func = clean(rowValue(propertyRow, `func${index}`));
    let stat = clean(rowValue(propertyRow, `stat${index}`));
    if (!stat && implicitStatByFunction[func]) stat = implicitStatByFunction[func];
    if (stat && func !== "17") stats.push({ func, stat });
  }
  return stats;
}

function isEncodedSkillStat(itemStatRow) {
  const encode = clean(rowValue(itemStatRow, "encode"));
  return encode === "1" || encode === "2" || encode === "3";
}

function validateSkillParameter(index, ctx, table, row, tuple, propertyCode, skillRows) {
  if (normalizeToken(propertyCode) === "skill-rand") return;
  const param = clean(rowValue(row, tuple.param));
  if (!param) return;
  if (isIntegerText(param)) {
    if (skillRows > 1 && Number(param) >= skillRows - 1) ctx.add(table, row.rowIndex, tuple.param, `${tuple.param} points to skill id ${param}, but skills.txt only has ${skillRows - 1} skill row(s).`);
    return;
  }
  if (index.skills.size && !index.skills.has(normalizeToken(param))) ctx.add(table, row.rowIndex, tuple.param, `${tuple.param} "${param}" is not a known skill.`);
}

function validateSavedStatRange(ctx, table, row, tuple, itemStatRow, min, max, funcValue = "") {
  const saveBits = integerFromRow(itemStatRow, "save bits");
  const saveAdd = integerFromRow(itemStatRow, "save add") ?? 0;
  if (saveBits === null || saveBits <= 0) return;
  const saveBitsMax = 2 ** saveBits - saveAdd;
  const signed = clean(rowValue(itemStatRow, "signed")) === "1";
  const label = rowLabelFor(table, row.rowIndex);
  if (tuple.min && min > saveBitsMax && funcValue !== "16") {
    ctx.add(table, row.rowIndex, tuple.min, `${tuple.min} value ${min} is above save bits maximum ${saveBitsMax}.`, {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.min}': value (${min}) above save bits maximum (${saveBitsMax}) for '${label}'`
    });
  }
  if (tuple.max && max > saveBitsMax && funcValue !== "15") {
    ctx.add(table, row.rowIndex, tuple.max, `${tuple.max} value ${max} is above save bits maximum ${saveBitsMax}.`, {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.max}': value (${max}) above save bits maximum (${saveBitsMax}) for '${label}'`
    });
  }
  if (signed && funcValue !== "18" && funcValue !== "19") {
    if (tuple.min && min < -saveAdd && funcValue !== "16") {
      ctx.add(table, row.rowIndex, tuple.min, `${tuple.min} value ${min} is below save add minimum ${-saveAdd}.`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.min}': value (${min}) below save add minimum (${-saveAdd}) for '${label}'`
      });
    }
    if (tuple.max && max < -saveAdd && funcValue !== "15") {
      ctx.add(table, row.rowIndex, tuple.max, `${tuple.max} value ${max} is below save add minimum ${-saveAdd}.`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.max}': value (${max}) below save add minimum (${-saveAdd}) for '${label}'`
      });
    }
  }
}

function validateCubeItemReference(index, ctx, table, rowIndex, columnName, parsed, kind) {
  if (!index.hasWorkspace) return;
  if (!index.tablesByName.has("armor.txt") || !index.tablesByName.has("misc.txt") || !index.tablesByName.has("weapons.txt") || !index.tablesByName.has("setitems.txt") || !index.tablesByName.has("uniqueitems.txt") || !index.tablesByName.has("itemtypes.txt")) return;
  const token = normalizeToken(parsed.code);
  const compact = token.replace(/\s+/g, "");
  if (!token) return;
  if (kind === "input" && token === "any") return;
  if (token === "useitem" || token === "usetype") {
    if (kind === "output" && columnName !== "output") {
      ctx.add(table, rowIndex, columnName, `${parsed.code} is only valid for the first cube output.`, {
        d2rMessage: `${table.displayName}, line ${rowIndex + 1}: ${parsed.code} is not valid in '${columnName}', it is only valid for the first output`
      });
    }
    return;
  }
  if (compact === "cowportal" || compact === "redportal" || compact === "pandemoniumportal" || compact === "pandemoniumfinaleportal" || token === "pandportal") return;
  const valid = index.itemCodes.has(token) || index.itemTypes.has(token) || index.setItems.has(token) || index.uniqueItems.has(token);
  if (!valid) {
    ctx.add(table, rowIndex, columnName, `Unknown cube ${kind} "${parsed.code}".`, {
      d2rMessage: kind === "output"
        ? `${table.displayName}, line ${rowIndex + 1}: could not find '${parsed.code}' for ${columnName} in recipe '${rawRowValue(table, rowIndex, "description")}'`
        : `${table.displayName}, line ${rowIndex + 1}: couldn't find '${parsed.code}' for ${columnName} in recipe '${rawRowValue(table, rowIndex, "description")}'`
    });
  }
}

function validateInputQualifiers(ctx, table, rowIndex, columnName, parsed) {
  const allowed = new Set(["low", "nor", "hiq", "mag", "rar", "set", "uni", "crf", "tmp", "eth", "noe", "nos", "upg", "nru", "bas", "exc", "eli"]);
  for (const qualifier of parsed.qualifiers) {
    if (/^qty=\d+$/.test(qualifier)) continue;
    const name = qualifier.split("=")[0];
    if (name.startsWith("sock")) continue;
    if (!allowed.has(name)) {
      ctx.add(table, rowIndex, columnName, `Unknown cube input qualifier "${qualifier}".`, {
        d2rMessage: `${table.displayName}, line ${rowIndex + 1}: unknown input qualifier '${qualifier}' for ${columnName} in recipe '${rawRowValue(table, rowIndex, "description")}'`
      });
    }
  }
}

function validateOutputQualifiers(ctx, table, rowIndex, columnName, parsed) {
  const allowed = new Set(["low", "nor", "hiq", "mag", "rar", "set", "uni", "crf", "tmp", "eth", "noe", "sock", "nos", "pre", "suf", "lvl", "plvl", "ilvl", "upg", "bas", "exc", "eli", "uns", "rem", "rep", "rch", "reg", "mod"]);
  for (const qualifier of parsed.qualifiers) {
    if (/^(qty|pre|suf|sock|lvl|plvl|ilvl)=.+$/.test(qualifier)) continue;
    const name = qualifier.split("=")[0];
    if (!allowed.has(name)) ctx.add(table, rowIndex, columnName, `Unknown cube output qualifier "${qualifier}".`);
  }
}

function validVersion(table, ctx, labelColumn, versionColumn, shouldConsider = null) {
  if (!table?.hasColumn(labelColumn) || !table.hasColumn(versionColumn)) return;
  table.eachRow((row) => {
    const label = clean(row.get(labelColumn));
    const version = clean(row.get(versionColumn));
    if (!label || label === "Expansion" || label === "Armor" || label === "Elite Uniques" || label === "Rings" || label === "Class Specific" || label.startsWith("@")) return;
    if (version === "0" || version === "1" || version === "100") return;
    if (shouldConsider && !shouldConsider(row)) return;
    if (isDummyVersionRow(table, row, labelColumn, versionColumn)) return;
    ctx.add(table, row.rowIndex, versionColumn, `Invalid version "${version}" for "${label}".`, {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid 'version' (${version}) for '${label}'`
    });
  });
}

function isDummyVersionRow(table, row, labelColumn, versionColumn) {
  const label = clean(row.get(labelColumn));
  const version = clean(row.get(versionColumn));
  if (!label || label.startsWith("@") || version) return false;
  const ignoredColumns = new Set([normalizeHeader(labelColumn), normalizeHeader(versionColumn), "skipindocs"]);
  const values = table.rows[row.rowIndex] ?? [];
  for (let columnIndex = 0; columnIndex < table.headers.length; columnIndex += 1) {
    const header = normalizeHeader(table.headers[columnIndex]);
    if (ignoredColumns.has(header) || header.startsWith("*")) continue;
    if (clean(values[columnIndex])) return false;
  }
  return true;
}

function numericBoundsLabel(table, row) {
  const labels = {
    "levels.txt": "name",
    "missiles.txt": "missile",
    "monstats.txt": "id",
    "treasureclassex.txt": "treasure class",
    "itemstatcost.txt": "stat"
  };
  return clean(row.get(labels[table.fileName] ?? "name")) || rowLabelFor(table, row.rowIndex);
}

function cubeInputCount(raw) {
  const match = clean(raw).match(/(?:^".*,qty=([0-9]+).*"$)|(?:^[^"]*,qty=([0-9]+))/i);
  if (!match) return 1;
  return Number.parseInt(match[1] ?? match[2], 10);
}

function itemStatCostRowCount(index) {
  return Math.max(0, (index.tablesByName.get("itemstatcost.txt")?.rows.length ?? 1) - 1);
}

function rawRowValue(table, rowIndex, columnName) {
  if (!table?.hasColumn(columnName)) return "";
  return String(table.rows[rowIndex]?.[table.columnIndex(columnName)] ?? "");
}

function treasureFormulaItem(value) {
  const raw = clean(value);
  const quoted = raw.match(/"(.+)"/);
  const formula = quoted ? quoted[1] : raw;
  return clean(formula.split(",")[0]);
}

function isHardcodedWarpException(id, warpColumn) {
  return (id === 26 && warpColumn === "warp1") ||
    (id === 27 && warpColumn === "warp0") ||
    (id === 27 && warpColumn === "warp1") ||
    (id === 28 && warpColumn === "warp0") ||
    (id === 32 && warpColumn === "warp1") ||
    (id === 33 && warpColumn === "warp0") ||
    (id === 107 && warpColumn === "warp1") ||
    (id === 108 && warpColumn === "warp0");
}

function parseCubeItem(value) {
  const raw = clean(value);
  if (!raw) return { raw: "", code: "", qualifiers: [], qty: null };
  const quoted = raw.match(/"(.+)"/);
  const formula = quoted ? quoted[1] : raw;
  const parts = formula.split(",").map((part) => clean(part)).filter(Boolean);
  let code = parts[0] ?? "";
  const qualifiers = [];
  let qty = null;
  if (/^qty=\d+$/i.test(code)) {
    qty = Number(code.split("=")[1]);
    code = parts[1] ?? "";
    qualifiers.push(normalizeToken(parts[0]));
    qualifiers.push(...parts.slice(2).map(normalizeToken));
  } else {
    qualifiers.push(...parts.slice(1).map(normalizeToken));
  }
  for (const qualifier of qualifiers) {
    if (/^qty=\d+$/.test(qualifier)) qty = Number(qualifier.split("=")[1]);
  }
  return { raw, code, qualifiers, qty };
}

function inputColumns(row, table) {
  const values = [];
  for (let index = 1; index <= 7; index += 1) {
    const columnName = `input ${index}`;
    if (table.hasColumn(columnName) && clean(row.get(columnName))) values.push(columnName);
  }
  return values;
}

function isEnabled(value) {
  const cleanValue = clean(value);
  return cleanValue !== "" && cleanValue !== "0";
}

function isAutoTreasureClass(value) {
  const token = normalizeToken(value);
  return /^Act\s+\d+\s+/.test(value) || /^Act\s+\d+\s*\(/.test(value) || /^(armo|weap|junk|good|mele|bow|misc|armo|weap)\d+$/.test(token) || /^gld,mul=\d+$/.test(token);
}

function uniqueDocuments(documents) {
  const seen = new Set();
  const result = [];
  for (const doc of documents ?? []) {
    const key = documentKey(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(doc);
  }
  return result;
}

function documentKey(doc) {
  return normalizePath(doc?.path || doc?.name || "");
}

function normalizePath(value) {
  return String(value).replace(/\\/g, "/").toLowerCase();
}

function baseName(path) {
  return String(path).replace(/\\/g, "/").split("/").pop() || String(path);
}

function normalizeHeader(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeToken(value) {
  return clean(value).toLowerCase();
}

function clean(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) return text.slice(1, -1).trim();
  return text;
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}

function isTxtLikeName(value) {
  return /\.(txt|tsv|tbl|csv)$/i.test(String(value ?? ""));
}

function compareDiagnostics(a, b) {
  return a.fileName.localeCompare(b.fileName) || a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex || a.ruleId.localeCompare(b.ruleId);
}

function formatBound(value) {
  if (value === Number.NEGATIVE_INFINITY) return "-infinity";
  if (value === Number.POSITIVE_INFINITY) return "infinity";
  return String(value);
}

function rule(id, label, implemented = false, defaultEnabled = true, profiles = PROFILE_OPTIONS) {
  return {
    id,
    label,
    implemented,
    defaultEnabled,
    profiles,
    note: ""
  };
}
