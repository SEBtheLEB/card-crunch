const recentPointers = new WeakMap();
let latestPointerInvocation = { at: -Infinity, x: -9999, y: -9999 };

export function bindInstantAction(element, action, { stopPropagation = false } = {}) {
  if (!element || typeof action !== "function") return () => {};

  const invoke = (event) => {
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();
    action(event);
  };

  const onPointerUp = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    recentPointers.set(element, performance.now());
    latestPointerInvocation = {
      at: performance.now(),
      x: event.clientX ?? -9999,
      y: event.clientY ?? -9999
    };
    invoke(event);
  };

  const onClick = (event) => {
    const pointerAt = recentPointers.get(element) ?? -Infinity;
    const nearLatestPointer =
      Math.abs((event.clientX ?? -9999) - latestPointerInvocation.x) < 28 &&
      Math.abs((event.clientY ?? -9999) - latestPointerInvocation.y) < 28;
    if (performance.now() - pointerAt < 650 || (performance.now() - latestPointerInvocation.at < 650 && nearLatestPointer)) {
      event.preventDefault();
      if (stopPropagation) event.stopPropagation();
      return;
    }
    invoke(event);
  };

  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("click", onClick);

  return () => {
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("click", onClick);
    recentPointers.delete(element);
  };
}
