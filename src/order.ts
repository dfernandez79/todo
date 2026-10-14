import { priorityRank } from "./merge.ts";
import type { Item, ItemSort } from "./types.ts";

const collator = new Intl.Collator("en");

/** No Section first, then Sections alphabetically. */
const compareSections = (a: string | undefined, b: string | undefined): number => {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return collator.compare(a, b);
};

const bySection = (a: Item, b: Item): number => compareSections(a.section, b.section);

const byPriority = (a: Item, b: Item): number =>
  bySection(a, b) || priorityRank(b.priority) - priorityRank(a.priority);

/**
 * Display order, from Items given by Position: by Section, then by Position,
 * or by Priority (High first, none last) and then Position. The sort is
 * stable, so Position breaks every tie.
 */
const sortItems = (items: readonly Item[], sort: ItemSort = "position"): Item[] =>
  items.toSorted(sort === "priority" ? byPriority : bySection);

type SectionGroup = { section: string | undefined; items: Item[] };

/** Groups Items by Section, keeping their order inside each one. */
const groupBySection = (items: readonly Item[]): SectionGroup[] =>
  items.toSorted(bySection).reduce<SectionGroup[]>((groups, item) => {
    const last = groups.at(-1);
    if (last !== undefined && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
    return groups;
  }, []);

export { groupBySection, type SectionGroup, sortItems };
