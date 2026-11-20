/** Whether `root` holds an element matching `selector`, kept up to date as its DOM changes. */
export function observeHas(
  root: HTMLElement,
  selector: string,
  onChange: (has: boolean) => void,
): () => void {
  let has = root.querySelector(selector) !== null;
  onChange(has);
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const observer = new MutationObserver(() => {
    const next = root.querySelector(selector) !== null;
    if (next !== has) {
      has = next;
      onChange(next);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}
