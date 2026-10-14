# Todo Lists

Concepts for tracking pending work in a project. An agent or a person keeps
lists of things to do and marks them done as work progresses.

## Concepts

**List**: A named collection of Items, identified by a List Key. _Avoid_:
Project, board, todo list

**List Key**: The short identifier of a List, such as `list-1`. It starts with a
letter and has no spaces or `/`. _Avoid_: List name, list ID, slug

**Default List**: The List used when no List is specified, either the one set in
the environment or the List with key `default`.

**Archived List**: A List that cannot be read or changed through its Items until
it is unarchived. Marking all its Items Done does not archive a List.

**Section**: A name that groups Items inside one List. A Section exists only
while at least one Item has it, and Sections do not nest. _Avoid_: Category,
group, sub-section

**Item**: One thing to do inside a List. _Avoid_: Todo, task, entry

**Item ID**: A number that identifies an Item within its List. It is never
reused in that List, and it does not depend on the Item's text or Position.
_Avoid_: Index

**Position**: An Item's place in the order the user keeps for its List,
independent of its Item ID and Priority. _Avoid_: Order, rank, index

**Description**: The short text of an Item. _Avoid_: Title, name, text

**Notes**: The optional longer text of an Item. _Avoid_: Body, details

**Done**: The mark that an Item is complete. _Avoid_: Completed, checked, closed

**Priority**: The optional importance of an Item: High, Medium or Low.

**Duplicate Item**: An Item whose Description and Section exactly match another
Item in the same List. Merging duplicates keeps the Item that was in the List
first, with the higher Priority, keeps it pending unless both are Done, and
appends any differing Notes.

**Prompt**: A task brief for an agent, made from selected Items or Sections,
that tells the agent what to do and how to mark each Item Done. _Avoid_: Brief,
instructions

## Relationships

- **List → Item**: A List has zero or more Items; an Item belongs to exactly one
  List.
- **List → Section**: A List has zero or more Sections; a Section belongs to
  exactly one List.
- **Section → Item**: An Item is in zero or one Section of its own List.
- **Item ID → List**: An Item ID is unique only within its List. Copying or
  moving an Item to another List gives it a new Item ID.
