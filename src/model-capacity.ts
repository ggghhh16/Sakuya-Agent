/** Provider metadata is authoritative; never infer limits from a model name. */
export const capacityPresets = [8192, 16384, 32768, 65536, 128000, 200000, 256000, 1000000];
export function capacityOptions(limit?: number | null, saved?: number | null) {
  return [...new Set([...capacityPresets.filter(n => !limit || n <= limit), ...(limit ? [limit] : []), ...(saved && (!limit || saved <= limit) ? [saved] : [])])].sort((a, b) => a - b);
}
