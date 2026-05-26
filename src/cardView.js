export function createCard(card, options = {}) {
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
