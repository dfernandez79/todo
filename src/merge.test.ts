import { describe, expect, test } from "bun:test";

import { duplicateKey, mergeDuplicate } from "./merge.ts";

describe("duplicateKey", () => {
  test("matches the same description and Section exactly", () => {
    expect(duplicateKey({ description: "A", section: "S" })).toBe(
      duplicateKey({ description: "A", section: "S" }),
    );
    expect(duplicateKey({ description: "A", section: "S" })).not.toBe(
      duplicateKey({ description: "a", section: "S" }),
    );
    expect(duplicateKey({ description: "A" })).not.toBe(
      duplicateKey({ description: "A", section: "S" }),
    );
  });
});

describe("mergeDuplicate", () => {
  test("keeps the higher Priority, with none ranking below Low", () => {
    expect(
      mergeDuplicate({ description: "A", priority: "low" }, { description: "A", priority: "high" })
        .priority,
    ).toBe("high");
    expect(
      mergeDuplicate(
        { description: "A", priority: "medium" },
        { description: "A", priority: "low" },
      ).priority,
    ).toBe("medium");
    expect(
      mergeDuplicate({ description: "A" }, { description: "A", priority: "low" }).priority,
    ).toBe("low");
  });

  test("stays pending unless both are Done, keeping the target's done time", () => {
    const done = "2026-01-01T00:00:00.000Z";
    const later = "2026-02-01T00:00:00.000Z";
    expect(
      mergeDuplicate({ description: "A", doneAt: done }, { description: "A" }).doneAt,
    ).toBeUndefined();
    expect(
      mergeDuplicate({ description: "A" }, { description: "A", doneAt: done }).doneAt,
    ).toBeUndefined();
    expect(
      mergeDuplicate({ description: "A", doneAt: done }, { description: "A", doneAt: later })
        .doneAt,
    ).toBe(done);
  });

  test("appends Notes the target doesn't already hold", () => {
    expect(
      mergeDuplicate({ description: "A", notes: "x" }, { description: "A", notes: "y" }).notes,
    ).toBe("x\n\ny");
    expect(
      mergeDuplicate({ description: "A", notes: "x\n\ny" }, { description: "A", notes: "y" }).notes,
    ).toBe("x\n\ny");
    expect(mergeDuplicate({ description: "A" }, { description: "A", notes: "y" }).notes).toBe("y");
    expect(mergeDuplicate({ description: "A", notes: "x" }, { description: "A" }).notes).toBe("x");
  });
});
