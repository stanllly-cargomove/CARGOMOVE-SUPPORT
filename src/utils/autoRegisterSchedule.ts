const INTERVAL_MS = 1_200_000;
const TRIGGER_OFFSET_MS = 7 * 60_000;

// These are expected trigger slots, not confirmation from GitHub Actions.
export function autoRegisterSchedule(now = Date.now(), lastAutomaticRunAt?: string | null) {
  const currentSlot = Math.floor((now - TRIGGER_OFFSET_MS) / INTERVAL_MS) * INTERVAL_MS;
  const expectedBeforeGrace = Math.floor((now - 10 * 60_000 - TRIGGER_OFFSET_MS) / INTERVAL_MS) * INTERVAL_MS + TRIGGER_OFFSET_MS;
  const actual = lastAutomaticRunAt ? Date.parse(lastAutomaticRunAt) : NaN;
  return {
    nextSlot: new Date(currentSlot + INTERVAL_MS + TRIGGER_OFFSET_MS),
    overdue: lastAutomaticRunAt !== undefined && (!Number.isFinite(actual) || actual < expectedBeforeGrace),
  };
}
