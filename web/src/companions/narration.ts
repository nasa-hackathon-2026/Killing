// When a companion speaks up by itself ("continuous introduction"). Pure:
// given what changed between two renders, which companion's bubble opens.
//
// Rules: nothing while the timeline plays; a newly switched-on layer brings
// its own companion; a new place or a pause brings the companion already
// selected, else the highest one shown. Nothing new is said here: the bubble
// shows the same template sentences as a click (companionLine.ts).
export type NarrationState = {
  visibleIds: string[];
  locationId: string;
  playing: boolean;
};

export function nextNarration(
  before: NarrationState,
  after: NarrationState,
  selectedId: string | null,
  // Companions shown now, highest first.
  shownIds: string[],
): string | null {
  if (after.playing) return null;
  const added = after.visibleIds.filter(
    (id) => !before.visibleIds.includes(id),
  );
  const newest = added.at(-1);
  if (newest && shownIds.includes(newest)) return newest;
  const placeChanged = before.locationId !== after.locationId;
  const paused = before.playing && !after.playing;
  if (!placeChanged && !paused) return null;
  if (selectedId && shownIds.includes(selectedId)) return selectedId;
  return shownIds[0] ?? null;
}

// What a click on a companion does to the open bubble. Pure, and with no
// "narration on/off" input on purpose: that switch only decides whether a
// companion speaks up by itself (nextNarration above), never whether a click
// opens the bubble. Clicking the one that is open (same view of it) closes it.
export type Selection = { id: string | null; caveat: boolean };

export function clickSelection(
  current: Selection,
  clickedId: string,
  withCaveat: boolean,
): Selection {
  const closing = current.id === clickedId && current.caveat === withCaveat;
  return closing
    ? { id: null, caveat: withCaveat }
    : { id: clickedId, caveat: withCaveat };
}
