import { priorityRank } from "./merge.ts";
import type { Item } from "./types.ts";

const collator = new Intl.Collator("en");

/** No Section first, then Sections alphabetically. */
const compareSections = (a: string | undefined, b: string | undefined): number => {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return collator.compare(a, b);
};

/** Display order: by Section, then Priority (High first, none last), then Item ID. */
const compareItems = (a: Item, b: Item): number =>
  compareSections(a.section, b.section) ||
  priorityRank(b.priority) - priorityRank(a.priority) ||
  a.id - b.id;

const sortItems = (items: readonly Item[]): Item[] => items.toSorted(compareItems);

type SectionGroup = { section: string | undefined; items: Item[] };

/** Groups Items sorted in display order, keeping that order. */
const groupBySection = (items: readonly Item[]): SectionGroup[] =>
  sortItems(items).reduce<SectionGroup[]>((groups, item) => {
    const last = groups.at(-1);
    if (last !== undefined && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
    return groups;
  }, []);

export { groupBySection, type SectionGroup, sortItems };
