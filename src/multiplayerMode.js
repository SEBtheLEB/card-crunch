export const MULTIPLAYER_MODE = "onlineDuel";
export const MULTIPLAYER_MATCH_SECONDS = 60;

export function isMultiplayerMode(stateOrMode) {
  return (typeof stateOrMode === "string" ? stateOrMode : stateOrMode?.gameMode) === MULTIPLAYER_MODE;
}
