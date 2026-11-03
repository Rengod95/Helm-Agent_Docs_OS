import type { ExtensionEntry } from "@fresnel/contracts/extensions";

// __TITLE__ 골격. 훅과 동작은 이 파일의 setup에 더하고, 더한 훅은 매니페스트 plugins[0].hooks에도 적는다.
const entry: ExtensionEntry = ({ manifest, register }) => {
  register(manifest.name, {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};

export default entry;
