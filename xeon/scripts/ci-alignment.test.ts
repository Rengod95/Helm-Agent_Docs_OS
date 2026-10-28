import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// CI must run what `just verify` runs (M2 closing G4-07). The steps come from xeon/scripts/verify-steps.sh (the list the root justfile's _verify-steps runs), the
// commands from .github/workflows/xeon-ci.yml. lint, typecheck and test run per layer through `just ci-layer`, so the
// matrix must hold every layer and root (xeon/scripts).

const REPO = join(import.meta.dir, "..", "..");
const LAYERS = ["root", "F", "X", "L0", "L1", "L2", "L3", "L4"];
const BY_LAYER = new Set(["lint", "typecheck", "test"]);

function verifySteps(): string[] {
  const script = readFileSync(join(REPO, "xeon", "scripts", "verify-steps.sh"), "utf8");
  const found = /^steps=\((.*)\)$/m.exec(script);
  if (found?.[1] === undefined) throw new Error("verify-steps.sh has no steps=(...) list");
  // a step with arguments is quoted ("docs-route --check"); the recipe is its first word
  const quoted = found[1].matchAll(/"([^"]+)"|(\S+)/g);
  return Array.from(quoted, (match) => (match[1] ?? match[2] ?? "").split(" ")[0] ?? "").filter(
    (step) => step !== "",
  );
}

interface Workflow {
  readonly runs: readonly string[];
  readonly matrix: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function workflow(): Workflow {
  const data: unknown = Bun.YAML.parse(
    readFileSync(join(REPO, ".github", "workflows", "xeon-ci.yml"), "utf8"),
  );
  if (!isRecord(data) || !isRecord(data["jobs"])) throw new Error("xeon-ci.yml has no jobs");
  const runs: string[] = [];
  let matrix: string[] = [];
  for (const job of Object.values(data["jobs"])) {
    if (!isRecord(job)) continue;
    const strategy = job["strategy"];
    if (isRecord(strategy) && isRecord(strategy["matrix"])) {
      const layer = strategy["matrix"]["layer"];
      if (Array.isArray(layer)) matrix = layer.map(String);
    }
    const steps = job["steps"];
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (isRecord(step) && typeof step["run"] === "string") runs.push(step["run"]);
    }
  }
  return { runs, matrix };
}

const runsRecipe = (runs: readonly string[], recipe: string): boolean =>
  runs.some((run) => new RegExp(`(^|\\s)just ${recipe}(\\s|$)`, "m").test(run));

test("every verify step has a CI command", () => {
  const steps = verifySteps();
  expect(steps).toContain("check-ts-rules");
  const { runs } = workflow();
  const missing = steps.filter(
    (step) => !runsRecipe(runs, step) && !(BY_LAYER.has(step) && runsRecipe(runs, "ci-layer")),
  );
  expect(missing).toEqual([]);
});

test("CI is the full form of verify: turbo reads no cache in either workflow", () => {
  for (const file of ["xeon-ci.yml", "xeon-macos.yml"]) {
    const data: unknown = Bun.YAML.parse(
      readFileSync(join(REPO, ".github", "workflows", file), "utf8"),
    );
    expect(isRecord(data) && isRecord(data["env"]) ? data["env"]["TURBO_FORCE"] : undefined).toBe(
      "true",
    );
  }
});

test("the layer matrix covers xeon/scripts and every layer", () => {
  expect(workflow().matrix).toEqual(LAYERS);
});

test("CI runs the exit-condition tests and installs their sandbox binaries", () => {
  const { runs } = workflow();
  expect(runsRecipe(runs, "exit-tests")).toBe(true);
  expect(runs.filter((run) => run.includes("apt-get install -y bubblewrap socat")).length).toBe(2);
});
