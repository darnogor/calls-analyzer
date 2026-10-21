export function durationBelowMinimum(
  durationSec: number | undefined,
  minCallDurationSec: number,
): { error: 'duration_below_minimum'; min_call_duration_sec: number; duration_sec: number } | null {
  if (durationSec === undefined || durationSec >= minCallDurationSec) {
    return null;
  }
  return {
    error: 'duration_below_minimum',
    min_call_duration_sec: minCallDurationSec,
    duration_sec: durationSec,
  };
}
