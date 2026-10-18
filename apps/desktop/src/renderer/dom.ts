/** Required elements belong to the bundled templates, never to model output. */
export function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error("TEMPLATE_ELEMENT_MISSING");
  return found;
}
