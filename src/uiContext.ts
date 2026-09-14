export type Locale = "en-US" | "zh-CN";
export type UIMessages = Readonly<Record<string, string>>;
export type UIOptions = {locale?: Locale; messages?: UIMessages; overlayContainer?: HTMLElement};
const chinese: UIMessages = {
"{rows} row × {columns} column":"{rows} 行 × {columns} 列",
"{rows} row × {columns} columns":"{rows} 行 × {columns} 列",
"{rows} rows × {columns} column":"{rows} 行 × {columns} 列",
"{rows} rows × {columns} columns":"{rows} 行 × {columns} 列",

"Add Row":"添加行",
"Add Column":"添加列",
"Code language":"代码语言",
"Code content":"代码内容",
"Copy code":"复制代码",
"Wrap lines":"自动换行",
"Edit link":"编辑链接",
"Link actions":"链接操作",
"Open {value}":"打开 {value}",
"Target":"目标",
"Text":"文字",
"Title":"标题",
"Open":"打开",
"Edit":"编辑",
"Remove link":"移除链接",
"Copy link":"复制链接",

  "Preview formula": "预览公式",
  "Large document: source preview is shown to keep the interface responsive.": "文档较大，显示源码预览以保持界面响应。",
  "Save": "保存",
  "Source": "源码",
  "Edit Source": "编辑源码",
  "Full note": "完整脚注",
  "Return to reference": "返回引用",
  "Rendering…": "正在渲染…",
  "Callout type": "提示块类型",
  "Markdown image": "Markdown 图片",
  "Completed task": "已完成任务",
  "Incomplete task": "未完成任务",
  "Horizontal rule": "分隔线",
  "Metadata · YAML": "属性 · YAML",
  "Done editing YAML": "完成 YAML 编辑",
  "Math formula": "数学公式",
  "Zoom in": "放大",
  "Zoom out": "缩小",
  "Left": "左移",
  "Right": "右移",
  "Up": "上移",
  "Down": "下移",
  "Rotate": "旋转",
  "Reset": "重置",
  "ASCII STL preview": "ASCII STL 预览",
  "Offline geometry; no external map tiles are requested.": "离线几何图形；不请求外部地图瓦片。",
  "Copy unavailable. Select the source to copy.": "无法复制，请选择源码后复制。",
  "Content is still being generated. The diagram will render when it is complete.": "内容仍在生成，完成后将渲染图表。",
  "Diagram preview exceeded its waiting budget. Source remains available.": "图表预览等待超时，仍可查看源码。",
  "Diagram is too large to preview. Its source remains available.": "图表过大，仍可查看源码。",
  "Too many diagrams. Split this document into smaller sections.": "图表过多，请将文档分为较小部分。",
  "Edit {value}": "编辑 {value}",
  "Value for {value}": "{value} 的值",
  "Footnote {value}": "脚注 {value}",
  "Formula: {value}": "公式：{value}",
  "Table cell: {value}": "表格单元格：{value}",
  "Edit table cell: {value}": "编辑表格单元格：{value}",
  "Could not display image · {value}": "无法显示图片 · {value}",
  "Empty": "空",
  "Block quote": "引用块",
  "Add row": "添加行",
  "Add column": "添加列",
  "Delete row": "删除行",
  "Delete column": "删除列",

  "Copy": "复制", "Copied": "已复制", "Close": "关闭", "Fit": "适应窗口", "Formula": "公式", "Diagram": "图表",
  "View formula": "查看公式", "View diagram": "查看图表", "Copy TeX": "复制 TeX", "Copy source": "复制源码",
  "Diagram source": "图表源码", "View controls": "查看控制", "Viewing background": "查看背景",
  "Background: Automatic": "背景：自动", "Background: Light": "背景：浅色", "Background: Dark": "背景：深色",
  "Metadata": "属性", "Edit YAML": "编辑 YAML", "Done": "完成", "Cancel": "取消", "Apply": "应用",
  "Markdown Reader": "Markdown 阅读器", "Markdown Editor": "Markdown 编辑器", "Task": "任务",
  "Table. Scroll horizontally for more columns.": "表格。横向滚动查看更多列。",
  "Code. Scroll horizontally for long lines.": "代码。横向滚动查看长行。",
  "Math. Scroll horizontally for long expressions.": "公式。横向滚动查看长公式。",
  "Diagram or formula. Scroll to pan; use zoom controls to enlarge.": "图表或公式。滚动平移，使用缩放控件放大。",
};
export const defaultMessages = Object.freeze({"en-US": Object.freeze({}) as UIMessages, "zh-CN": Object.freeze(chinese)});
const contexts = new WeakMap<HTMLElement, UIOptions>();
export function contextFor(node: HTMLElement): UIOptions {
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    const context = contexts.get(current); if (context) return context;
  }
  return {};
}
const parameters = new WeakMap<HTMLElement, Record<string,string>>();
export function message(node: HTMLElement, key: string) {
  const context = contextFor(node); const template = context.messages?.[key] ?? defaultMessages[context.locale ?? "en-US"][key] ?? key;
  return template.replace(/\{(\w+)\}/g,(all,name)=>parameters.get(node)?.[name] ?? all);
}
export function setUIText(node: HTMLElement, key: string, values?: Record<string,string>) {if(values) parameters.set(node,values);node.dataset.teggUiText = key; node.textContent = message(node, key);}
export function setUILabel(node: HTMLElement, key: string, values?: Record<string,string>) {if(values) parameters.set(node,values);node.dataset.teggUiLabel = key; node.setAttribute("aria-label", message(node, key));}
function translate(root: HTMLElement) {
  for (const node of [root, ...root.querySelectorAll<HTMLElement>("[data-tegg-ui-text], [data-tegg-ui-label]")]) {
    if (node.dataset.teggUiText !== undefined) {const value = message(node, node.dataset.teggUiText); if (node.textContent !== value) node.textContent = value;}
    if (node.dataset.teggUiLabel !== undefined) {const value = message(node, node.dataset.teggUiLabel); if (node.getAttribute("aria-label") !== value) node.setAttribute("aria-label", value); if(node.hasAttribute("title") && node.title !== value) node.title=value;}
  }
}
export function bindUI(root: HTMLElement, options: UIOptions = {}, observe = true) {
  const context = {...options}; contexts.set(root, context); root.lang = context.locale ?? "en-US";
  const observer = new MutationObserver(() => translate(root));
  if(observe) observer.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ["data-tegg-ui-text", "data-tegg-ui-label"]});
  translate(root);
  return {update(next: UIOptions) {Object.assign(context, next); root.lang = context.locale ?? "en-US"; translate(root);}, destroy() {observer.disconnect(); contexts.delete(root);}};
}
export function mountOverlay(owner: HTMLElement, dialog: HTMLElement): () => void {
  const options = contextFor(owner);
  if (!options.overlayContainer) {owner.append(dialog); return () => {};}
  const surface = document.createElement("div"); surface.className = "tegg-surface tegg-overlay-root";
  const sync = () => {
    const style = getComputedStyle(owner);
    for (let i = 0; i < style.length; i++) {const key = style.item(i); if (key.startsWith("--")) surface.style.setProperty(key, style.getPropertyValue(key));}
    if (owner.dataset.theme) surface.dataset.theme = owner.dataset.theme;
  };
  sync(); const ui = bindUI(surface, options);
  const observer = new MutationObserver(() => {sync(); ui.update(options);});
  observer.observe(owner, {attributes: true, attributeFilter: ["style", "class", "data-theme", "lang"]});
  surface.append(dialog); options.overlayContainer.append(surface);
  return () => {observer.disconnect(); ui.destroy(); surface.remove();};
}
