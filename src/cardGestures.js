import { DEAL_TIMING, getDealStartDelay } from "./dealTiming.js?v=162";
import { playGameSfx } from "./audio.js?v=162";

const TAP_SLOP = 12;
const FLICK_DISTANCE = 42;
const FAST_FLICK_DISTANCE = 24;
const FLICK_VELOCITY = 0.36;
const CLICK_GUARD_MS = 700;

const recentPointerActions = new WeakMap();
const flightAnimations = new WeakMap();

export function bindCardGesture(element, action) {
  if (!element || typeof action !== "function") return () => {};

  let gesture = null;
  let dragFrame = null;

  const clearDragFrame = () => {
    if (dragFrame) cancelAnimationFrame(dragFrame);
    dragFrame = null;
  };

  const clearDragVisual = ({ spring = false } = {}) => {
    clearDragFrame();
    element.classList.remove("is-card-dragging");
    if (spring) element.classList.add("card-gesture-return");
    element.style.setProperty("--gesture-x", "0px");
    element.style.setProperty("--gesture-y", "0px");
    if (spring) {
      window.setTimeout(() => element.classList.remove("card-gesture-return"), 220);
    }
  };

  const invoke = (event, mode) => {
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return;
    recentPointerActions.set(element, performance.now());
    action(event, { mode });
  };

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return;

    const staged = element.classList.contains("is-staged-card");
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      startedAt: performance.now(),
      staged
    };
    element.setPointerCapture?.(event.pointerId);
    element.classList.add("is-card-dragging");
  };

  const onPointerMove = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (dragFrame) return;

    dragFrame = requestAnimationFrame(() => {
      dragFrame = null;
      if (!gesture) return;
      const rawX = gesture.x - gesture.startX;
      const rawY = gesture.y - gesture.startY;
      const directedY = gesture.staged ? Math.max(-10, rawY) : Math.min(10, rawY);
      element.style.setProperty("--gesture-x", `${rawX * 0.42}px`);
      element.style.setProperty("--gesture-y", `${directedY}px`);
    });
    event.preventDefault();
  };

  const finishPointer = (event, cancelled = false) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    const current = gesture;
    gesture = null;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const elapsed = Math.max(16, performance.now() - current.startedAt);
    const directedDistance = current.staged ? dy : -dy;
    const directedVelocity = directedDistance / elapsed;
    const mostlyVertical = Math.abs(dy) >= Math.abs(dx) * 0.72;
    const isFlick = !cancelled && mostlyVertical && (
      directedDistance >= FLICK_DISTANCE ||
      (directedDistance >= FAST_FLICK_DISTANCE && directedVelocity >= FLICK_VELOCITY)
    );
    const isTap = !cancelled && Math.hypot(dx, dy) <= TAP_SLOP;

    element.releasePointerCapture?.(event.pointerId);
    recentPointerActions.set(element, performance.now());
    if (isFlick || isTap) {
      event.preventDefault();
      clearDragVisual();
      invoke(event, isFlick ? (current.staged ? "flick-down" : "flick-up") : "tap");
      return;
    }

    clearDragVisual({ spring: true });
  };

  const onPointerUp = (event) => finishPointer(event, false);
  const onPointerCancel = (event) => finishPointer(event, true);
  const onClick = (event) => {
    const pointerAt = recentPointerActions.get(element) ?? -Infinity;
    if (performance.now() - pointerAt < CLICK_GUARD_MS) {
      event.preventDefault();
      return;
    }
    invoke(event, "keyboard");
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove, { passive: false });
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerCancel);
  element.addEventListener("click", onClick);

  return () => {
    clearDragVisual();
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerCancel);
    element.removeEventListener("click", onClick);
    recentPointerActions.delete(element);
  };
}

export function animateCardTransfer(card, fromRect, toRect, {
  withTrail = false,
  motion = "standard",
  duration: requestedDuration = null
} = {}) {
  if (!card || !fromRect || !toRect) return null;
  const dx = fromRect.left - toRect.left;
  const dy = fromRect.top - toRect.top;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) return null;

  const reducedMotion = document.documentElement.classList.contains("reduce-motion");
  const duration = reducedMotion
    ? 80
    : requestedDuration ?? Math.min(390, Math.max(260, distance * 0.82));
  if (withTrail && !reducedMotion) {
    spawnCardFlightTrail(card, fromRect, toRect, {
      duration: motion === "deal" ? Math.round(duration * .86) : 360,
      arcHeight: motion === "deal" ? 22 : 12
    });
  }

  const startScaleX = fromRect.width / Math.max(1, toRect.width);
  const startScaleY = fromRect.height / Math.max(1, toRect.height);
  const frames = motion === "deal"
    ? [
        { translate: `${dx}px ${dy}px`, scale: `${startScaleX} ${startScaleY}`, offset: 0 },
        { translate: `${dx * .68}px ${dy * .7 - 22}px`, scale: `${.98 + (startScaleX - 1) * .5} ${.98 + (startScaleY - 1) * .5}`, offset: .34 },
        { translate: `${dx * .2}px ${dy * .14 - 9}px`, scale: "1.018", offset: .8 },
        { translate: "0px 0px", scale: "1", offset: 1 }
      ]
    : motion === "hand-shift"
      ? [
          { translate: `${dx}px ${dy}px`, scale: "1", offset: 0 },
          { translate: `${dx * .24}px -4px`, scale: "1.008", offset: .74 },
          { translate: "0px 0px", scale: "1", offset: 1 }
        ]
      : [
          { translate: `${dx}px ${dy}px`, scale: `${startScaleX} ${startScaleY}`, offset: 0 },
          { translate: `${dx * .44}px ${dy * .36 - 12}px`, scale: `${1 + (startScaleX - 1) * .28} ${1 + (startScaleY - 1) * .28}`, offset: .62 },
          { translate: "0px 0px", scale: "1", offset: 1 }
        ];
  flightAnimations.get(card)?.cancel();
  card.classList.add("card-in-flight");
  const animation = card.animate(frames, {
    duration,
    easing: motion === "deal"
      ? "cubic-bezier(.18, .72, .2, 1)"
      : motion === "hand-shift"
        ? "cubic-bezier(.2, .78, .22, 1)"
        : "cubic-bezier(.18, .86, .24, 1.12)",
    fill: "both"
  });
  flightAnimations.set(card, animation);
  animation.finished.catch(() => {}).finally(() => {
    if (flightAnimations.get(card) !== animation) return;
    flightAnimations.delete(card);
    card.classList.remove("card-in-flight");
  });
  return animation;
}

/* Cards normally enter from the dealer on the left. Endless Arcade uses the
   right edge for instant replacement deals so the stream reads clearly. */
export function animateCardDealIn(card, dealOrder = 0, { zone = "hand", fromSide = "left" } = {}) {
  if (!card) return;
  const reducedMotion = document.documentElement.classList.contains("reduce-motion");
  const normalizedOrder = Math.max(0, dealOrder);
  const delay = getDealStartDelay(normalizedOrder, reducedMotion);

  const launch = () => {
    if (!card.isConnected) return;
    playGameSfx("card_deal");
    const toRect = card.getBoundingClientRect();
    const laneOffset = normalizedOrder * 18;
    const fromRect = {
      left: fromSide === "right"
        ? window.innerWidth + 30 + laneOffset
        : -toRect.width - 30 - laneOffset,
      top: zone === "table"
        ? toRect.top - Math.min(54, toRect.height * .28) + laneOffset * .12
        : toRect.top + Math.min(46, toRect.height * .24) + laneOffset * .22,
      width: toRect.width * .9,
      height: toRect.height * .9
    };
    const animation = animateCardTransfer(card, fromRect, toRect, {
      withTrail: true,
      motion: "deal",
      duration: reducedMotion ? DEAL_TIMING.reducedFlightMs : DEAL_TIMING.flightMs
    });
    card.classList.remove("card-deal-pending");

    if (!animation) return;
    animation.finished.catch(() => {}).finally(() => {
      if (!card.isConnected) return;
      const landingMs = reducedMotion ? DEAL_TIMING.reducedLandingMs : DEAL_TIMING.landingMs;
      const settleBufferMs = reducedMotion ? DEAL_TIMING.reducedSettleBufferMs : DEAL_TIMING.settleBufferMs;
      card.style.setProperty("--deal-landing-ms", `${landingMs}ms`);
      card.classList.add("card-deal-landed");

      let fallbackTimer = 0;
      const clearLanding = () => {
        window.clearTimeout(fallbackTimer);
        card.removeEventListener("animationend", onLandingEnd);
        card.classList.remove("card-deal-landed");
        card.style.removeProperty("--deal-landing-ms");
      };
      const onLandingEnd = (event) => {
        if (event.target !== card || event.animationName !== "cardDealLand") return;
        clearLanding();
      };
      card.addEventListener("animationend", onLandingEnd);
      fallbackTimer = window.setTimeout(clearLanding, landingMs + settleBufferMs);
    });
  };

  window.setTimeout(() => requestAnimationFrame(launch), delay);
}

function spawnCardFlightTrail(card, fromRect, toRect, { duration = 360, arcHeight = 12 } = {}) {
  const fragment = document.createDocumentFragment();
  const toneClass = [...card.classList].find((name) => name === "card-red" || name === "card-black" || name === "card-clubs") ?? "card-black";
  const pinkArcade = card.classList.contains("card-skin-pink_arcade") || card.dataset.equippedSkin === "pink_arcade";
  const echoes = pinkArcade ? 6 : 4;

  for (let index = 0; index < echoes; index += 1) {
    const progress = (index + 1) / (echoes + 1);
    const echo = document.createElement("i");
    echo.className = `card-flight-trail ${toneClass}${pinkArcade ? " is-pink-arcade" : ""}`;
    echo.style.left = `${fromRect.left + (toRect.left - fromRect.left) * progress}px`;
    echo.style.top = `${fromRect.top + (toRect.top - fromRect.top) * progress - Math.sin(progress * Math.PI) * arcHeight}px`;
    echo.style.width = `${fromRect.width + (toRect.width - fromRect.width) * progress}px`;
    echo.style.height = `${fromRect.height + (toRect.height - fromRect.height) * progress}px`;
    echo.style.setProperty("--flight-delay", `${index * (pinkArcade ? 12 : 18)}ms`);
    echo.style.setProperty("--flight-duration", `${duration}ms`);
    echo.style.setProperty("--flight-scale", `${.86 + progress * .18}`);
    if (pinkArcade) echo.style.setProperty("--flight-pink-hue", `${index * 26}deg`);
    echo.addEventListener("animationend", () => echo.remove(), { once: true });
    fragment.appendChild(echo);
  }

  document.body.appendChild(fragment);
}
