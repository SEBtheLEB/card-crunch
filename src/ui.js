import { formatRunMultiplier, getCrunchPreview } from "./gameState.js?v=78";
import { isPotUnlocked } from "./progression.js?v=78";
import { formatCompactNumber } from "./format.js?v=78";
import { hasShieldToken } from "./save.js?v=78";
import { bindInstantAction } from "./input.js?v=78";

export function createUI() {
  const renderCache = { hand: "", stack: "", counters: null };
  let bonusOfferEl = null;
  let bonusOfferTimer = null;
  const elements = {
    shell: document.querySelector("#gameShell"),
    tableZone: document.querySelector("#tableZone"),
    handZone: document.querySelector("#handZone"),
    scorePanel: document.querySelector(".score-panel"),
    scoreLabel: document.querySelector(".score-panel .hud-label"),
    scoreValue: document.querySelector("#scoreValue"),
    streakValue: document.querySelector("#streakValue"),
    timerValue: document.querySelector("#timerValue"),
    timerRing: document.querySelector("#timerRing"),
    timerShell: document.querySelector("#timerShell"),
    levelValue: document.querySelector("#levelValue"),
    targetValue: document.querySelector("#targetValue"),
    targetFill: document.querySelector("#targetFill"),
    targetStrip: document.querySelector(".target-strip"),
    crunchButton: document.querySelector("#crunchButton"),
    bankButton: document.querySelector("#bankButton"),
    bankAmountValue: document.querySelector("#bankAmountValue"),
    multiPanel: document.querySelector("#multiPanel"),
    multiValue: document.querySelector("#multiValue"),
    missValue: document.querySelector("#missValue"),
    comboLabel: document.querySelector("#comboLabel"),
    startScreen: document.querySelector("#startScreen"),
    mapScreen: document.querySelector("#mapScreen"),
    levelMap: document.querySelector("#levelMap"),
    backToMenuButton: document.querySelector("#backToMenuButton"),
    exitLevelButton: document.querySelector("#exitLevelButton"),
    hintAdButton: document.querySelector("#hintAdButton"),
    gameOverScreen: document.querySelector("#gameOverScreen"),
    runEndEyebrow: document.querySelector("#runEndEyebrow"),
    gameOverTitle: document.querySelector("#gameOverTitle"),
    runEndCopy: document.querySelector("#runEndCopy"),
    summaryBanked: document.querySelector("#summaryBanked"),
    summaryLost: document.querySelector("#summaryLost"),
    summaryLostRow: document.querySelector("#summaryLostRow"),
    summaryShield: document.querySelector("#summaryShield"),
    summaryShieldRow: document.querySelector("#summaryShieldRow"),
    summaryRecovered: document.querySelector("#summaryRecovered"),
    summaryRecoveredRow: document.querySelector("#summaryRecoveredRow"),
    summaryMultiplier: document.querySelector("#summaryMultiplier"),
    summaryStreak: document.querySelector("#summaryStreak"),
    summaryPotName: document.querySelector("#summaryPotName"),
    summaryPotPercent: document.querySelector("#summaryPotPercent"),
    summaryPotFill: document.querySelector("#summaryPotFill"),
    reviveAdButton: document.querySelector("#reviveAdButton"),
    recoverAdButton: document.querySelector("#recoverAdButton"),
    restartButton: document.querySelector("#restartButton"),
    returnToPotsButton: document.querySelector("#returnToPotsButton"),
    startButton: document.querySelector("#startButton"),
    hamburgerButton: document.querySelector("#hamburgerButton"),
    shieldAdButton: document.querySelector("#shieldAdButton"),
    menuEnergyValue: document.querySelector("#menuEnergyValue"),
    menuCoinsValue: document.querySelector("#menuCoinsValue"),
    profileBestScore: document.querySelector("#profileBestScore"),
    leaderboardBestScore: document.querySelector("#leaderboardBestScore"),
    playLeaderboardButton: document.querySelector("#playLeaderboardButton"),
    playLeaderboardStatus: document.querySelector("#playLeaderboardStatus"),
    profileStreak: document.querySelector("#profileStreak"),
    profileCrunches: document.querySelector("#profileCrunches"),
    profilePotsCleared: document.querySelector("#profilePotsCleared"),
    profileCoins: document.querySelector("#profileCoins"),
    soundToggle: document.querySelector("#soundToggle"),
    musicToggle: document.querySelector("#musicToggle"),
    motionToggle: document.querySelector("#motionToggle"),
    resetSaveButton: document.querySelector("#resetSaveButton")
  };

  const ui = {
    elements,
    render(state, handlers) {
      renderHud(elements, state);
      const stackSignature = getStackSignature(state);
      if (renderCache.stack !== stackSignature) {
        renderStack(elements, state);
        renderCache.stack = stackSignature;
      }
      renderCrunch(elements, state, handlers);
      const handSignature = getHandSignature(state);
      if (renderCache.hand !== handSignature) {
        renderHand(elements, state, handlers);
        renderCache.hand = handSignature;
      }
      elements.shell.classList.toggle("is-locked", state.locked);
    },
    setMessage(message, tone = "neutral") {
      elements.comboLabel.textContent = message;
      elements.comboLabel.dataset.tone = tone;
      elements.comboLabel.classList.remove("pop-message");
      requestAnimationFrame(() => elements.comboLabel.classList.add("pop-message"));
    },
    clearMessage() {
      elements.comboLabel.textContent = "";
      elements.comboLabel.dataset.tone = "neutral";
    },
    showStart(show) {
      elements.startScreen.classList.toggle("is-visible", show);
      elements.startScreen.setAttribute("aria-hidden", String(!show));
    },
    showMenuPage(pageName) {
      showMenuPage(elements, pageName);
    },
    renderMenuStats(state) {
      renderMenuStats(elements, state);
    },
    showMap(show) {
      elements.mapScreen.classList.toggle("is-visible", show);
      elements.mapScreen.setAttribute("aria-hidden", String(!show));
    },
    renderMap(pots, handlers, savedLevelId = null) {
      elements.levelMap.innerHTML = "";
      pots.forEach((pot) => {
        const button = document.createElement("button");
        const progress = pot.target > 0 ? Math.min(1, pot.progress / pot.target) : 0;
        const hasSavedRun = savedLevelId === pot.id && !pot.complete;
        const locked = !isPotUnlocked(pots, pot.id);
        button.className = `map-pot ${pot.complete ? "is-complete" : ""} ${hasSavedRun ? "has-save" : ""} ${locked ? "is-locked" : ""}`;
        button.type = "button";
        button.disabled = locked || pot.complete;
        button.setAttribute("aria-disabled", String(button.disabled));
        button.innerHTML = `
          <span>${locked ? "Locked" : hasSavedRun ? "Continue" : "Pot"} ${pot.id}</span>
          <strong>${locked ? "LOCK" : hasSavedRun ? "Saved" : pot.complete ? "Full" : formatCompactNumber(Math.max(0, pot.target - pot.progress))}</strong>
          <small>${locked ? "Clear prior pot" : pot.complete ? "Cleared" : `${Math.round(progress * 100)}% full`}</small>
          <i><b style="width: ${progress * 100}%"></b></i>
        `;
        bindInstantAction(button, () => handlers.onLevelSelect(pot.id));
        elements.levelMap.appendChild(button);
      });
    },
    showGameOver(show) {
      elements.gameOverScreen.classList.toggle("is-visible", show);
      elements.gameOverScreen.setAttribute("aria-hidden", String(!show));
    },
    /* End-of-run summary: pot progress, banked/lost cash, ad options. */
    showRunSummary(summary) {
      const potComplete = Boolean(summary.pot?.complete);
      elements.runEndEyebrow.textContent = potComplete ? "Run Complete" : "Out of Lives";
      elements.gameOverTitle.textContent = potComplete ? "Pot Filled!" : "Run Over";
      elements.runEndCopy.textContent = getRunEndCopy(summary, potComplete);

      elements.summaryBanked.textContent = `$${formatCompactNumber(summary.banked)}`;
      elements.summaryLost.textContent = `-$${formatCompactNumber(summary.lost)}`;
      elements.summaryLostRow.hidden = summary.lost <= 0;
      elements.summaryShield.textContent = `+$${formatCompactNumber(summary.shieldSaved)}`;
      elements.summaryShieldRow.hidden = summary.shieldSaved <= 0;
      elements.summaryRecovered.textContent = `+$${formatCompactNumber(summary.recovered)}`;
      elements.summaryRecoveredRow.hidden = summary.recovered <= 0;
      elements.summaryMultiplier.textContent = `x${formatRunMultiplier(summary.bestMultiplier)}`;
      elements.summaryStreak.textContent = String(summary.bestStreak);

      if (summary.pot) {
        const percent = summary.pot.target > 0 ? Math.min(1, summary.pot.progress / summary.pot.target) : 0;
        elements.summaryPotName.textContent = `Pot ${summary.pot.id}`;
        elements.summaryPotPercent.textContent = potComplete ? "FULL!" : `${Math.round(percent * 100)}%`;
        elements.summaryPotFill.style.width = `${percent * 100}%`;
        elements.summaryPotFill.parentElement.parentElement.hidden = false;
      } else {
        elements.summaryPotFill.parentElement.parentElement.hidden = true;
      }

      elements.reviveAdButton.hidden = !summary.canRevive;
      elements.recoverAdButton.hidden = !summary.canRecover;
      elements.restartButton.hidden = potComplete;

      this.showGameOver(true);
    },
    /* Rewarded offer chip shown after a bank deposit; expires quietly. */
    showBonusBankOffer(bonusAmount, onWatch) {
      this.hideBonusBankOffer();
      const offer = document.createElement("button");
      offer.type = "button";
      offer.className = "bonus-bank-offer";
      offer.innerHTML = `
        <i aria-hidden="true">&#9654;</i>
        <span>+$${formatCompactNumber(bonusAmount)} bank bonus</span>
        <small>Watch ad</small>
      `;
      bindInstantAction(offer, () => {
        this.hideBonusBankOffer();
        onWatch();
      });
      document.body.appendChild(offer);
      bonusOfferEl = offer;
      bonusOfferTimer = window.setTimeout(() => this.hideBonusBankOffer(), 12000);
    },
    hideBonusBankOffer() {
      if (bonusOfferTimer) {
        window.clearTimeout(bonusOfferTimer);
        bonusOfferTimer = null;
      }
      if (bonusOfferEl) {
        bonusOfferEl.remove();
        bonusOfferEl = null;
      }
    },
    playBankJuice(amount) {
      const bankRect = elements.bankButton.getBoundingClientRect();
      const potRect = elements.targetStrip.getBoundingClientRect();
      const fly = document.createElement("div");
      fly.className = "cutin-bank-fly bank-deposit-fly";
      fly.textContent = `+$${formatCompactNumber(amount)}`;
      fly.style.left = `${bankRect.left + bankRect.width / 2}px`;
      fly.style.top = `${bankRect.top + bankRect.height / 2}px`;
      fly.style.setProperty("--fly-x", `${potRect.left + potRect.width / 2 - (bankRect.left + bankRect.width / 2)}px`);
      fly.style.setProperty("--fly-y", `${potRect.top + potRect.height / 2 - (bankRect.top + bankRect.height / 2)}px`);
      document.body.appendChild(fly);
      window.setTimeout(() => fly.remove(), 620);
      sprayFromElement(elements.bankButton, "green");
      elements.targetStrip.classList.remove("target-clear-bump");
      window.setTimeout(() => {
        sprayFromElement(elements.targetStrip, "gold");
        elements.targetStrip.classList.add("target-clear-bump");
        window.setTimeout(() => elements.targetStrip.classList.remove("target-clear-bump"), 760);
      }, 480);
      navigator.vibrate?.(20);
    },
    playReviveJuice() {
      sprayFromElement(elements.missValue, "red");
      popCounter(elements.missValue, "red");
      navigator.vibrate?.(16);
    },
    flashHint(handIndex) {
      const card = this.getHandCardElement(handIndex);
      if (!card) return;
      card.classList.add("hint-glow");
      sprayFromElement(card, "blue");
      window.setTimeout(() => card.classList.remove("hint-glow"), 3200);
    },
    getHandCardElement(index) {
      return elements.handZone.querySelector(`[data-hand-index="${index}"]`);
    },
    getAllStackCardElements() {
      return [...elements.tableZone.querySelectorAll("[data-stack-card]")];
    }
  };

  return ui;
}

/* Runs every 100ms while the timer ticks: every write is value-guarded so
   unchanged frames touch zero DOM and cause zero style invalidation. */
function renderHud(elements, state) {
  const cache = elements._hudCache ?? (elements._hudCache = {});
  const previousCounters = elements._counterCache ?? null;
  const isEndless = !state.activePot && state.level === 0;
  const potProgress = state.activePot
    ? {
        progress: Math.min(1, state.activePot.progress / state.activePot.target),
        remaining: Math.max(0, state.activePot.target - state.activePot.progress)
      }
    : { progress: 0, remaining: isEndless ? "Endless" : 0 };

  setText(elements.scoreValue, formatCompactNumber(state.score), cache, "score");
  setText(elements.streakValue, String(state.streak ?? 0), cache, "streak");
  setText(elements.timerValue, String(Math.ceil(state.timeLeft)), cache, "timer");
  const livesLeft = Math.max(0, (state.maxMisses ?? 3) - (state.misses ?? 0));
  setText(elements.missValue, "\u2665".repeat(livesLeft) + "\u2661".repeat(Math.max(0, (state.maxMisses ?? 3) - livesLeft)), cache, "lives");
  setText(elements.levelValue, isEndless ? "\u221e" : String(state.level ?? 1), cache, "level");
  setText(
    elements.targetValue,
    typeof potProgress.remaining === "number" ? formatCompactNumber(potProgress.remaining) : potProgress.remaining,
    cache,
    "target"
  );

  const targetValue = potProgress.progress.toFixed(4);
  if (cache.targetProgress !== targetValue) {
    cache.targetProgress = targetValue;
    elements.targetFill.style.setProperty("--target-progress", targetValue);
  }
  const timerValue = (state.timeLeft / state.turnSeconds).toFixed(3);
  if (cache.timerProgress !== timerValue) {
    cache.timerProgress = timerValue;
    elements.timerRing.style.setProperty("--timer-progress", timerValue);
  }

  elements.timerShell.classList.toggle("timer-danger", state.timeLeft <= 3 && state.status === "playing");
  elements.shell.classList.toggle("fever-mode", Boolean(state.fever));
  elements.shell.classList.toggle("streak-warm", state.streak >= 3);
  elements.shell.classList.toggle("streak-hot", state.streak >= 6);
  elements.shell.classList.toggle("streak-blaze", state.streak >= 10);

  if (previousCounters) {
    if (state.score > previousCounters.score) popCounter(elements.scoreValue, "gold");
    if (state.streak > previousCounters.streak) popCounter(elements.streakValue, state.streak >= 10 ? "fever" : "gold");
    if (state.misses > previousCounters.misses) popCounter(elements.missValue, "red");
  }

  elements._counterCache = {
    score: state.score,
    streak: state.streak,
    misses: state.misses
  };
}

function setText(element, value, cache, key) {
  if (!element || cache[key] === value) return;
  cache[key] = value;
  element.textContent = value;
}

function showMenuPage(elements, pageName = "home") {
  elements.startScreen.querySelectorAll("[data-page]").forEach((page) => {
    page.classList.toggle("is-active", page.dataset.page === pageName);
  });
  elements.startScreen.querySelectorAll("[data-menu-page]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.menuPage === pageName);
  });
}

function renderMenuStats(elements, state) {
  const coins = Number(localStorage.getItem("cardCrunchCoins") ?? 0);
  const totalCrunches = Number(localStorage.getItem("cardCrunchTotalCrunches") ?? 0);
  const bestStreak = Math.max(Number(localStorage.getItem("cardCrunchBestStreak") ?? 0), state.streak ?? 0);
  const potsCleared = state.pots?.filter((pot) => pot.complete).length ?? 0;

  if (elements.menuEnergyValue) elements.menuEnergyValue.textContent = String(state.turnSeconds - 2);
  if (elements.menuCoinsValue) elements.menuCoinsValue.textContent = formatCompactNumber(state.bestScore ?? coins);
  if (elements.profileBestScore) elements.profileBestScore.textContent = formatCompactNumber(state.bestScore ?? 0);
  if (elements.leaderboardBestScore) elements.leaderboardBestScore.textContent = formatCompactNumber(state.bestScore ?? 0);
  if (elements.profileStreak) elements.profileStreak.textContent = String(bestStreak);
  if (elements.profileCrunches) elements.profileCrunches.textContent = `${formatCompactNumber(totalCrunches)} crunches`;
  if (elements.profilePotsCleared) elements.profilePotsCleared.textContent = String(potsCleared);
  if (elements.profileCoins) elements.profileCoins.textContent = formatCompactNumber(coins);
  refreshShieldOffer(elements);
}

function refreshShieldOffer(elements) {
  if (!elements.shieldAdButton) return;
  const armed = hasShieldToken();
  elements.shieldAdButton.disabled = armed;
  elements.shieldAdButton.classList.toggle("is-armed", armed);
  const label = elements.shieldAdButton.querySelector("span");
  const sub = elements.shieldAdButton.querySelector("small");
  if (label) label.textContent = armed ? "Shield armed for next run" : "Safe Bank Shield";
  if (sub) sub.textContent = armed ? "Bust out and 25% of run cash auto-banks" : "Watch ad \u2022 auto-bank 25% if you bust out";
}

function popCounter(element, tone = "gold") {
  if (!element) return;
  element.classList.remove("counter-juice", "counter-juice-gold", "counter-juice-red", "counter-juice-blue", "counter-juice-fever");
  void element.offsetWidth;
  element.classList.add("counter-juice", `counter-juice-${tone}`);
  sprayFromElement(element, tone);
}

function sprayFromElement(element, tone = "gold") {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const colors = {
    gold: ["#ffe894", "#ffbf3f", "#fff8d0"],
    red: ["#ff746f", "#ff443d", "#ffd2d0"],
    blue: ["#76c6ff", "#42a1ff", "#e0f3ff"],
    green: ["#7ff0a2", "#2ecc80", "#d7ffe2"],
    fever: ["#ffe894", "#ff7439", "#fff8d0"]
  }[tone] ?? ["#ffe894", "#ffbf3f"];

  for (let i = 0; i < 16; i += 1) {
    const spark = document.createElement("i");
    const angle = Math.random() * Math.PI * 2;
    const distance = 18 + Math.random() * 42;
    spark.className = "counter-spark";
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.color = colors[i % colors.length];
    spark.style.setProperty("--spark-x", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--spark-y", `${Math.sin(angle) * distance}px`);
    spark.style.setProperty("--spark-scale", `${.7 + Math.random() * .9}`);
    document.body.appendChild(spark);
    spark.addEventListener("animationend", () => spark.remove(), { once: true });
  }
}

function renderStack(elements, state) {
  elements.tableZone.innerHTML = '<div class="combo-line" id="comboLine"></div>';
  elements.tableZone.style.setProperty("--stack-count", String(state.stack.length));
  elements.tableZone.style.setProperty("--stack-size", "clamp(118px, 40vw, 190px)");
  state.stack.forEach((card, index) => {
    const slot = document.createElement("div");
    slot.className = "table-card-slot stack-slot base-stack-card";
    slot.dataset.stackSlot = String(index);
    slot.style.setProperty("--stack-rotate", `${index === 0 ? -4 : 4}deg`);
    const cardEl = createCard(card, { stackIndex: index });
    dealIn(cardEl, index * 70);
    slot.appendChild(cardEl);
    elements.tableZone.appendChild(slot);
  });
}

function renderCrunch(elements, state, handlers) {
  const cache = elements._crunchCache ?? (elements._crunchCache = {});
  const preview = getCrunchPreview(state);
  const playing = !state.locked && state.status === "playing";

  // The handlers object is created once per game, so bind exactly once
  // instead of re-assigning listeners on every 100ms render tick.
  if (cache.handlers !== handlers) {
    cache.handlers = handlers;
    bindInstantAction(elements.bankButton, () => cache.handlers.onBank?.());
    bindInstantAction(elements.crunchButton, () => cache.handlers.onCrunch?.());
  }

  setText(elements.multiValue, `x${formatRunMultiplier(state.bankMultiplier ?? 1)}`, cache, "multi");
  elements.multiPanel.classList.toggle("multi-warm", (state.bankMultiplier ?? 1) >= 2);
  elements.multiPanel.classList.toggle("multi-hot", (state.bankMultiplier ?? 1) >= 4);

  const canBank = playing && Boolean(state.activePot) && state.score > 0;
  if (cache.canBank !== canBank) {
    cache.canBank = canBank;
    elements.bankButton.disabled = !canBank;
    elements.bankButton.classList.toggle("bank-ready", canBank);
  }
  setText(elements.bankAmountValue, `$${formatCompactNumber(state.score ?? 0)}`, cache, "bankAmount");

  if (elements.hintAdButton) {
    const hintHidden = state.hintAdUsedThisRun || state.status === "menu";
    const hintDisabled = !playing || state.hintAdUsedThisRun;
    if (cache.hintHidden !== hintHidden) {
      cache.hintHidden = hintHidden;
      elements.hintAdButton.hidden = hintHidden;
    }
    if (cache.hintDisabled !== hintDisabled) {
      cache.hintDisabled = hintDisabled;
      elements.hintAdButton.disabled = hintDisabled;
    }
  }

  const crunchDisabled = state.locked || state.status !== "playing" || !preview.canCrunch;
  if (cache.crunchDisabled !== crunchDisabled) {
    cache.crunchDisabled = crunchDisabled;
    elements.crunchButton.disabled = crunchDisabled;
  }
  setText(elements.crunchButton, preview.canCrunch ? `CRUNCH ${preview.selectedCount}` : "SELECT CARDS", cache, "crunchLabel");
  elements.crunchButton.classList.toggle("crunch-ready", preview.canCrunch);
  elements.crunchButton.classList.toggle("crunch-greedy", preview.selectedCount >= 3);
  elements.crunchButton.classList.toggle("crunch-danger", preview.canCrunch && state.timeLeft <= 3);
}

/* Patch the hand in place. Rebuilding a card element on every selection
   was the source of ghost double-taps (the browser's compatibility click
   landed on the freshly-created element and toggled the selection right
   back off) and of transitions snapping instead of animating. A slot's
   element is only replaced when a genuinely new card is dealt into it. */
function renderHand(elements, state, handlers) {
  const zone = elements.handZone;
  const disabled = state.locked || state.status !== "playing";

  for (let index = 0; index < 4; index += 1) {
    const card = state.hand[index] ?? null;
    let button = zone.querySelector(`[data-hand-index="${index}"]`);

    if (!card) {
      button?.remove();
      continue;
    }

    if (!button || button.dataset.cardId !== card.id) {
      const fresh = createCard(card, { handIndex: index, isButton: true });
      fresh.dataset.cardId = card.id;
      dealIn(fresh, index * 45);
      bindInstantAction(fresh, () => handlers.onCardSelect(index));
      if (button) {
        zone.replaceChild(fresh, button);
      } else {
        const nextSibling = [...zone.children].find((el) => Number(el.dataset.handIndex) > index) ?? null;
        zone.insertBefore(fresh, nextSibling);
      }
      button = fresh;
    }

    const order = state.selectedHandIndexes.indexOf(index);
    button.classList.toggle("is-hand-selected", order >= 0);
    if (order >= 0) {
      button.dataset.order = String(order + 1);
    } else {
      delete button.dataset.order;
    }
    if (button.disabled !== disabled) button.disabled = disabled;
  }
}

/* Staggered deal-in pop for newly drawn cards. The delay is cleared on a
   timer so it never postpones later animations (tap pops, shakes). */
function dealIn(element, delayMs) {
  element.classList.add("card-enter");
  if (delayMs > 0) element.style.animationDelay = `${delayMs}ms`;
  window.setTimeout(() => {
    element.classList.remove("card-enter");
    element.style.animationDelay = "";
  }, 420 + delayMs);
}

function getRunEndCopy(summary, potComplete) {
  if (potComplete) return "That pot is full. Your banked cash is safe, and the next pot is ready.";
  if (summary.canRevive) return "Watch an ad to revive with 1 life and keep this risky run alive.";
  if (summary.canRecover) return "Watch an ad to recover half of your lost cash into this pot.";
  if (summary.lost > 0) return "Unbanked cash was lost. Bank earlier next run, or try again for a bigger pot.";
  return "No unbanked cash was lost. Shuffle up and start another run.";
}

function createCard(card, options = {}) {
  const element = document.createElement(options.isButton ? "button" : "div");
  element.className = `card card-${card.color} card-${card.suit}`;
  element.type = options.isButton ? "button" : undefined;
  element.setAttribute("aria-label", `${card.rank} of ${card.suit}`);

  if (Number.isInteger(options.handIndex)) {
    element.dataset.handIndex = String(options.handIndex);
    element.style.setProperty("--fan-rotate", `${[-8, -3, 3, 8][options.handIndex] ?? 0}deg`);
  }
  if (Number.isInteger(options.stackIndex)) {
    element.dataset.stackCard = String(options.stackIndex);
  }

  element.innerHTML = `
    <span class="card-corner card-corner-top">
      <span>${card.rank}</span>
      <span>${card.suitSymbol}</span>
    </span>
    <span class="card-center">
      <span class="card-rank">${card.rank}</span>
      <span class="card-pips" aria-hidden="true"><span class="hero-pip">${card.suitSymbol}</span></span>
    </span>
    <span class="card-corner card-corner-bottom">
      <span>${card.rank}</span>
      <span>${card.suitSymbol}</span>
    </span>
  `;

  return element;
}

function getStackSignature(state) {
  return state.stack.map((card) => card.id).join("|");
}

function getHandSignature(state) {
  return [
    state.hand.map((card) => card.id).join("|"),
    state.selectedHandIndexes.join("|"),
    state.locked ? "locked" : "open",
    state.status
  ].join("::");
}
