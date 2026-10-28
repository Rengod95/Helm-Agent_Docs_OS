// bun test 전역 훅(bunfig.toml preload). 파일마다 훅을 걸 필요가 없다.
import { afterEach } from "bun:test";
import { closeOpenedStores } from "./sqlite-store.ts";

afterEach(closeOpenedStores);
