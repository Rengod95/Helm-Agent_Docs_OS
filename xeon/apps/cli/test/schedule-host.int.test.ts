import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { answeringModels, createRealCli, type RealCli } from "./support/real-host.ts";

// M3b B1-SCH2: 실제 호스트 위의 예약 명령. test/schedule.test.ts의 가짜 처리기를 실제 schedule.* 처리기와 예약 상태 파일로 바꿔 같은 흐름을 확인한다.
// 이 프로세스의 엔진은 서비스 모드가 아니라서 저장만 되고 틱이 돌지 않는다. 그래서 add는 service_mode_off 경고를 stderr에 쓴다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

const WARNING =
  "경고: 서비스 모드가 꺼져 있어 이 예약은 실행되지 않는다. xeon service start로 서비스를 띄운 뒤에 실행된다\n";

function start(): RealCli {
  const cli = createRealCli({
    models: answeringModels("schedule-host", ["답"]),
    harness: { env: { NO_COLOR: "1" } },
  });
  clis.push(cli);
  return cli;
}

/** 한 명령을 돌리고 stdout과 stderr를 비운다. 다음 명령의 출력만 남는다 */
async function step(cli: RealCli, argv: readonly string[]): Promise<number> {
  cli.harness.stdout.length = 0;
  cli.harness.stderr.length = 0;
  return cli.harness.run(argv);
}

function out(cli: RealCli): string {
  return cli.harness.stdoutText();
}

/** `schedule add`의 결과 줄에서 id와 다음 실행 시각(또는 `없음`)을 읽는다. 형식이 맞지 않으면 시험이 실패한다 */
function addedOf(text: string): { readonly id: string; readonly next: string } {
  const match = /^예약했다: (sch_[0-9A-Za-z]+)  [^\n]+  다음 실행 ([^\n]+)\n$/.exec(text);
  const id = match?.[1];
  const next = match?.[2];
  if (id === undefined || next === undefined) throw new Error(`not an add line: ${text}`);
  return { id, next };
}

test("add writes the entry through the real host, and the list shows the same next run", async () => {
  const cli = start();
  expect(await step(cli, ["schedule", "add", "--every", "300", "매일 요약"])).toBe(EXIT.ok);
  const { id, next } = addedOf(out(cli));
  expect(cli.sent("schedule.create")).toEqual([
    {
      method: "schedule.create",
      params: { trigger: { kind: "interval", everySeconds: 300 }, prompt: "매일 요약" },
    },
  ]);
  // 서비스 모드가 꺼져 있다는 경고만 stderr에 남는다
  expect(cli.harness.stderrText()).toBe(WARNING);

  // 목록의 다음 실행 시각은 add가 보인 시각과 같다
  expect(await step(cli, ["schedule", "list"])).toBe(EXIT.ok);
  expect(out(cli)).toBe(`${id}  on  간격 300초  다음 ${next}  마지막 없음  매일 요약\n`);
  expect(cli.harness.stderrText()).toBe("");
}, 60_000);

test("add --at, add --remote, list, cancel and run agree with the real host", async () => {
  const cli = start();
  // 시각 예약: 지금부터 한 시간 뒤(초 단위를 맞춘 ISO 시각)
  const at = new Date(Math.floor((Date.now() + 3_600_000) / 1000) * 1000).toISOString();
  expect(await step(cli, ["schedule", "add", "--at", at, "점검"])).toBe(EXIT.ok);
  const atId = addedOf(out(cli)).id;
  expect(out(cli)).toBe(`예약했다: ${atId}  시각 ${at}  다음 실행 ${at}\n`);
  expect(cli.harness.stderrText()).toBe(WARNING);

  expect(await step(cli, ["schedule", "add", "--remote", "나중에 실행"])).toBe(EXIT.ok);
  const remoteId = addedOf(out(cli)).id;
  expect(out(cli)).toBe(`예약했다: ${remoteId}  원격  다음 실행 없음\n`);

  expect(await step(cli, ["schedule", "add", "--every", "300", "매일 요약"])).toBe(EXIT.ok);
  const intervalId = addedOf(out(cli)).id;

  // 목록: 세 줄이 있고 각 줄에 id와 트리거 요약이 있다
  expect(await step(cli, ["schedule", "list"])).toBe(EXIT.ok);
  const lines = out(cli).split("\n");
  expect(lines).toHaveLength(4);
  expect(lines[0]).toBe(`${atId}  on  시각 ${at}  다음 ${at}  마지막 없음  점검`);
  expect(lines[1]).toBe(`${remoteId}  on  원격  다음 -  마지막 없음  나중에 실행`);
  expect(lines[2]?.startsWith(`${intervalId}  on  간격 300초  다음 `)).toBe(true);
  expect(lines[2]?.endsWith("  마지막 없음  매일 요약")).toBe(true);
  expect(lines[3]).toBe("");

  // 취소: 목록에서 빠지고, --all에서는 끈 상태로 남는다
  expect(await step(cli, ["schedule", "cancel", intervalId])).toBe(EXIT.ok);
  expect(out(cli)).toBe(`껐다: ${intervalId}\n`);
  expect(await step(cli, ["schedule", "list"])).toBe(EXIT.ok);
  expect(out(cli)).not.toContain(intervalId);
  expect(await step(cli, ["schedule", "list", "--all"])).toBe(EXIT.ok);
  expect(out(cli)).toContain(`${intervalId}  off  간격 300초  다음 -  마지막 없음  매일 요약\n`);

  // 원격 예약은 지금 실행한다. 응답은 시작한 시점의 기록이라 started다. 턴은 뒤에서 끝난다
  expect(await step(cli, ["schedule", "run", remoteId])).toBe(EXIT.ok);
  expect(out(cli)).toMatch(new RegExp(`^실행했다: ${remoteId}  run run_[0-9A-Za-z]+  started\n$`));

  // 간격이나 시각 예약은 원격이 아니라서 거부된다
  expect(await step(cli, ["schedule", "run", atId])).toBe(EXIT.error);
  expect(out(cli)).toBe("");
  expect(cli.harness.stderrText()).toBe(
    "xeon: 원격 트리거 예약만 지금 실행할 수 있다\n  해결: 간격·시각 예약은 기한이 되면 실행된다. 원격 예약은 xeon schedule add --remote로 만든다\n",
  );
  expect(await step(cli, ["schedule", "run", "sch_nosuchentry"])).toBe(EXIT.error);
  expect(cli.harness.stderrText()).toBe(
    "xeon: 그런 예약이 없다\n  해결: xeon schedule list --all로 id를 확인한다\n",
  );
}, 60_000);
