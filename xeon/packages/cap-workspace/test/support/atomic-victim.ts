import { createFilesApi } from "../../src/service.ts";
import { override, realDeps, realEnv } from "./real-env.ts";

// SIGKILL 시험의 자식 프로세스. 임시 파일을 쓰고 디스크에 내린 뒤, 이름을 바꾸기 직전에 멈춰 "ready"를 알린다.
// 부모가 이 상태에서 SIGKILL을 보낸다. 인자: <작업 디렉터리> <대상 파일 이름> <새 내용>

const [root = "", name = "", content = ""] = process.argv.slice(2);
const base = realEnv(root);
const env = override(base, {
  renameFile: async () => {
    process.stdout.write("ready\n");
    await new Promise<never>(() => {});
    return { ok: true, value: undefined };
  },
});
await createFilesApi(realDeps(env)).write({ path: name, content });
