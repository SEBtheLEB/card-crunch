export const BOT_MATCH_DURATION_MS = 60_000;
export const BOT_MATCH_LEAD_IN_MS = 2_400;

const BOT_PROFILES = Object.freeze([
  { name: "Chip", skinId: "classic", accuracy: .84, pace: 1.08, combo: .86 },
  { name: "Dealer Byte", skinId: "dark", accuracy: .88, pace: 1, combo: 1 },
  { name: "Lady Luck.exe", skinId: "pink", accuracy: .9, pace: .95, combo: 1.08 },
  { name: "Golden Ace", skinId: "gold", accuracy: .92, pace: .9, combo: 1.16 },
  { name: "Prism Jack", skinId: "rainbow", accuracy: .93, pace: .86, combo: 1.23 }
]);

const HAND_MULTIPLIERS = Object.freeze([0, 1, 2, 4, 8]);

export function createBotDuelMatch({ player = {}, rating = 1, now = Date.now(), seed = "" } = {}) {
  const safeSeed = seed || `bot-${now}-${player.displayName || "player"}`;
  const profile = chooseBotProfile(rating, safeSeed);
  const startsAt = now + BOT_MATCH_LEAD_IN_MS;
  return {
    match: {
      id: `bot-${hashSeed(safeSeed).toString(36)}-${now.toString(36)}`,
      status: "countdown",
      startsAt,
      endsAt: startsAt + BOT_MATCH_DURATION_MS,
      durationMs: BOT_MATCH_DURATION_MS,
      you: {
        id: "local-player",
        displayName: player.displayName || "Player",
        skinId: player.skinId || "classic",
        score: 0
      },
      opponent: {
        id: `house-${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        displayName: profile.name,
        skinId: profile.skinId,
        score: 0,
        isBot: true
      },
      winner: "pending",
      isBotMatch: true
    },
    brain: createBotDuelBrain({ seed: safeSeed, rating, profile })
  };
}

export function createBotDuelBrain({ seed = "card-crunch-bot", rating = 1, profile = null } = {}) {
  const random = createSeededRandom(seed);
  const resolvedProfile = profile || chooseBotProfile(rating, seed);
  const skill = clamp(Number(rating) || 1, .82, 1.22);
  const accuracy = clamp(resolvedProfile.accuracy + (skill - 1) * .08, .78, .96);
  const pace = clamp(resolvedProfile.pace - (skill - 1) * .12, .72, 1.18);
  const comboSkill = clamp(resolvedProfile.combo + (skill - 1) * .3, .72, 1.42);
  let score = 0;
  let streak = 0;
  let runMultiplier = 1;
  let actions = 0;
  let nextDecisionAt = 520 + random() * 420;
  let lastElapsed = 0;

  return {
    profile: { ...resolvedProfile },
    advance(elapsedMs, playerScore = 0) {
      const elapsed = clamp(Number(elapsedMs) || 0, lastElapsed, BOT_MATCH_DURATION_MS);
      const events = [];
      lastElapsed = elapsed;

      while (nextDecisionAt <= elapsed && actions < 96) {
        const decisionDelay = getDecisionDelay(random, pace, score, playerScore);
        const success = random() <= accuracy;
        actions += 1;

        if (!success) {
          streak = 0;
          runMultiplier = 1;
          events.push({ type: "miss", at: nextDecisionAt, score });
          nextDecisionAt += decisionDelay + 260 + random() * 360;
          continue;
        }

        streak += 1;
        const selectionCount = chooseSelectionCount(random, comboSkill);
        const basePoints = chooseBasePoints(random, comboSkill);
        const speedMultiplier = decisionDelay <= 760 ? 3 : decisionDelay <= 980 ? 2 : decisionDelay <= 1220 ? 1.5 : 1;
        const streakMultiplier = getStreakMultiplier(streak);
        const handMultiplier = HAND_MULTIPLIERS[selectionCount];
        const earned = Math.max(100, Math.round(basePoints * handMultiplier * speedMultiplier * streakMultiplier * runMultiplier));
        score += earned;
        runMultiplier = Math.min(4, Math.round((runMultiplier + .12 + Math.max(0, selectionCount - 1) * .035) * 100) / 100);
        events.push({
          type: "crunch",
          at: nextDecisionAt,
          earned,
          score,
          streak,
          selectionCount,
          matchType: basePoints >= 700 ? "sequence" : basePoints >= 500 ? "math" : basePoints >= 300 ? "rank" : "suit"
        });
        nextDecisionAt += decisionDelay;
      }

      return { changed: events.length > 0, score, streak, actions, events };
    },
    snapshot() {
      return { score, streak, actions, elapsedMs: lastElapsed, nextDecisionAt };
    }
  };
}

export function settleBotDuelMatch(match, playerScore, opponentScore) {
  const youScore = Math.max(0, Math.floor(Number(playerScore) || 0));
  const botScore = Math.max(0, Math.floor(Number(opponentScore) || 0));
  return {
    ...match,
    status: "complete",
    you: { ...match.you, score: youScore },
    opponent: { ...match.opponent, score: botScore },
    winner: youScore === botScore ? "draw" : youScore > botScore ? "you" : "opponent"
  };
}

function chooseBotProfile(rating, seed) {
  const skill = clamp(Number(rating) || 1, .82, 1.22);
  const random = createSeededRandom(`${seed}-profile`);
  const center = Math.round((skill - .82) / .1);
  const offset = random() < .2 ? -1 : random() > .82 ? 1 : 0;
  const index = clamp(center + offset, 0, BOT_PROFILES.length - 1);
  return BOT_PROFILES[index];
}

function getDecisionDelay(random, pace, botScore, playerScore) {
  const scoreGap = Math.max(-1, Math.min(1, (Number(playerScore) - Number(botScore)) / Math.max(10_000, Number(playerScore) || 0, Number(botScore) || 0)));
  // The pressure response only changes timing by 8%; it never grants free score.
  const pressurePace = 1 - scoreGap * .08;
  return (720 + random() * 610) * pace * pressurePace;
}

function chooseSelectionCount(random, comboSkill) {
  const roll = random() * comboSkill;
  if (roll > 1.12) return 4;
  if (roll > .86) return 3;
  if (roll > .48) return 2;
  return 1;
}

function chooseBasePoints(random, comboSkill) {
  const roll = random() * comboSkill;
  if (roll > 1.08) return 700;
  if (roll > .7) return 500;
  if (roll > .26) return 300;
  return 100;
}

function getStreakMultiplier(streak) {
  if (streak >= 15) return 10;
  if (streak >= 10) return 5;
  if (streak >= 6) return 3;
  if (streak >= 3) return 2;
  return 1;
}

function createSeededRandom(seed) {
  let value = hashSeed(String(seed)) || 0x6d2b79f5;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
