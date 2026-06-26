export function isTextLikePath(path) {
  return /\.(txt|tsv|tbl|csv)$/i.test(String(path || ""));
}

export function isTextLikeFile(file) {
  return isTextLikePath(file?.name);
}
