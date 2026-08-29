export function isTextLikePath(path) {
  return /\.(txt|tsv|tbl|csv)$/i.test(String(path || ""));
}

export function isTextLikeFile(file) {
  return isTextLikePath(file?.name);
}

export function isAnimDataPath(path) {
  return /(?:^|[\\/])animdata\.d2$/i.test(String(path || ""));
}

export function isSupportedTablePath(path) {
  return isTextLikePath(path) || isAnimDataPath(path);
}
