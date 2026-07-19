export const DEAL_TIMING = Object.freeze({
  leadInMs: 35,
  flightMs: 260,
  gapMs: 14,
  landingMs: 140,
  settleBufferMs: 34,
  reducedFlightMs: 80,
  reducedLandingMs: 20,
  reducedSettleBufferMs: 0
});

export function getDealStartDelay(sequenceIndex, reducedMotion = false) {
  const index = Math.max(0, Number(sequenceIndex) || 0);
  const flightMs = reducedMotion ? DEAL_TIMING.reducedFlightMs : DEAL_TIMING.flightMs;
  const leadInMs = reducedMotion ? 0 : DEAL_TIMING.leadInMs;
  const gapMs = reducedMotion ? 0 : DEAL_TIMING.gapMs;
  return leadInMs + index * (flightMs + gapMs);
}

export function getRoundDealDuration(handCardCount, tableCardCount = 2, reducedMotion = false) {
  const handCards = Math.max(0, Number(handCardCount) || 0);
  const tableCards = Math.max(0, Number(tableCardCount) || 0);
  const totalCards = handCards + tableCards;
  if (totalCards === 0) return 0;

  const flightMs = reducedMotion ? DEAL_TIMING.reducedFlightMs : DEAL_TIMING.flightMs;
  const landingMs = reducedMotion ? DEAL_TIMING.reducedLandingMs : DEAL_TIMING.landingMs;
  const settleBufferMs = reducedMotion ? DEAL_TIMING.reducedSettleBufferMs : DEAL_TIMING.settleBufferMs;
  return getDealStartDelay(totalCards - 1, reducedMotion) + flightMs + landingMs + settleBufferMs;
}
