// Which demo business the chooser shows (components/voice/landing/demo-chooser.tsx). Pure, so the
// rule can be tested without a browser.
//
//   - a business the visitor chose holds while the hash is still the one the choice left behind,
//     and also when the hash names no business (the nav's #contact, the hero's #pilot, the FAQ's
//     #faq, the stage's own contact link);
//   - a choice is a radio of the chooser, or a hash that names a business: a trade link of the
//     sectors section, a shared #demo-… link, back/forward (rememberHashChoice; review finding N4:
//     a hotel example started from the sectors list must not give way to the plumber when the
//     visitor then follows #contact);
//   - a hash that names another business wins over an earlier choice;
//   - otherwise the default.

export interface PickedDemo {
  id: string;
  /** The hash right after the choice (without "#"). */
  hash: string;
}

/**
 * The choice to remember once the hash has changed from `previousHash` to `hash`: a hash that
 * names a business is a choice of its own, any other hash leaves the choice as it was. Called on
 * a change only: a radio whose hash could not be written (a throttled replaceState) keeps its
 * choice over the business named by the old, unchanged hash.
 */
export function rememberHashChoice(
  ids: readonly string[],
  previousHash: string,
  hash: string,
  picked: PickedDemo | null,
): PickedDemo | null {
  if (hash === previousHash || !ids.includes(hash)) return picked;
  if (picked !== null && picked.id === hash && picked.hash === hash) return picked;
  return { id: hash, hash };
}

export function selectDemoId(ids: readonly string[], hash: string, picked: PickedDemo | null, defaultId: string): string {
  const fromHash = ids.includes(hash) ? hash : null;
  const chosen = picked !== null && ids.includes(picked.id) ? picked : null;
  if (chosen !== null && (chosen.hash === hash || fromHash === null)) return chosen.id;
  if (fromHash !== null) return fromHash;
  return ids.includes(defaultId) ? defaultId : (ids[0] ?? defaultId);
}
