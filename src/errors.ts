const TODO_ERROR_CODES = [
  "LIST_NOT_FOUND",
  "LIST_EXISTS",
  "LIST_ARCHIVED",
  "LIST_NOT_EMPTY",
  "ITEM_NOT_FOUND",
  "INVALID_INPUT",
] as const;

type TodoErrorCode = (typeof TODO_ERROR_CODES)[number];

/** A problem with what was asked of the todo lists, with a stable code. Exits 1. */
class TodoError extends Error {
  readonly code: TodoErrorCode;

  constructor(code: TodoErrorCode, message: string) {
    super(message);
    this.name = "TodoError";
    this.code = code;
  }
}

/** A problem with how the command was invoked. Exits 2. */
class UsageError extends Error {
  override name = "UsageError";
}

export { TODO_ERROR_CODES, TodoError, type TodoErrorCode, UsageError };
