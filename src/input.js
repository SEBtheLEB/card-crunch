const recentPointers = new WeakMap();
let latestPointerInvocation = { at: -Infinity, x: -9999, y: -9999 };

export function bindInstantAction(element, action, { stopPropagation = false } = {}) {
  if (!element || typeof action !== "function") return () => {};
  let press = null;
  let suppressClickUntil = 0;

  const onPointerDown = (event) => {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    const target = event.target?.closest?.("button, a, [role=button], [role=tab]") ?? event.target;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, target, moved: false };
  };
  const onPointerMove = (event) => {
    if (press?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) press.moved = true;
  };
  const cancelPress = () => {
    if (press) suppressClickUntil = performance.now() + 650;
    press = null;
  };

  const invoke = (event) => {
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();
    action(event);
  };

  const onPointerUp = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const started = press;
    press = null;
    const target = event.target?.closest?.("button, a, [role=button], [role=tab]") ?? event.target;
    if (!started || started.id !== event.pointerId || started.moved || started.target !== target
      || Math.hypot(event.clientX - started.x, event.clientY - started.y) > 12) {
      suppressClickUntil = performance.now() + 650;
      return;
    }
    recentPointers.set(element, performance.now());
    latestPointerInvocation = {
      at: performance.now(),
      x: event.clientX ?? -9999,
      y: event.clientY ?? -9999
    };
    invoke(event);
  };

  const onClick = (event) => {
    // Keyboard and assistive activation have no pointer gesture to deduplicate.
    if (event.detail === 0) { invoke(event); return; }
    const pointerAt = recentPointers.get(element) ?? -Infinity;
    const nearLatestPointer =
      Math.abs((event.clientX ?? -9999) - latestPointerInvocation.x) < 28 &&
      Math.abs((event.clientY ?? -9999) - latestPointerInvocation.y) < 28;
    if (performance.now() < suppressClickUntil || performance.now() - pointerAt < 650 || (performance.now() - latestPointerInvocation.at < 650 && nearLatestPointer)) {
      event.preventDefault();
      if (stopPropagation) event.stopPropagation();
      return;
    }
    invoke(event);
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove, { passive: true });
  element.addEventListener("pointercancel", cancelPress);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("click", onClick);

  return () => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointercancel", cancelPress);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("click", onClick);
    recentPointers.delete(element);
  };
}
