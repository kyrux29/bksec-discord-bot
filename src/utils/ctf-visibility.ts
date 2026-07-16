/**
 * A CTF is "live" while the current time is before its end time.
 * @param endtimeSeconds CTF end time in epoch seconds
 * @param nowSeconds current time in epoch seconds
 */
export function isCtfLive(endtimeSeconds: number, nowSeconds: number): boolean {
  return nowSeconds < endtimeSeconds;
}
