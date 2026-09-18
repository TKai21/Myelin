import { describe, expect, it } from "vitest";
import { safeCompare } from "./safeCompare";

describe("safeCompare", () => {
  it("returns true for equal strings", () => {
    expect(safeCompare("correct-password", "correct-password")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(safeCompare("correct-password", "wrong-password!!")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(safeCompare("short", "a-much-longer-string")).toBe(false);
  });
});
