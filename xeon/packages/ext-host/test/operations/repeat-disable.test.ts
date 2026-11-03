import { expect, test } from "bun:test";
import {
  createRepeatDisableLedger,
  REPEAT_DISABLE_THRESHOLD,
  type RepeatDisableBackend,
} from "../../src/operations/index.ts";

// X.operations.spec §9 7번 [결정: 2026-11-04 사용자 B5]. 여러 번의 시작에서 반복해 꺼지면 묻고, 조용히 영속하지 않는다.

function memoryBackend(
  initial: string | null = null,
): RepeatDisableBackend & { text: string | null } {
  const backend = {
    text: initial,
    read: () => Promise.resolve(backend.text),
    write(text: string) {
      backend.text = text;
      return Promise.resolve();
    },
  };
  return backend;
}

async function startOnce(backend: RepeatDisableBackend, name: string) {
  const ledger = createRepeatDisableLedger({ backend });
  await ledger.load();
  ledger.recordAutoDisable(name);
  await ledger.flush();
  return ledger;
}

test("the question appears only after the extension was auto-disabled in enough separate starts", async () => {
  expect(REPEAT_DISABLE_THRESHOLD).toBe(3);
  const backend = memoryBackend();
  const first = await startOnce(backend, "flaky");
  expect(first.question("flaky")).toBeNull();
  const second = await startOnce(backend, "flaky");
  expect(second.question("flaky")).toBeNull();
  const third = await startOnce(backend, "flaky");
  expect(third.question("flaky")).toEqual({ name: "flaky", disabledStarts: 3 });
  expect(third.question("other")).toBeNull();
});

test("a second auto-disable in the same process does not count as another start", async () => {
  const backend = memoryBackend();
  const ledger = createRepeatDisableLedger({ backend });
  await ledger.load();
  ledger.recordAutoDisable("flaky");
  ledger.recordAutoDisable("flaky");
  ledger.recordAutoDisable("flaky");
  await ledger.flush();
  expect(ledger.question("flaky")).toBeNull();
  expect(JSON.parse(backend.text ?? "{}")).toEqual({ schemaVersion: 1, starts: { flaky: 1 } });
});

test("answering keep-on clears the count and a corrupt file starts empty", async () => {
  const backend = memoryBackend();
  await startOnce(backend, "flaky");
  await startOnce(backend, "flaky");
  const third = await startOnce(backend, "flaky");
  third.clear("flaky");
  await third.flush();
  expect(third.question("flaky")).toBeNull();
  expect(JSON.parse(backend.text ?? "{}")).toEqual({ schemaVersion: 1, starts: {} });
  const corrupt = createRepeatDisableLedger({ backend: memoryBackend("{not json") });
  await corrupt.load();
  expect(corrupt.question("flaky")).toBeNull();
});
