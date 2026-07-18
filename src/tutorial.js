import { playGameSfx } from "./audio.js?v=91";
import { formatCompactNumber } from "./format.js?v=91";
import { bindInstantAction } from "./input.js?v=91";

const SUITS = {
  hearts: { symbol: "&hearts;", color: "red", label: "Hearts" },
  diamonds: { symbol: "&diams;", color: "red", label: "Diamonds" },
  spades: { symbol: "&spades;", color: "black", label: "Spades" },
  clubs: { symbol: "&clubs;", color: "black", label: "Clubs" }
};

function card(rank, value, suit) {
  return { rank, value, suit, ...SUITS[suit] };
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
    cashBefore: 0,
    cashAfter: 100,
    multiplierBefore: 1,
    multiplierAfter: 1.2,
    success: "SUIT MATCH  +100",
    sound: "suit_match"
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
    cashBefore: 100,
    cashAfter: 460,
    multiplierBefore: 1.2,
    multiplierAfter: 1.4,
    success: "NUMBER MATCH  +300",
    sound: "rank_match"
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
    cashBefore: 460,
    cashAfter: 1160,
    multiplierBefore: 1.4,
    multiplierAfter: 1.6,
    success: "3 + 5 = 8  PLUS CRUNCH  +500",
    sound: "math_combo"
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
    cashBefore: 1160,
    cashAfter: 1960,
    multiplierBefore: 1.6,
    multiplierAfter: 1.8,
    success: "10 - 7 = 3  MINUS CRUNCH  +500",
    sound: "math_combo"
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
    cashBefore: 1960,
    cashAfter: 25600,
    multiplierBefore: 1.8,
    multiplierAfter: 2.4,
    success: "FULL CRUNCH!  ALL 4 CARDS  HAND x8",
    sound: "score_arrive"
  },
  {
    type: "bank",
    label: "Stay Safe",
    title: "Bank Your Cash",
    instruction: "Your $25.6K is unbanked and can be lost. Tap BANK to save it in your pot.",
    detail: "Successful Crunches grow MULTI. Banking saves your cash, but resets MULTI to x1.",
    table: [card("A", 1, "hearts"), card("K", 13, "spades")],
    hand: [card("6", 6, "clubs"), card("10", 10, "diamonds"), card("4", 4, "hearts"), card("Q", 12, "spades")],
    cashBefore: 25600,
    multiplierBefore: 2.4
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

  bindInstantAction(elements.crunchButton, resolveCrunch);
  bindInstantAction(elements.bankButton, bankPracticeCash);
  bindInstantAction(elements.nextButton, showNextLesson);

  window.addEventListener("card-crunch-menu-page-change", (event) => {
    if (event.detail?.pageName === "tutorial") reset();
  });

  function reset() {
    lessonIndex = 0;
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
    root.classList.remove("is-tutorial-complete", "is-tutorial-success", "is-tutorial-wrong");
    elements.practice.classList.remove("is-bank-lesson");
    elements.progress.textContent = `Lesson ${lessonIndex + 1} of ${LESSONS.length}`;
    elements.stepLabel.textContent = lesson.label;
    elements.title.textContent = lesson.title;
    elements.instruction.textContent = lesson.instruction;
    elements.detail.textContent = lesson.detail;
    elements.feedback.textContent = lesson.type === "bank" ? "Banking is a choice. Bank before the run turns against you." : "Select the card shown above.";
    elements.actions.hidden = false;
    elements.nextButton.hidden = true;
    elements.finishButton.hidden = true;

    setCash(lesson.cashBefore);
    setMultiplier(lesson.multiplierBefore);
    renderCards(elements.table, lesson.table, { table: true });
    renderCards(elements.hand, lesson.hand, { interactive: lesson.type !== "bank" });

    if (lesson.type === "bank") {
      elements.practice.classList.add("is-bank-lesson");
      elements.bankButton.disabled = false;
      elements.bankAmount.textContent = `$${formatCompactNumber(lesson.cashBefore)}`;
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
      if (table) cardElement.dataset.tutorialTableIndex = String(index);
      if (interactive) {
        cardElement.dataset.tutorialHandIndex = String(index);
        bindInstantAction(cardElement, () => toggleCard(index));
      }
      zone.appendChild(cardElement);
    });
  }

  function toggleCard(index) {
    if (resolved || LESSONS[lessonIndex]?.type === "bank") return;
    const selectedAt = selectedIndexes.indexOf(index);
    if (selectedAt >= 0) {
      selectedIndexes.splice(selectedAt, 1);
      playGameSfx("card_deselect");
    } else {
      selectedIndexes.push(index);
      playGameSfx("card_select");
    }
    root.classList.remove("is-tutorial-wrong");
    elements.feedback.textContent = selectedIndexes.length ? "Ready when you are. Press CRUNCH." : "Select the card shown above.";
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const lesson = LESSONS[lessonIndex];
    elements.hand.querySelectorAll("[data-tutorial-hand-index]").forEach((cardElement) => {
      const index = Number(cardElement.dataset.tutorialHandIndex);
      const order = selectedIndexes.indexOf(index);
      const orderLabel = cardElement.querySelector(".tutorial-card-order");
      cardElement.classList.toggle("is-tutorial-selected", order >= 0);
      cardElement.classList.toggle("is-tutorial-guided", !resolved && lesson.expected?.[selectedIndexes.length] === index);
      cardElement.setAttribute("aria-pressed", String(order >= 0));
      orderLabel.hidden = order < 0;
      orderLabel.textContent = order >= 0 ? String(order + 1) : "";
    });
    elements.crunchButton.disabled = selectedIndexes.length === 0;
    elements.crunchButton.textContent = selectedIndexes.length ? `CRUNCH ${selectedIndexes.length}` : "SELECT A CARD";
  }

  function resolveCrunch() {
    const lesson = LESSONS[lessonIndex];
    if (!lesson || lesson.type === "bank" || resolved || selectedIndexes.length === 0) return;
    playGameSfx("crunch_start");

    const correct = selectedIndexes.length === lesson.expected.length
      && selectedIndexes.every((index, position) => index === lesson.expected[position]);
    if (!correct) {
      root.classList.remove("is-tutorial-wrong");
      void root.offsetWidth;
      root.classList.add("is-tutorial-wrong");
      elements.feedback.textContent = lesson.expected.length > 1
        ? "Not quite. Select all four in the order shown, then try again."
        : "Not quite. Deselect that card and follow the card named above.";
      playGameSfx("no_match");
      return;
    }

    resolved = true;
    root.classList.add("is-tutorial-success");
    lesson.matchedTable.forEach((index) => {
      elements.table.querySelector(`[data-tutorial-table-index="${index}"]`)?.classList.add("is-tutorial-match");
    });
    selectedIndexes.forEach((index) => {
      elements.hand.querySelector(`[data-tutorial-hand-index="${index}"]`)?.classList.add("is-tutorial-resolved");
    });
    elements.feedback.textContent = lesson.success;
    setCash(lesson.cashAfter);
    setMultiplier(lesson.multiplierAfter);
    elements.crunchButton.disabled = true;
    elements.bankButton.disabled = true;
    elements.nextButton.textContent = lessonIndex === LESSONS.length - 2 ? "Learn To Bank" : "Next Lesson";
    elements.nextButton.hidden = false;
    playGameSfx(lesson.sound);
  }

  function bankPracticeCash() {
    const lesson = LESSONS[lessonIndex];
    if (!lesson || lesson.type !== "bank" || resolved) return;
    resolved = true;
    root.classList.add("is-tutorial-success");
    setCash(0);
    setMultiplier(1);
    elements.bankAmount.textContent = "$0";
    elements.bankButton.disabled = true;
    elements.feedback.textContent = "$25.6K BANKED!  Your multiplier reset to x1.";
    elements.nextButton.textContent = "Finish Tutorial";
    elements.nextButton.hidden = false;
    playGameSfx("bank");
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
    elements.hand.replaceChildren();
    playGameSfx("target_clear");
  }

  function setCash(value) {
    elements.cash.textContent = `$${formatCompactNumber(value ?? 0)}`;
  }

  function setMultiplier(value) {
    elements.multiplier.textContent = `x${Number(value ?? 1).toFixed(1).replace(/\.0$/, "")}`;
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
    <span class="card-corner card-corner-top"><span>${tutorialCard.rank}</span><span>${tutorialCard.symbol}</span></span>
    <span class="card-center">
      <span class="card-rank">${tutorialCard.rank}</span>
      <span class="card-pips" aria-hidden="true"><span class="hero-pip">${tutorialCard.symbol}</span></span>
    </span>
    <span class="card-corner card-corner-bottom"><span>${tutorialCard.rank}</span><span>${tutorialCard.symbol}</span></span>
    <span class="tutorial-card-order" aria-hidden="true" hidden></span>
  `;
  return element;
}
