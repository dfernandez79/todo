import { describe, expect, test } from "bun:test";

import { COLORS, PLAIN } from "./style.ts";

const ESC = "\u001B[";

describe("COLORS", () => {
  test("formats inline Markdown: bold, italic and code", () => {
    expect(COLORS.inline("**Fix** the _login_ in `auth.ts`")).toBe(
      `${ESC}1mFix${ESC}22m the ${ESC}3mlogin${ESC}23m in ${ESC}33mauth.ts${ESC}39m`,
    );
    expect(COLORS.inline("__bold__ and *italic*")).toBe(
      `${ESC}1mbold${ESC}22m and ${ESC}3mitalic${ESC}23m`,
    );
  });

  test("leaves Markdown markers inside code and snake_case words alone", () => {
    expect(COLORS.inline("`a **b**` snake_case_name")).toBe(
      `${ESC}33ma **b**${ESC}39m snake_case_name`,
    );
  });

  test("keeps code in the muted color", () => {
    expect(COLORS.inline("Run `bun test`", { muted: true })).toBe("Run bun test");
  });

  test("mutes IDs and Done Items, and highlights Section headings", () => {
    expect(COLORS.id("`id:3`")).toBe(`${ESC}90m\`id:3\`${ESC}39m`);
    expect(COLORS.done("- [x] Done")).toBe(`${ESC}90m- [x] Done${ESC}39m`);
    expect(COLORS.section("## UI")).toBe(`${ESC}1m${ESC}34m## UI${ESC}39m${ESC}22m`);
  });
});

describe("PLAIN", () => {
  test("leaves text as it is", () => {
    expect(PLAIN.inline("**Fix** `it`")).toBe("**Fix** `it`");
    expect(PLAIN.section("## UI")).toBe("## UI");
  });
});
