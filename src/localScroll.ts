/** WebKit does not consistently scroll a focused generic region with arrow keys. */
export function makeHorizontalScrollRegion(element: HTMLElement, label: string) {
  element.tabIndex = 0;
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", label);
  element.addEventListener("keydown", event => {
    if (event.target !== element || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    if (element.scrollWidth <= element.clientWidth) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    element.scrollLeft += event.key === "ArrowRight" ? 40 : -40;
    event.preventDefault();
  });
}
