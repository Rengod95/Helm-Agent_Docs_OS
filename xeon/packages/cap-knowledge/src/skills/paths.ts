import { isSkillFilePath } from "@xeon/contracts/capabilities";

// 지원 파일 경로 검사. F의 `isSkillFilePath`(스키마 패턴 + "."·".." 마디 거부)를 파일을 열기 전에 반드시 먼저 부른다.
// 이 패키지는 거기에 점으로 시작하거나 끝나는 마디 거부를 더한다: 트리 해시와 캡처가 점 항목을 보지 않으므로, 그런 파일을
// 쓰면 `baseHash`가 그 파일의 변경을 가리지 못한다(L2.knowledge.spec §4.2.3). F 스키마를 좁혀 달라는 요청은 같은 규칙이다.

export function isAddressableSkillFile(path: string): boolean {
  if (!isSkillFilePath(path)) return false;
  return path.split("/").every((segment) => !segment.startsWith(".") && !segment.endsWith("."));
}
