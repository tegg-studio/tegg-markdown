# Integration update — 0.3.0-preview.1

## Current published preview — 0.3.0-preview.1 (2026-10-09)

Install the exact preview version and retain your lockfile:

```sh
npm install --save-exact @tegg/markdown@0.3.0-preview.1
```

The official registry archive matches the original frozen package, SHA256
`ed4a1ce3a314b326af8f25bd113b77d3b5595e11e7d15d29b79adb84eb98c768` and integrity
`sha512-wMtRH4+AgQskXQS979fHO7tRrybYIl2l3Cc/5HFmHBFiMZXK1XQd/jyuYBExDmc8vHSkEe8ObwauTNa9d/WU8A==`. Source commit `a705a66437b55c4df7d967ce9447fbd1f885c43a` and merged main
`646cbcdddfcd80a8ab5aefc03bc2020d8c993f83` have the same 437 input files. The official registry `preview` tag is `0.3.0-preview.1`; `latest` remains
`0.2.0-preview.2`. The GitHub pre-release tag points to the original source commit
and attaches this exact archive and its integrity manifest. The original archive is immutable;
CI repacking and later documentation edits do not replace it. The archive's
bundled documents retain their pre-publication status; this repository record
is the current publication result.

The candidate passed 121 unit files / 4,670 tests, full type/build/package gates,
five packed consumers, 922 Chromium/Firefox/WebKit cases, 12 persistent recovery
cases and one HTTP CAS case. Both actual Linux core runs passed all 922 browser
and 12 recovery cases, with zero failures, skips or flaky outcomes, and their
package integrity matches the frozen archive. Mermaid 11.9.0, 11.10.0 and 11.x
compatibility checks also passed. Five fresh official-registry consumers passed
modern/legacy TypeScript resolution, production builds and runtime imports;
all 253 package files matched the frozen archive in every consumer. Their
published-package builds passed the complete 922-browser suite.

This developer preview adds shared natural editing, source-preserving table and
HTML operations, image viewing, localized controls and recovery contracts.
Image viewer zoom preserves center anchors across browser scroll rounding;
outside touch closes block menus. Existing licenses, attribution terms, exact
SDK lockfile and 157-component inventory remain unchanged. Hosts still own
persistence, resource authorization and conflicts. These checks do not certify
native applications, real OS IME, assistive technology or every browser product.

See [registry identity](npm-release.md), [reliable editing](reliable-editing.md)
and [recovery](recovery.md). Earlier results below remain historical evidence.

## Historical integration update — 0.2.0-preview.2

### Historical pre-publication image presentation follow-up

The `0.3.0-preview.1` development candidate removes a stale loading translation
binding once image dimensions arrive. Zoom labels then reflect the actual scale
and remain numeric after locale changes. Reader distinguishes authored text
beside an image from image-only paragraphs; inline, linked and multiple images
retain their source positions. Existing image-only alignment and actions remain.
The parser dependency is pinned to the tested `@codemirror/language@6.12.4`.
Consume the exact reviewed archive and retain the Host lockfile. These changes
are not a registry publication or native application acceptance; see
[development validation](validation.md#image-presentation-development-follow-up).


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
