const FIVE_MINUTES_SECONDS = 5 * 60;
const EXTRA_UNIT_FACTOR = 0.3;

export function formatPrepClock(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function parsePrepClock(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function calculateOrderPrepEstimate(items) {
  const longestLineSeconds = (items || []).reduce((longest, item) => {
    const baseSeconds = Math.max(0, Number(item.prep_time_seconds) || 0);
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const lineSeconds = baseSeconds * (1 + EXTRA_UNIT_FACTOR * (quantity - 1));
    return Math.max(longest, lineSeconds);
  }, 0);

  if (longestLineSeconds <= 0) return null;
  if (longestLineSeconds <= FIVE_MINUTES_SECONDS) {
    return { lowerMinutes: 0, upperMinutes: 5 };
  }

  const lowerMinutes = Math.ceil(longestLineSeconds / FIVE_MINUTES_SECONDS) * 5;
  return { lowerMinutes, upperMinutes: lowerMinutes + 5 };
}

export function formatOrderPrepEstimate(items) {
  const estimate = calculateOrderPrepEstimate(items);
  if (!estimate) return null;
  if (estimate.lowerMinutes === 0) return "até 5 min";
  return `${estimate.lowerMinutes}–${estimate.upperMinutes} min`;
}
