// Which demo business the chooser shows (components/voice/landing/demo-chooser.tsx). Pure, so the
// rule can be tested without a browser.
//
//   - a choice the visitor made holds while the hash is still the one it left behind, and also
//     when the hash names no business (the nav's #contact, the FAQ's #faq);
//   - a hash that names another business wins (a trade link of the sectors section, back/forward);
//   - otherwise the default.

export interface PickedDemo {
  id: string;
  /** The hash right after the choice (without "#"). */
  hash: string;
}

export function selectDemoId(ids: readonly string[], hash: string, picked: PickedDemo | null, defaultId: string): string {
  const fromHash = ids.includes(hash) ? hash : null;
  const chosen = picked !== null && ids.includes(picked.id) ? picked : null;
  if (chosen !== null && (chosen.hash === hash || fromHash === null)) return chosen.id;
  if (fromHash !== null) return fromHash;
  return ids.includes(defaultId) ? defaultId : (ids[0] ?? defaultId);
}
