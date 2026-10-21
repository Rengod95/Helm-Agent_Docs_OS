import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// plan §5 static-checks.test.ts, spec §9 10·12번. 소스 텍스트 검사다.

const SRC = join(import.meta.dir, "..", "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out.toSorted();
}

const FILES = sourceFiles(SRC).map((path) => ({
  rel: relative(SRC, path),
  text: readFileSync(path, "utf8"),
}));

function filesMatching(pattern: RegExp): string[] {
  return FILES.filter((f) => pattern.test(f.text)).map((f) => f.rel);
}

describe("static checks", () => {
  test("no argv value path", () => {
    const sops = FILES.find((f) => f.rel === "providers/sops.ts")?.text ?? "";
    // 실행 인자는 두 곳에서만 만든다. 둘 다 경로, 옵션, 키 이름뿐이다
    expect(sops).toContain(
      'argv: [binary.value.path, "decrypt", "--extract", extract.value, file.path]',
    );
    expect(sops).toContain('argv: [path, "--disable-version-check", "--version"]');
    expect(sops.match(/argv:/g)).toHaveLength(3); // 위 둘과 RunRequest 인터페이스
    // sops 래퍼는 값 보기(use, bytes, text())에 접근하지 않는다
    expect(sops).not.toMatch(/\.use\(/);
    expect(sops).not.toMatch(/\.bytes\b/);
    expect(sops).not.toMatch(/\bvalue\.text\(/);
    // 프로세스 실행은 한 곳
    expect(filesMatching(/Bun\.spawn(?:Sync)?\(|child_process/)).toEqual(["providers/sops.ts"]);
    // 관리 서비스(add·set·rotate)는 마일스톤 M2다. 생기면 문자열 값 인자가 없어야 한다
    const admin = FILES.find((f) => f.rel === "admin.ts");
    if (admin !== undefined) {
      for (const method of ["add", "set", "rotate"]) {
        const signature = new RegExp(`${method}\\(([^)]*)\\)`).exec(admin.text)?.[1] ?? "";
        expect(signature).not.toMatch(/:\s*string\b/);
      }
    }
  });

  test("platform branch only in select.ts", () => {
    expect(
      filesMatching(
        /process\.(?:platform|arch)|os\.(?:platform|type|release)\(|navigator\.platform/,
      ),
    ).toEqual([]);
    expect(filesMatching(/\binfo\.platform\b/)).toEqual(["select.ts"]);
    expect(filesMatching(/WSL_DISTRO_NAME|\/proc\/version/)).toEqual([]);
  });

  test("text() is called only in the allowed places", () => {
    // 값을 JS 문자열로 바꾸는 호출(헤더 치환)과 Response.text()만 허용한다(plan §7)
    const counts = Object.fromEntries(
      FILES.map((f) => [f.rel, f.text.match(/\.text\(\)/g)?.length ?? 0] as const).filter(
        ([, count]) => count > 0,
      ),
    );
    expect(counts).toEqual({ "providers/sops.ts": 1, "service.ts": 1 });
  });

  test("no ambient time, randomness, console or process.env in src", () => {
    expect(
      filesMatching(
        /Date\.now\(|new Date\(\)|Math\.random|performance\.now|crypto\.randomUUID|getRandomValues/,
      ),
    ).toEqual([]);
    expect(filesMatching(/\bconsole\./)).toEqual([]);
    expect(filesMatching(/process\.env/)).toEqual([]);
  });

  test("no overclaiming wording: masking is described as an aid", () => {
    expect(filesMatching(/보장/)).toEqual([]);
  });

  test("real key locations are never read", () => {
    // 사용자의 sops 설정 디렉터리는 어디서도 읽지 않는다. 키 파일은 설정이 가리키는 경로만 쓴다
    expect(filesMatching(/\.config\/sops|SOPS_AGE_KEY_FILE.*process\.env|homedir\(/)).toEqual([]);
  });

  test("the entry point does not export test doubles", () => {
    const index = FILES.find((f) => f.rel === "index.ts")?.text ?? "";
    expect(index).not.toMatch(/testing/);
    expect(index).not.toMatch(/memorySecrets|fakeSopsBinary/);
  });
});
