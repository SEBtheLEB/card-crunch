import { playGameSfx } from "./audio.js?v=90";
import { animateSelectionResolve, playSfx, spawnSparkBurst } from "./animations.js?v=90";
import { animateCardTransfer, bindCardGesture } from "./cardGestures.js?v=90";
import {
  createCrunchBankCounter,
  playBustCutin,
  playCrunchEntryExplanation,
  playCrunchTotalExplanation,
  resetCrunchSkipRequest
} from "./crunchCutscene.js?v=90";
import { formatCompactNumber } from "./format.js?v=90";
import { bindInstantAction } from "./input.js?v=90";
import { calculateCrunchScore } from "./scoring.js?v=90";

const SUITS = {
  hearts: { suitSymbol: "&hearts;", color: "red", label: "Hearts" },
  diamonds: { suitSymbol: "&diams;", color: "red", label: "Diamonds" },
  spades: { suitSymbol: "&spades;", color: "black", label: "Spades" },
  clubs: { suitSymbol: "&clubs;", color: "black", label: "Clubs" }
};

function card(rank, value, suit) {
  return { id: `tutorial-${rank}-${suit}`, rank, value, suit, ...SUITS[suit] };
}

const LESSONS = [
  {
    label: "Match 1",
    title: "Suit Match",
    instruction: "A Heart is on the table. Tap the 9 of Hearts, then press CRUNCH.",
    detail: "Cards with the same suit connect. Their numbers can be different.",
    table: [card("5", 5, "hearts"), card("K", 13, "clubs")],
    hand: [card("9", 9, "hearts"), card("2", 2, "spades"), card("Q", 12, "diamonds"), card("4", 4, "spades")],
    expected: [0],
    matchedTable: [0],
    success: "SUIT MATCH"
  },
  {
    label: "Match 2",
    title: "Number Match",
    instruction: "The table has a 7. Tap your 7 of Hearts, then CRUNCH.",
    detail: "A matching number beats a suit match and pays more.",
    table: [card("7", 7, "spades"), card("10", 10, "diamonds")],
    hand: [card("7", 7, "hearts"), card("2", 2, "clubs"), card("Q", 12, "hearts"), card("5", 5, "clubs")],
    expected: [0],
    matchedTable: [0],
    success: "NUMBER MATCH"
  },
  {
    label: "Combo 1",
    title: "Plus Crunch",
    instruction: "The table shows 3 and 5. Tap the 8, because 3 + 5 = 8.",
    detail: "Plus uses both table cards and is one of your strongest Crunches.",
    table: [card("3", 3, "diamonds"), card("5", 5, "spades")],
    hand: [card("8", 8, "hearts"), card("Q", 12, "clubs"), card("J", 11, "hearts"), card("6", 6, "clubs")],
    expected: [0],
    matchedTable: [0, 1],
    success: "PLUS CRUNCH"
  },
  {
    label: "Combo 2",
    title: "Minus Crunch",
    instruction: "The table shows 10 and 7. Tap the 3, because 10 - 7 = 3.",
    detail: "For minus, subtract the smaller card from the larger card.",
    table: [card("10", 10, "diamonds"), card("7", 7, "spades")],
    hand: [card("3", 3, "hearts"), card("Q", 12, "clubs"), card("A", 1, "hearts"), card("6", 6, "clubs")],
    expected: [0],
    matchedTable: [0, 1],
    success: "MINUS CRUNCH"
  },
  {
    label: "Big Play",
    title: "Full-Hand Crunch",
    instruction: "Tap in order: 8 Hearts, K Spades, 2 Clubs, then 9 Diamonds. Then CRUNCH all four.",
    detail: "Each resolved card joins the stack and can unlock the next. Four cards earns the huge x8 hand multiplier.",
    table: [card("3", 3, "diamonds"), card("5", 5, "spades")],
    hand: [card("8", 8, "hearts"), card("K", 13, "spades"), card("2", 2, "clubs"), card("9", 9, "diamonds")],
    expected: [0, 1, 2, 3],
    matchedTable: [0, 1],
    success: "FULL CRUNCH!  ALL 4 CARDS  HAND x8"
  },
  {
    type: "bank",
    label: "Stay Safe",
    title: "Bank Your Cash",
    instruction: "Your run cash is unbanked and can be lost. Tap BANK to save it in your pot.",
    detail: "Successful Crunches grow MULTI. Banking saves your cash, but resets MULTI to x1.",
    table: [card("A", 1, "hearts"), card("K", 13, "spades")],
    hand: [card("6", 6, "clubs"), card("10", 10, "diamonds"), card("4", 4, "hearts"), card("Q", 12, "spades")]
  }
];

export function initializeTutorial() {
  const root = document.querySelector("#tutorialPage");
  if (!root) return { reset() {} };

  const elements = {
    progress: root.querySelector("#tutorialProgress"),
    stepLabel: root.querySelector("#tutorialStepLabel"),
    title: root.querySelector("#tutorialStepTitle"),
    instruction: root.querySelector("#tutorialInstruction"),
    detail: root.querySelector("#tutorialDetail"),
    practice: root.querySelector("#tutorialPractice"),
    cash: root.querySelector("#tutorialCashValue"),
    multiplier: root.querySelector("#tutorialMultiplierValue"),
    table: root.querySelector("#tutorialTable"),
    selectedTray: root.querySelector("#tutorialSelectedCardTray"),
    hand: root.querySelector("#tutorialHand"),
    feedback: root.querySelector("#tutorialFeedback"),
    actions: root.querySelector(".tutorial-actions"),
    bankButton: root.querySelector("#tutorialBankButton"),
    bankAmount: root.querySelector("#tutorialBankAmount"),
    crunchButton: root.querySelector("#tutorialCrunchButton"),
    nextButton: root.querySelector("#tutorialNextButton"),
    finishButton: root.querySelector("#tutorialFinishButton")
  };

  let lessonIndex = 0;
  let selectedIndexes = [];
  let resolved = false;
  let resolving = false;
  let practiceCash = 0;
  let practiceMultiplier = 1;
  let gestureCleanups = [];

  bindInstantAction(elements.crunchButton, resolveCrunch);
  bindInstantAction(elements.bankButton, bankPracticeCash);
  bindInstantAction(elements.nextButton, showNextLesson);

  window.addEventListener("card-crunch-menu-page-change", (event) => {
    if (event.detail?.pageName === "tutorial") reset();
  });

  function reset() {
    lessonIndex = 0;
    practiceCash = 0;
    practiceMultiplier = 1;
    resolving = false;
    resetCrunchSkipRequest();
    renderLesson();
  }

  function renderLesson() {
    const lesson = LESSONS[lessonIndex];
    if (!lesson) {
      renderCompletion();
      return;
    }

    selectedIndexes = [];
    resolved = false;
    resolving = false;
    gestureCleanups.forEach((cleanup) => cleanup());
    gestureCleanups = [];
    root.classList.remove("is-tutorial-complete", "is-tutorial-success", "is-tutorial-wrong");
    elements.practice.classList.remove("is-bank-lesson");
    elements.progress.textContent = `Lesson ${lessonIndex + 1} of ${LESSONS.length}`;
    elements.stepLabel.textContent = lesson.label;
    elements.title.textContent = lesson.title;
    elements.instruction.textContent = lesson.type === "bank"
      ? `Your $${formatCompactNumber(practiceCash)} is unbanked and can be lost. Tap BANK to save it in your pot.`
      : lesson.instruction;
    elements.detail.textContent = lesson.detail;
    elements.feedback.textContent = lesson.type === "bank" ? "Banking is a choice. Bank before the run turns against you." : "Select the card shown above.";
    elements.actions.hidden = false;
    elements.nextButton.hidden = true;
    elements.finishButton.hidden = true;

    setCash(practiceCash);
    setMultiplier(practiceMultiplier);
    renderCards(elements.table, lesson.table, { table: true });
    renderCards(elements.hand, lesson.hand, { interactive: lesson.type !== "bank" });
    elements.selectedTray.replaceChildren();

    if (lesson.type === "bank") {
      elements.practice.classList.add("is-bank-lesson");
      elements.bankButton.disabled = false;
      elements.bankAmount.textContent = `$${formatCompactNumber(practiceCash)}`;
      elements.crunchButton.disabled = true;
      elements.crunchButton.textContent = "BANK CASH FIRST";
    } else {
      elements.bankButton.disabled = true;
      elements.bankAmount.textContent = "$0";
      updateSelectionUI();
    }
  }

  function renderCards(zone, cards, { table = false, interactive = false } = {}) {
    zone.replaceChildren();
    cards.forEach((tutorialCard, index) => {
      const cardElement = createTutorialCard(tutorialCard, interactive ? "button" : "div");
      cardElement.style.setProperty("--tutorial-fan", `${[-5, -2, 2, 5][index] ?? 0}deg`);
      cardElement.style.setProperty("--fan-rotate", `${[-8, -3, 3, 8][index] ?? 0}deg`);
      let slot = null;
      if (table) {
        slot = document.createElement("div");
        slot.className = "table-card-slot tutorial-table-card-slot";
        cardElement.dataset.tutorialTableIndex = String(index);
      }
      if (interactive) {
        slot = document.createElement("div");
        slot.className = "hand-card-slot tutorial-hand-card-slot";
        slot.dataset.tutorialHandSlot = String(index);
        cardElement.dataset.tutorialHandIndex = String(index);
        gestureCleanups.push(bindCardGesture(cardElement, () => toggleCard(index)));
      }
      if (slot) {
        slot.appendChild(cardElement);
        zone.appendChild(slot);
      } else {
        zone.appendChild(cardElement);
      }
    });
  }

  function toggleCard(index) {
    if (resolved || resolving || LESSONS[lessonIndex]?.type === "bank") return;
    const cardElement = getHandCard(index);
    if (!cardElement) return;
    const fromRect = cardElement.getBoundingClientRect();
    const selectedAt = selectedIndexes.indexOf(index);
    if (selectedAt >= 0) {
      selectedIndexes.splice(selectedAt, 1);
      getHandSlot(index)?.appendChild(cardElement);
      playGameSfx("card_deselect");
    } else {
      selectedIndexes.push(index);
      elements.selectedTray.appendChild(cardElement);
      playGameSfx("card_select");
    }
    root.classList.remove("is-tutorial-wrong");
    elements.feedback.textContent = selectedIndexes.length ? "Ready when you are. Press CRUNCH." : "Select the card shown above.";
    updateSelectionUI();
    animateCardTransfer(cardElement, fromRect, cardElement.getBoundingClientRect(), { withTrail: true });
  }

  function updateSelectionUI() {
    const lesson = LESSONS[lessonIndex];
    root.querySelectorAll("[data-tutorial-hand-index]").forEach((cardElement) => {
      const index = Number(cardElement.dataset.tutorialHandIndex);
      const order = selectedIndexes.indexOf(index);
      const orderLabel = cardElement.querySelector(".tutorial-card-order");
      cardElement.classList.toggle("is-tutorial-selected", order >= 0);
      cardElement.classList.toggle("is-staged-card", order >= 0);
      cardElement.classList.toggle("is-tutorial-guided", !resolved && lesson.expected?.[selectedIndexes.length] === index);
      cardElement.setAttribute("aria-pressed", String(order >= 0));
      cardElement.setAttribute("aria-label", `${lesson.hand[index].rank} of ${lesson.hand[index].label}${order >= 0 ? `, staged ${order + 1}` : ""}`);
      cardElement.disabled = resolved || resolving;
      orderLabel.hidden = order < 0;
      orderLabel.textContent = order >= 0 ? String(order + 1) : "";
    });
    root.querySelectorAll("[data-tutorial-hand-slot]").forEach((slot) => {
      slot.classList.toggle("is-staged", selectedIndexes.includes(Number(slot.dataset.tutorialHandSlot)));
    });
    elements.selectedTray.dataset.count = String(selectedIndexes.length);
    elements.selectedTray.setAttribute("aria-label", selectedIndexes.length
      ? `${selectedIndexes.length} card${selectedIndexes.length === 1 ? "" : "s"} staged for Crunch`
      : "No cards staged for Crunch");
    elements.crunchButton.disabled = selectedIndexes.length === 0 || resolving || resolved;
    elements.crunchButton.textContent = selectedIndexes.length ? `CRUNCH ${selectedIndexes.length}` : "SELECT A CARD";
  }

  async function resolveCrunch() {
    const lesson = LESSONS[lessonIndex];
    if (!lesson || lesson.type === "bank" || resolved || resolving || selectedIndexes.length === 0) return;
    resolving = true;
    updateSelectionUI();
    resetCrunchSkipRequest();
    playSfx("crunch_start");

    const selectedCards = selectedIndexes.map((index) => lesson.hand[index]);
    const crunch = calculateCrunchScore({
      baseStack: lesson.table,
      selectedCards,
      timeLeft: 0,
      streak: 0,
      runMultiplier: practiceMultiplier
    });

    const correct = selectedIndexes.length === lesson.expected.length
      && selectedIndexes.every((index, position) => index === lesson.expected[position]);
    if (!correct || !crunch.success) {
      if (crunch.success) {
        root.classList.remove("is-tutorial-wrong");
        void root.offsetWidth;
        root.classList.add("is-tutorial-wrong");
        elements.feedback.textContent = lesson.expected.length > 1
          ? "That can Crunch, but this lesson needs all four in the order shown. Keep building the chain."
          : "Use the exact card named above for this lesson.";
        resolving = false;
        updateSelectionUI();
        return;
      }

      await playBustCutin({
        failedCard: crunch.resolution.failedCard ?? selectedCards[0],
        activeStack: crunch.resolution.activeStack ?? lesson.table
      });
      root.classList.remove("is-tutorial-wrong");
      void root.offsetWidth;
      root.classList.add("is-tutorial-wrong");
      elements.feedback.textContent = lesson.expected.length > 1
        ? "Not quite. Select all four in the order shown, then try again."
        : "Not quite. Deselect that card and follow the card named above.";
      await returnSelectedCardsToHand();
      resolving = false;
      updateSelectionUI();
      return;
    }

    const selectedCardElements = selectedIndexes.map((index) => getHandCard(index));
    const baseStackElements = [...elements.table.querySelectorAll("[data-tutorial-table-index]")];
    const crunchBank = createCrunchBankCounter({ startingValue: practiceCash });

    try {
      await animateSelectionResolve({
        selectedHandCards: selectedCardElements,
        baseStackCards: baseStackElements,
        resolution: crunch.resolution,
        fail: false,
        onEntryResolved: async (entry, index) => {
          elements.feedback.textContent = crunch.cutscene.entries[index]?.label ?? entry.cutinLabel ?? entry.label;
          await playCrunchEntryExplanation({
            entry: crunch.cutscene.entries[index],
            tier: crunch.cutscene.tier,
            bank: crunchBank
          });
        }
      });

      await playCrunchTotalExplanation({
        total: crunch.total,
        scoreEl: elements.cash,
        tier: crunch.cutscene.tier,
        breakdown: crunch.breakdown,
        bank: crunchBank
      });
    } finally {
      crunchBank.remove();
    }

    practiceCash += crunch.total;
    practiceMultiplier = Math.min(10, Math.round((practiceMultiplier + 0.2 + Math.max(0, selectedIndexes.length - 1) * 0.1) * 10) / 10);
    resolved = true;
    resolving = false;
    root.classList.add("is-tutorial-success");
    selectedCardElements.forEach((cardElement) => cardElement?.classList.add("is-tutorial-resolved"));
    elements.feedback.textContent = `${lesson.success}  +${formatCompactNumber(crunch.total)}`;
    setCash(practiceCash);
    setMultiplier(practiceMultiplier);
    updateSelectionUI();
    elements.bankButton.disabled = true;
    elements.nextButton.textContent = lessonIndex === LESSONS.length - 2 ? "Learn To Bank" : "Next Lesson";
    elements.nextButton.hidden = false;
  }

  async function bankPracticeCash() {
    const lesson = LESSONS[lessonIndex];
    if (!lesson || lesson.type !== "bank" || resolved || resolving) return;
    resolving = true;
    elements.bankButton.disabled = true;
    const amount = practiceCash;
    const rect = elements.bankButton.getBoundingClientRect();
    elements.bankButton.classList.add("is-tutorial-banking");
    playGameSfx("bank");
    spawnSparkBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 26, "gold");
    await sleep(360);
    resolved = true;
    resolving = false;
    root.classList.add("is-tutorial-success");
    elements.bankButton.classList.remove("is-tutorial-banking");
    practiceCash = 0;
    practiceMultiplier = 1;
    setCash(0);
    setMultiplier(1);
    elements.bankAmount.textContent = "$0";
    elements.bankButton.disabled = true;
    elements.feedback.textContent = `$${formatCompactNumber(amount)} BANKED!  Your multiplier reset to x1.`;
    elements.nextButton.textContent = "Finish Tutorial";
    elements.nextButton.hidden = false;
  }

  function showNextLesson() {
    if (!resolved) return;
    lessonIndex += 1;
    renderLesson();
  }

  function renderCompletion() {
    root.classList.add("is-tutorial-complete");
    root.classList.remove("is-tutorial-success", "is-tutorial-wrong");
    elements.progress.textContent = "Tutorial Complete";
    elements.stepLabel.textContent = "Ready";
    elements.title.textContent = "You Know The Crunch";
    elements.instruction.textContent = "Match suits or numbers, build plus and minus combos, then risk more cards for a Full Crunch.";
    elements.detail.textContent = "Keep Crunching to grow MULTI. Bank your run cash before you lose all three lives.";
    elements.feedback.textContent = "Now fill a pot and chase a new high score.";
    elements.actions.hidden = true;
    elements.nextButton.hidden = true;
    elements.finishButton.hidden = false;
    elements.table.replaceChildren();
    elements.selectedTray.replaceChildren();
    elements.hand.replaceChildren();
    playGameSfx("target_clear");
  }

  function setCash(value) {
    elements.cash.textContent = `$${formatCompactNumber(value ?? 0)}`;
  }

  function setMultiplier(value) {
    elements.multiplier.textContent = `x${Number(value ?? 1).toFixed(1).replace(/\.0$/, "")}`;
  }

  function getHandCard(index) {
    return root.querySelector(`[data-tutorial-hand-index="${index}"]`);
  }

  function getHandSlot(index) {
    return elements.hand.querySelector(`[data-tutorial-hand-slot="${index}"]`);
  }

  async function returnSelectedCardsToHand() {
    const movements = selectedIndexes.map((index) => {
      const cardElement = getHandCard(index);
      return { index, cardElement, fromRect: cardElement?.getBoundingClientRect() };
    });
    selectedIndexes = [];
    movements.forEach(({ index, cardElement }) => getHandSlot(index)?.appendChild(cardElement));
    updateSelectionUI();
    movements.forEach(({ cardElement, fromRect }) => {
      if (cardElement && fromRect) animateCardTransfer(cardElement, fromRect, cardElement.getBoundingClientRect(), { withTrail: true });
    });
    await sleep(360);
  }

  return { reset };
}

function createTutorialCard(tutorialCard, tagName) {
  const element = document.createElement(tagName);
  element.className = `card card-${tutorialCard.color} card-${tutorialCard.suit} tutorial-card`;
  if (tagName === "button") {
    element.type = "button";
    element.setAttribute("aria-pressed", "false");
  }
  element.setAttribute("aria-label", `${tutorialCard.rank} of ${tutorialCard.label}`);
  element.innerHTML = `
    <span class="card-corner card-corner-top"><span>${tutorialCard.rank}</span><span>${tutorialCard.suitSymbol}</span></span>
    <span class="card-center">
      <span class="card-rank">${tutorialCard.rank}</span>
      <span class="card-pips" aria-hidden="true"><span class="hero-pip">${tutorialCard.suitSymbol}</span></span>
    </span>
    <span class="card-corner card-corner-bottom"><span>${tutorialCard.rank}</span><span>${tutorialCard.suitSymbol}</span></span>
    <span class="tutorial-card-order" aria-hidden="true" hidden></span>
  `;
  return element;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
