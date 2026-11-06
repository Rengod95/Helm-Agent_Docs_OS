# Fresnel

[English](README.md) | [한국어](README.ko.md)

Fresnel（暂定名）是一个对话式智能体运行时。整个运行时按层发布，用户可以在每一层添加或替换插件和插件组。Helm 是默认提供的 L3 插件组。

状态：尚未发布。桌面应用、CLI 和后台服务正在开发中，目前没有稳定版本。

## 结构

| 路径 | 内容 |
|------|------|
| `xeon/` | 工作区：引擎、宿主、CLI 和桌面应用（基于 Bun 的 TypeScript，Electron 外壳） |
| `docs/xeon/` | 产品规划、各层规格与实施计划、具有约束力的工程规则 |
| `packages/agent-docs-init/` | `@helmdocs/init`，Agent Docs OS 安装工具（与运行时相互独立的工具） |

层由低到高依次为 F（契约）、X（扩展宿主）、L0（平台）、L1（核心）、L2（能力）、L3（插件组）、L4（应用）。一个包只能导入比自己更低的层。

## 开始

```bash
cd xeon
mise install      # 固定版本的工具链
just setup        # bun install --frozen-lockfile
just --list       # 所有命令，一切操作都通过 just 运行
just check <pkg>  # 对单个包运行 lint、类型检查和测试，例如 just check packages/core-loop
```

请先阅读 `docs/xeon/engineering/onboarding/guide.md`，工作规则见 `xeon/AGENTS.md`。文档索引是 `docs/xeon/README.md`。

## 许可证

MIT，见 [LICENSE](LICENSE)。发布版的第三方声明由 `xeon/scripts/notices.ts` 生成。
