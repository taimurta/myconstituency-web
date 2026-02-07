export function normalizePostal(input: string) {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function isLikelyCanadianPostal(postal: string) {
  // Basic pattern: A1A1A1 (Canada Post)
  return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(postal);
}
