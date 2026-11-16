/** Read page text and editable selections, including controls inside open shadow roots. */
export function readPageSelection(root: Document | ShadowRoot): { text: string; rect: DOMRect | null } {
  const doc = root instanceof Document ? root : root.ownerDocument;
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
    typeof active.selectionStart === "number" && typeof active.selectionEnd === "number" &&
    active.selectionStart !== active.selectionEnd) {
    return { text: active.value.substring(active.selectionStart, active.selectionEnd), rect: active.getBoundingClientRect() };
  }
  // Chromium exposes a shadow-root selection; Firefox uses the document's selection.
  const selection = root instanceof ShadowRoot && "getSelection" in root
    ? (root as ShadowRoot & { getSelection(): Selection | null }).getSelection()
    : doc.defaultView?.getSelection();
  return selection && !selection.isCollapsed
    ? { text: selection.toString(), rect: selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null }
    : { text: "", rect: null };
}
