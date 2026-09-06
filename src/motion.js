// One motion preference for CSS, Web Animations, canvas effects, and navigation.
export function prefersReducedMotion() {
  return globalThis.document?.documentElement.classList.contains("reduce-motion")
    || Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function animateEntrance(element, { direction = 0, duration = 220 } = {}) {
  if (!element?.animate || prefersReducedMotion()) return null;
  return element.animate([
    { opacity: 0, transform: `translate(${direction * 14}px, ${direction ? 0 : 8}px)` },
    { opacity: 1, transform: "translate(0, 0)" }
  ], { duration, easing: "cubic-bezier(.22,.8,.25,1)" });
}
