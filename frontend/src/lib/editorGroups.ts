import type { EditorGroup, EditorTab } from '../types';

/** Pure helpers over the editor group/tab model. Kept out of the store so they can
 *  be unit-tested in isolation and reused without pulling in the whole store. */

export const newGroup = (seq: number, tabs: EditorTab[] = [], activeTabId: string | null = null): EditorGroup => ({
  id: `group-${seq}`,
  tabs,
  activeTabId,
  size: 1,
});

export const mapGroup = (groups: EditorGroup[], id: string, fn: (g: EditorGroup) => EditorGroup): EditorGroup[] =>
  groups.map((g) => (g.id === id ? fn(g) : g));

/** Close one tab in a group; if it was active, promote the neighbour at its slot. */
export function closeOne(g: EditorGroup, tabId: string): EditorGroup {
  const idx = g.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return g;
  const tabs = g.tabs.filter((t) => t.id !== tabId);
  let activeTabId = g.activeTabId;
  if (g.activeTabId === tabId) activeTabId = (tabs[idx] ?? tabs[idx - 1] ?? null)?.id ?? null;
  return { ...g, tabs, activeTabId };
}

/** Remove every tab in `kill` from a group; if the active tab went with them, promote
 *  the survivor nearest its old slot (used by Close Others / to the Right / All). */
export function closeManyIn(g: EditorGroup, kill: ReadonlySet<string>): EditorGroup {
  const activeIdx = g.tabs.findIndex((t) => t.id === g.activeTabId);
  const tabs = g.tabs.filter((t) => !kill.has(t.id));
  if (tabs.length === g.tabs.length) return g; // nothing removed
  let activeTabId = g.activeTabId;
  if (activeTabId != null && kill.has(activeTabId)) {
    activeTabId = tabs[Math.min(activeIdx, tabs.length - 1)]?.id ?? null;
  }
  return { ...g, tabs, activeTabId };
}

/** After removing tabs, drop any now-empty group (keeping at least one, empty) and
 *  repoint activeGroupId if it landed on a group that was collapsed away. */
export function collapseEmptyGroups(
  groups: EditorGroup[],
  activeGroupId: string
): { groups: EditorGroup[]; activeGroupId: string } {
  if (groups.length > 1) {
    const kept = groups.filter((g) => g.tabs.length > 0);
    if (kept.length === 0) groups = [{ ...groups[0], tabs: [], activeTabId: null }];
    else if (kept.length < groups.length) groups = kept;
    if (!groups.some((g) => g.id === activeGroupId)) activeGroupId = groups[groups.length - 1].id;
  }
  return { groups, activeGroupId };
}
