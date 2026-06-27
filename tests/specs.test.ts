import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildBot } from "../src/bot.js";
import { parseBotSpec, runSpecs } from "../src/toolkit/index.js";

// Programmatic runner for every BotSpec under tests/specs/. The platform's
// tests-gate CLI replays the same JSON files against the same buildBot(), so
// keeping this in sync with the gate is the whole point — a green vitest run
// means a green gate.

const SPECS_DIR = new URL("./specs/", import.meta.url);

function loadSpecs(): { name: string; specs: ReturnType<typeof parseBotSpec>[] }[] {
  const dir = new URL(".", SPECS_DIR).pathname;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({
      name: file,
      specs: JSON.parse(readFileSync(join(dir, file), "utf8")).map(parseBotSpec),
    }));
}

describe("BotSpec JSON files", () => {
  for (const { name, specs } of loadSpecs()) {
    it(`${name} replays cleanly`, async () => {
      const suite = await runSpecs(() => buildBot("test-token"), specs);
      if (suite.failed > 0) {
        for (const r of suite.results) {
          if (r.ok) continue;
          for (const [i, st] of r.steps.entries()) {
            if (st.ok) continue;
            console.log(`  ${name} → ${r.name} step ${i + 1}`);
            for (const f of st.failures) console.log(`    ${f}`);
            for (const c of st.captured.slice(0, 3)) {
              console.log(`    captured: ${c.method}(${JSON.stringify(c.payload).slice(0, 200)})`);
            }
          }
        }
      }
      expect(suite.failed).toBe(0);
      expect(suite.total).toBeGreaterThan(0);
    });
  }
});