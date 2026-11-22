// 가져오기 훑기 자식의 샌드박스 시험용 대역. 사용: bun migration-scan-probe.ts <밖 파일> <안 파일> <쓸 파일> <보호 파일>
// 뜨면 네 가지를 시도하고 결과를 JSON 한 줄로 표준 출력에 쓴 뒤, 표준 입력이 닫힐 때까지 산다.
//   readOutside   <밖 파일>을 읽는다(ok | denied). 열린 정책(AGE-63)이라 샌드박스 아래에서도 읽힌다(셸 도구와 같다)
//   readInside    <안 파일>을 읽는다(ok | denied). 훑기 루트 안이라 열려 있다
//   writeInside   <쓸 파일>에 쓴다(ok | denied). 열린 정책이라 쓰인다
//   readProtected <보호 파일>을 읽는다(ok | denied). Fresnel 자신의 데이터라 샌드박스 아래에서는 막혀야 한다
import { readFileSync, writeFileSync } from "node:fs";
import { attempt } from "@fresnel/contracts";

const outsideFile = process.argv[2];
const insideFile = process.argv[3];
const writeFile = process.argv[4];
const protectedFile = process.argv[5];
if (
  outsideFile === undefined ||
  insideFile === undefined ||
  writeFile === undefined ||
  protectedFile === undefined
) {
  process.stderr.write("usage: migration-scan-probe.ts <outside> <inside> <write> <protected>\n");
  process.exit(2);
}

function outcomeOf(action: () => void): "ok" | "denied" {
  return attempt(action).ok ? "ok" : "denied";
}

const result = {
  readOutside: outcomeOf(() => {
    readFileSync(outsideFile, "utf8");
  }),
  readInside: outcomeOf(() => {
    readFileSync(insideFile, "utf8");
  }),
  writeInside: outcomeOf(() => {
    writeFileSync(writeFile, "written\n");
  }),
  readProtected: outcomeOf(() => {
    readFileSync(protectedFile, "utf8");
  }),
};
process.stdout.write(`${JSON.stringify(result)}\n`);
process.stdin.resume();
process.stdin.on("end", () => {
  process.exit(0);
});
