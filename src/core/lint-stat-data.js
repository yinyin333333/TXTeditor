export function numberedFields(prefix, suffix, count, start = 1) {
  const fields = [];
  for (let value = start; value < start + count; value += 1) fields.push(`${prefix}${value}${suffix}`);
  return fields;
}

export function buildStatTuples(properties, params, mins, maxs) {
  return properties.map((property, index) => ({
    property,
    param: params[index] ?? "",
    min: mins[index] ?? "",
    max: maxs[index] ?? ""
  }));
}

export const CUBE_OUTPUT_MOD_COLUMNS = [
  ...numberedFields("mod ", "", 5),
  ...numberedFields("b mod ", "", 5),
  ...numberedFields("c mod ", "", 5)
];

export const STAT_PARAMETER_TUPLES = new Map([
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
      "max1", "max2", "max3", "max4", "max5", "max6",
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
