// 확장 내보내기(`ext.package`)의 순수 판단: 묶음을 어디에 만들까, 실패를 어떤 줄로 알릴까.
// 설치본 폴더 안에 쓰지 않는다: 묶음은 사용자 설정(또는 데이터) 폴더의 `exports/<이름>-<버전>-<시각>`에 만든다(없거나 비어 있어야 하므로 시각을 붙인다).
import type { ExtListEntry } from "@fresnel/contracts/wire";
import type { CommandError } from "../commands.ts";

/** 검토본 저장소 폴더 이름(`apps/host`의 `plugin-store`) */
const STORE_FOLDER = "plugin-store";

/** 경로 구분자. 설치 위치가 Windows 경로면 `\`이고 아니면 `/`다 */
function separatorOf(location: string): "/" | "\\" {
  return location.includes("\\") && !location.includes("/") ? "\\" : "/";
}

/** 시각을 `YYYYMMDD-HHMMSS`(UTC)로 줄인다. 폴더 이름에 쓸 수 있는 글자만 남긴다 */
export function stampOf(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
}

/**
 * 묶음을 만들 폴더. 설치 위치 `<설정 폴더>/extensions/<이름>`의 설정 폴더 아래 `exports/`다.
 * 설치 위치가 두 단계 위를 가질 수 없는 모양이면 null이고 화면은 내보내기를 막는다
 */
export function exportOutOf(
  entry: Pick<ExtListEntry, "name" | "version" | "location">,
  at: Date,
): string | null {
  const separator = separatorOf(entry.location);
  const parts = entry.location.split(separator).filter((part) => part !== "");
  if (parts.length < 3) return null;
  const root = entry.location.startsWith(separator) ? separator : "";
  // 설치본은 검토본 저장소(`<데이터 폴더>/plugin-store/reviewed/<이름>/<해시>/tree`)에 있다. 저장소 안에 쓰면 저장소를 어지럽히므로
  // 저장소 폴더의 바깥(데이터 폴더)에 만든다. 저장소가 아니면 옛 위치(`<설정 폴더>/extensions/<이름>`)의 두 단계 위다
  const storeAt = parts.indexOf(STORE_FOLDER);
  const base = storeAt > 0 ? parts.slice(0, storeAt) : parts.slice(0, -2);
  if (base.length === 0) return null;
  const configDir = `${root}${base.join(separator)}`;
  return [configDir, "exports", `${entry.name}-${entry.version}-${stampOf(at)}`].join(separator);
}

/** 실패 한 줄에 붙일 이유. 엔진이 입력을 거절한 문장(`<종류>: <내용>`)이 있으면 그것이고 없으면 null */
export function exportFailureDetail(error: CommandError): string | null {
  return error.kind === "rejected" && error.issue !== undefined ? error.issue : null;
}
