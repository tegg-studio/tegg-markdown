# Integration update — 0.2.0-preview.2

The npm preview is published. Install the exact version and retain your lockfile:

```sh
npm install --save-exact @tegg/markdown@0.2.0-preview.2
```

This version includes explicit GitHub/GFM syntax profiles, separate Reader/Editor
entries, React 18/19 adapters, read-only renderer hooks, instance UI customization,
resource opt-in and bounded offline geometry previews. Tegg remains the default
profile. Markdown source, save identity and undo remain authoritative.

## Integration fixes

- Mermaid animation CSS remains readable while external CSS resources are blocked.
- React mount wrappers propagate constrained height; Host scrolling can use natural height.
- Legacy TypeScript Node resolution supports typed subpaths without application aliases.
- Profile command discovery and transient command status support data-driven toolbars.
- A copyable React toolbar handles disabled, pressed and mixed states.
- Live Edit table counts use instance localization. Mode documentation explains syntax visibility.

Start with [getting started](getting-started.md), [React](react.md),
[Host contract](host-contract.md), [extensions](extensions.md),
[appearance and language](appearance-and-i18n.md), and [migration](migration.md).
The license requires visible **Powered by Tegg Markdown** unless a separate written
agreement applies. npm publication does not change those terms.

## Evidence and boundaries

The published artifact matches the tested package integrity. Core coverage is
2,892 tests; four independent registry consumers pass type checking and production
builds, and 49 Chromium/Firefox/WebKit checks pass. Mermaid CI tests 11.9.0,
11.10.0 and the latest compatible 11.x. See [validation](validation.md) and
[the publication record](npm-release.md) for exact identities and scope.

Native interaction evidence for preview.1 remains historical; preview.2 passed
Mac Web regression and local Debug builds, but has no new native visual acceptance.
This is a developer preview. It is not full GitHub product parity or certification
of OS IME, assistive technology or every browser product/version. Offline geometry
does not reproduce GitHub map tiles; KaTeX does not promise every MathJax macro.
The internal 16 ms input target is not uniformly achieved.

Business-ID linking remains Host semantics; there is no arbitrary parser-plugin
API or text matcher in this release. Standard Markdown links remain portable.
Free support includes no fixed SLA. Compatibility uses public standards and generic
fixtures, without requiring partner corpora or internal access. Report reproducible
bugs through [GitHub Issues](https://github.com/tegg-studio/tegg-markdown/issues);
use [private security reporting](../SECURITY.md) for sensitive vulnerabilities.

## 中文接入说明

`@tegg/markdown@0.2.0-preview.2` 已发布到 npm，可按上方命令固定版本安装。本次修复 Mermaid 颜色兼容、React 高度与滚动、旧式 TypeScript 子路径解析及表格计数本地化；提供命令能力查询和 React 工具栏参考。原有 Reader、Live Edit、Source、撤销、流式更新与保存版本契约保持。

宿主负责鉴权、文件访问、资源授权、业务编号规则和保存冲突；按需选择语法 profile 与渲染引擎。SDK 使用公开规范和通用样例维护兼容性，不要求提供业务语料。问题通过 GitHub Issue 提供最小复现；敏感安全问题走私密渠道。

已完成四类真实 npm 安装工程及三浏览器 49 项回验，包完整性与发布前归档一致。Mac 新版仅完成 Web 回归和 Debug 构建，旧版原生交互证据不作为新版验收。此版本仍为预览版，不承诺完整 GitHub 产品效果、所有浏览器版本或固定性能 SLA。使用时固定版本与 lockfile，保留可见的 Powered by Tegg Markdown 署名。
