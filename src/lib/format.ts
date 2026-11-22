/**
 * @file        src/lib/format.ts
 * @layer       Presentation utility
 * @description Small, pure formatting helpers shared by the UI layer.
 */

/**
 * Formats a duration in seconds as a compact human string.
 *
 * @param totalSeconds - Non-negative duration in seconds.
 * @returns e.g. `"0m"`, `"45s"`, `"12m"`, `"2h 5m"`.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}

/**
 * Formats a ratio in [0, 1] as a whole-number percentage string.
 *
 * @param ratio - Completion ratio.
 * @returns e.g. `"0%"`, `"67%"`, `"100%"`.
 */
export function formatPercent(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  return `${Math.round(clamped * 100)}%`;
}
