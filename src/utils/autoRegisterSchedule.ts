const INTERVAL_MS = 1_200_000;
const TRIGGER_OFFSET_MS = 7 * 60_000;

// These are expected trigger slots, not confirmation from GitHub Actions.
export function autoRegisterSchedule(now = Date.now()) {
  const currentSlot = Math.floor((now - TRIGGER_OFFSET_MS) / INTERVAL_MS) * INTERVAL_MS;
  return {
    nextSlot: new Date(currentSlot + INTERVAL_MS + TRIGGER_OFFSET_MS),
  };
}
