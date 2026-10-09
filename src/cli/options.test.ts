import { describe, expect, test } from "bun:test";

import { UsageError } from "../errors.ts";
import { parseArgv } from "./options.ts";

describe("parseArgv", () => {
  test("takes --done=true and --done=false as --done and --not-done", () => {
    expect(parseArgv(["edit", "1", "--done=true"]).values.done).toBe(true);
    expect(parseArgv(["edit", "1", "--done=false"]).values["not-done"]).toBe(true);
    expect(() => parseArgv(["edit", "1", "--done=maybe"])).toThrow(UsageError);
  });

  test("leaves arguments after -- alone", () => {
    expect(parseArgv(["add", "--", "--done=false"]).positionals).toEqual(["add", "--done=false"]);
  });

  test("lists the options given, by name", () => {
    expect(parseArgv(["ls", "-a", "--section=UI"]).given).toEqual(["all", "section"]);
  });

  test("rejects unknown options", () => {
    expect(() => parseArgv(["ls", "--nope"])).toThrow(UsageError);
  });
});
