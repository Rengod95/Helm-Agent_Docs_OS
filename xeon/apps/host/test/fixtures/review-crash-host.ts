import { tapeBuildModels, tapeProvider, tapePlayer } from "@fresnel/core-models/testing";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import type { HostPluginModule } from "../../src/types.ts";
import { startStdioHost } from "../../src/command-run.ts";
import { reviewTape } from "./review-tape.ts";
import { realTapeClock } from "./tape-host.ts";

// 검토 되돌림 이어하기 시험의 자식 호스트. 운영 진입(startStdioHost)에 모델 테이프를 넣는다. 부모가 SIGKILL로 죽인다.
// 이 파일은 시험 파일이다(DR-08). 입출력은 부모와 맞물린 stdin·stdout JSON Lines다.

// 되돌림 쓰기 직전의 실행 가드(guard.output.before, target execution)에서 영원히 멈추는 시험용 플러그인.
// 거절 답의 승인 해결은 기록되고 되돌림은 시작도 못 한 채 부모가 SIGKILL로 죽이게 한다.
const HOLD_MANIFEST = defineManifest({
  schemaVersion: 2,
  name: "revert-hold",
  version: "0.1.0",
  displayName: "Revert hold",
  description: "Test plugin: holds the execution guard of a revert write forever.",
  defaultEnabled: true,
  entry: "./src/index.ts",
  plugins: [{ layer: "L3", hooks: ["guard.output.before"] }],
  orchestration: {},
  trust: { level: "builtin" },
});

const holdEntry: ExtensionEntry = ({ manifest, register }) => {
  register(manifest.name, {}, (g) => {
    g.on("guard.output.before", async (payload) => {
      if (payload.target !== "execution") return undefined;
      await new Promise<never>(() => undefined);
      return undefined;
    });
  });
};

const HOLD_PLUGIN: HostPluginModule = { manifest: HOLD_MANIFEST, extension: holdEntry };

async function main(): Promise<number> {
  const out = new WritableStream<Uint8Array>({
    write(chunk) {
      process.stdout.write(chunk);
    },
  });
  const exit = await startStdioHost({
    readable: Bun.stdin.stream(),
    writable: out,
    assemble: {
      defaultGroups: false,
      extraPlugins: [HOLD_PLUGIN],
      buildModels: tapeBuildModels(
        tapeProvider(tapePlayer(reviewTape("review-crash-child"), { clock: realTapeClock() })),
      ),
    },
    handleSignals: false,
  });
  return exit.code;
}

main().then(
  (code) => process.exit(code),
  (caught: unknown) => {
    process.stderr.write(
      `review-crash-host: ${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}\n`,
    );
    process.exit(1);
  },
);
