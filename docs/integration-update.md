# Integration update — 0.2.0-preview.1

This Git preview adds explicit GitHub/GFM syntax profiles, lightweight entries,
React 18/19 integration, read-only renderer hooks, per-instance UI customization,
resource opt-in and bounded offline geometry previews. Existing Tegg syntax remains
the default. The source, save identity and undo model are preserved.

Use [getting started](getting-started.md), [React](react.md),
[Host contract](host-contract.md), [extensions](extensions.md),
[appearance and language](appearance-and-i18n.md), and [migration](migration.md).
The license continues to require visible **Powered by Tegg Markdown** unless a
separate written agreement applies.

Compatibility is maintained against fixed public standards and generic fixtures.
No partner-specific corpus, internal business access or partner acceptance cycle is
required. Report ordinary reproducible problems through the repository's Issues;
use the private security route for vulnerabilities or sensitive information.

This is a developer preview, not a stable or npm registry release. The Git identity,
package integrity, actual platform checks and remaining gaps are recorded in
[validation](validation.md). Offline map previews do not reproduce GitHub map tiles;
KaTeX is not a claim of complete GitHub MathJax macro parity. Native integrations
retain their own file permissions, menus, persistence and platform validation.

Validated core coverage includes 2,889 tests, fixed public syntax fixtures and
independent React/vanilla consumers. The browser matrix covers 37 checks across
Chromium, Firefox and WebKit, including real worker idle recovery. Native Host
smoke validation covers editing, exact save/reopen, local resources and Finder
Quick Look. Final native follow-up on the released tag also verified literal
reference brackets and exact edit/undo/save/reopen behavior. See the validation
record for commit-specific results and limits.
No real OS IME, assistive-technology or complete browser product/version certificate
is implied. The internal 16 ms input target is not uniformly achieved.

## 中文接入说明

本次预览版增加 GitHub/GFM 语法配置、独立 Reader/Editor 入口、React 18/19 适配、只读组件替换、按实例设置界面语言与外观，以及显式资源授权。原有 Tegg 语法继续作为默认配置，Markdown 原文、撤销与保存版本身份继续由同一契约保护。

从接入指南开始，按需选择语法配置与渲染引擎；宿主负责鉴权、文件访问和保存冲突，参考 HTTP CAS 示例接入版本检查。地图提供离线几何预览，不能等同于完整在线地图；公式使用 KaTeX，不能承诺所有 MathJax 宏兼容。超出预览预算时保留完整源码。

我们以公开规范和通用样例维护兼容性，不要求提供业务语料或内部系统访问。普通问题通过 GitHub Issue 提供最小复现即可，敏感安全问题使用私密反馈渠道。可安装的版本身份、实际验证范围与尚未执行的平台检查以验证记录为准。界面中的 Powered by Tegg Markdown 仍须依许可保留。

## Published npm preview — 0.2.0-preview.2

The published preview addresses Mermaid animation-style compatibility, React mount
height propagation, legacy TypeScript subpath resolution, profile command discovery
and table quantity localization. It adds a copyable React toolbar reference and
explicit Mermaid version/color checks. See [React integration](react.md) and
[validation](validation.md). Install the published version with `npm install --save-exact @tegg/markdown@0.2.0-preview.2`.

已发布的 npm 预览版补充 Mermaid 颜色兼容、React 高度传递、旧式 TypeScript 子路径解析、命令能力查询及表格计数本地化，并提供 React 工具栏参考。业务编号自动关联仍由宿主负责，尚未开放通用行内匹配接口；免费支持不附带固定 SLA。`@tegg/markdown@0.2.0-preview.2` 已发布到 npm，包完整性与已验证归档一致。接入时固定精确版本和 lockfile，并保留许可要求的可见署名。
