import { TodoError } from "./errors.ts";

const PRIORITIES = ["high", "medium", "low"] as const;

type Priority = (typeof PRIORITIES)[number];

/** How Items are ordered inside each Section: by Position, or by Priority and then Position. */
const ITEM_SORTS = ["position", "priority"] as const;

type ItemSort = (typeof ITEM_SORTS)[number];

/** Where an Item moves within its Section. */
const ITEM_MOVES = ["up", "down", "top", "bottom"] as const;

type ItemMove = (typeof ITEM_MOVES)[number];

type Item = {
  /** The List Key of the List the Item belongs to. */
  list: string;
  /** The Item ID, unique within its List. */
  id: number;
  description: string;
  notes?: string;
  section?: string;
  priority?: Priority;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  doneAt?: string;
};

type List = {
  key: string;
  description?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

type ListSummary = List & {
  pending: number;
  done: number;
};

/** The fields of an Item that copying, moving and importing carry over. */
type ItemDraft = {
  description: string;
  notes?: string;
  section?: string;
  priority?: Priority;
  doneAt?: string;
};

const LIST_KEY = /^[A-Za-z][^\s/]*$/;

const parseListKey = (key: string): string => {
  if (!LIST_KEY.test(key)) {
    throw new TodoError(
      "INVALID_INPUT",
      `invalid list key '${key}': it must start with a letter and have no spaces or '/'`,
    );
  }
  return key;
};

const isPriority = (value: string): value is Priority =>
  (PRIORITIES as readonly string[]).includes(value);

const parsePriority = (value: string): Priority => {
  const lower = value.toLowerCase();
  if (!isPriority(lower)) {
    throw new TodoError(
      "INVALID_INPUT",
      `invalid priority '${value}': use one of ${PRIORITIES.join(", ")}`,
    );
  }
  return lower;
};

const parseDescription = (description: string): string => {
  const trimmed = description.trim();
  if (trimmed === "") throw new TodoError("INVALID_INPUT", "an item description cannot be empty");
  if (trimmed.includes("\n")) {
    throw new TodoError(
      "INVALID_INPUT",
      "an item description must be one line; use notes for more",
    );
  }
  return trimmed;
};

const oneOf =
  <T extends string>(values: readonly T[], what: string) =>
  (value: string): T => {
    const lower = value.toLowerCase();
    if (!(values as readonly string[]).includes(lower)) {
      throw new TodoError(
        "INVALID_INPUT",
        `invalid ${what} '${value}': use one of ${values.join(", ")}`,
      );
    }
    return lower as T;
  };

const parseItemSort: (value: string) => ItemSort = oneOf(ITEM_SORTS, "sort");

const parseItemMove: (value: string) => ItemMove = oneOf(ITEM_MOVES, "move");

/** An empty Section name means no Section. */
const parseSection = (section: string): string | undefined => {
  const trimmed = section.trim();
  if (trimmed.includes("\n")) throw new TodoError("INVALID_INPUT", "a section must be one line");
  return trimmed === "" ? undefined : trimmed;
};

export {
  type Item,
  type ItemDraft,
  ITEM_MOVES,
  ITEM_SORTS,
  type ItemMove,
  type ItemSort,
  type List,
  type ListSummary,
  PRIORITIES,
  type Priority,
  isPriority,
  parseDescription,
  parseItemMove,
  parseItemSort,
  parseListKey,
  parsePriority,
  parseSection,
};
