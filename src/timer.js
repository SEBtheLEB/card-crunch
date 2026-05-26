export function createTurnTimer({ getState, onTick, onWarning, onTimeout }) {
  let timerId = null;
  let timerToken = 0;

  function start() {
    stop();
    const state = getState();
    const token = timerToken;
    const startedAt = performance.now();
    const totalMs = state.turnSeconds * 1000;
    let warned = false;

    timerId = window.setInterval(() => {
      const currentState = getState();
      if (token !== timerToken || currentState.locked || currentState.status !== "playing") return;

      const elapsed = performance.now() - startedAt;
      currentState.timeLeft = Math.max(0, (totalMs - elapsed) / 1000);

      if (!warned && currentState.timeLeft <= 3) {
        warned = true;
        onWarning?.(currentState);
      }

      onTick?.(currentState);
      if (currentState.timeLeft <= 0) onTimeout?.();
    }, 100);
  }

  function stop() {
    timerToken += 1;
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  return { start, stop };
}
