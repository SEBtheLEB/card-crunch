export function preventMobileBrowserGestures() {
  document.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener("gesturestart", (event) => {
    event.preventDefault();
  });
}
