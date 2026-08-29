/**
 * Runner-agnostic test harness.
 *
 * The suite used to import `bun:test`, which pinned development to one
 * machine's package manager: a contributor on macOS with only Node
 * installed could not run the tests at all. `node:test` is understood by
 * both runners, so `bun test` and `node --test` now execute the same files.
 *
 * What is *not* portable is the assertion vocabulary, so the handful of
 * matchers the suite actually uses are reimplemented here on top of
 * `node:assert`. Keeping the `expect(...)` shape means the test bodies read
 * exactly as they did before.
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

export { beforeEach, test };

export function expect(actual) {
  return {
    toBe(expected) {
      assert.ok(
        Object.is(actual, expected),
        `expected ${format(actual)} to be ${format(expected)}`
      );
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined);
    },
    toBeCloseTo(expected, digits = 2) {
      // Same tolerance rule as Jest/Bun: half a unit in the last requested
      // decimal place, which is what the geometry tests were written against.
      const tolerance = Math.pow(10, -digits) / 2;
      assert.ok(
        Math.abs(actual - expected) < tolerance,
        `expected ${format(actual)} to be within ${tolerance} of ${format(expected)}`
      );
    },
    toBeGreaterThanOrEqual(expected) {
      assert.ok(actual >= expected, `expected ${format(actual)} >= ${format(expected)}`);
    },
    toBeLessThanOrEqual(expected) {
      assert.ok(actual <= expected, `expected ${format(actual)} <= ${format(expected)}`);
    },
    toContain(expected) {
      assert.ok(
        actual != null && typeof actual.includes === "function" && actual.includes(expected),
        `expected ${format(actual)} to contain ${format(expected)}`
      );
    },
  };
}

function format(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
