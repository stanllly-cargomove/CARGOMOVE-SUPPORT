const TWO_HOURS_MS = 7_200_000;
const TRIGGER_OFFSET_MS = 7 * 60_000;

// These are expected trigger slots, not confirmation from GitHub Actions.
export function autoRegisterSchedule(now = Date.now()) {
  const currentSlot = Math.floor((now - TRIGGER_OFFSET_MS) / TWO_HOURS_MS) * TWO_HOURS_MS;
  return {
    nextSlot: new Date(currentSlot + TWO_HOURS_MS + TRIGGER_OFFSET_MS),
  };
}
