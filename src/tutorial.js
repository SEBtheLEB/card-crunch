import { formatCompactNumber } from "./format.js?v=161";
import { bindInstantAction } from "./input.js?v=161";

const SUITS = {
  hearts: { suitSymbol: "&hearts;", color: "red", label: "Hearts" },
  diamonds: { suitSymbol: "&diams;", color: "red", label: "Diamonds" },
  spades: { suitSymbol: "&spades;", color: "black", label: "Spades" },
  clubs: { suitSymbol: "&clubs;", color: "black", label: "Clubs" }
};

let tutorialCardId = 0;

function card(rank, value, suit) {
  tutorialCardId += 1;
  return {
    id: `tutorial-${tutorialCardId}-${rank}-${suit}`,
    rank,
    value,
    suit,
    ...SUITS[suit]
  };
}

const TUTORIAL_LESSONS = [
  {
    label: "Match 1",
    title: "Suit Match",
    instruction: "Tap 9 Hearts to match the table Heart. Then CRUNCH.",
    detail: "Same suit = SUIT MATCH.",
    table: [card("5", 5, "hearts"), card("K", 13, "clubs")],
    hand: [card("9", 9, "hearts"), card("2", 2, "spades"), card("Q", 12, "diamonds"), card("4", 4, "spades")],
    expected: [0],
    guideStackByStep: [[0]]
  },
  {
    label: "Match 2",
    title: "Number Match",
    instruction: "Tap 7 Hearts to match the table 7. Then CRUNCH.",
    detail: "Same number = NUMBER MATCH.",
    table: [card("7", 7, "spades"), card("10", 10, "diamonds")],
    hand: [card("7", 7, "hearts"), card("2", 2, "clubs"), card("Q", 12, "hearts"), card("5", 5, "clubs")],
    expected: [0],
    guideStackByStep: [[0]]
  },
  {
    label: "Combo 1",
    title: "Plus Crunch",
    instruction: "Tap 8 Hearts: 3 + 5 = 8. Then CRUNCH.",
    detail: "PLUS uses both table cards.",
    table: [card("3", 3, "diamonds"), card("5", 5, "spades")],
    hand: [card("8", 8, "hearts"), card("Q", 12, "clubs"), card("J", 11, "hearts"), card("6", 6, "clubs")],
    expected: [0],
    guideStackByStep: [[0, 1]]
  },
  {
    label: "Combo 2",
    title: "Minus Crunch",
    instruction: "Tap 3 Hearts: 10 - 7 = 3. Then CRUNCH.",
    detail: "Subtract smaller from larger.",
    table: [card("10", 10, "diamonds"), card("7", 7, "spades")],
    hand: [card("3", 3, "hearts"), card("Q", 12, "clubs"), card("A", 1, "hearts"), card("6", 6, "clubs")],
    expected: [0],
    guideStackByStep: [[0, 1]]
  },
  {
    label: "Big Play",
    title: "Full Crunch",
    instruction: "Stage 8 Hearts, K Spades, 2 Clubs, 9 Diamonds. Then CRUNCH.",
    detail: "Each card can unlock the next.",
    table: [card("3", 3, "diamonds"), card("5", 5, "spades")],
    hand: [card("8", 8, "hearts"), card("K", 13, "spades"), card("2", 2, "clubs"), card("9", 9, "diamonds")],
    expected: [0, 1, 2, 3],
    guideStackByStep: [[0, 1], [1], [0, 1], [0]]
  },
  {
    type: "bank",
    label: "Stay Safe",
    title: "Bank Your Cash",
    instruction: "Tap BANK to protect your practice cash.",
    detail: "Banking resets MULTI to x1.",
    table: [card("A", 1, "hearts"), card("K", 13, "spades")],
    hand: [card("6", 6, "clubs"), card("10", 10, "diamonds"), card("4", 4, "hearts"), card("Q", 12, "spades")],
    expected: []
  }
];

export function initializeTutorial({ game }) {
  const startButton = document.querySelector("#tutorialStartButton");
  const coach = document.querySelector("#tutorialCoach");
  const progress = document.querySelector("#tutorialProgress");
  const title = document.querySelector("#tutorialStepTitle");
  const instruction = document.querySelector("#tutorialInstruction");
  const detail = document.querySelector("#tutorialDetail");

  if (!startButton || !coach) return;

  bindInstantAction(startButton, () => {
    game.startTutorial(TUTORIAL_LESSONS, {
      onLesson({ lesson, index, total, score }) {
        coach.hidden = false;
        coach.classList.remove("is-complete");
        progress.textContent = `Lesson ${index + 1} of ${total}`;
        title.textContent = lesson.title;
        instruction.textContent = lesson.type === "bank"
          ? `You have $${formatCompactNumber(score)} unbanked. Tap BANK to save it.`
          : lesson.instruction;
        detail.textContent = lesson.detail;
      },
      onComplete() {
        coach.hidden = false;
        coach.classList.add("is-complete");
        progress.textContent = "Tutorial Complete";
        title.textContent = "Ready To Crunch";
        instruction.textContent = "You matched suits and numbers, built math combos, and banked your run cash.";
        detail.textContent = "Returning to the main menu...";
      },
      onExit() {
        coach.hidden = true;
        coach.classList.remove("is-complete");
      }
    });
  });
}
