declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  export default function taskLists(md: MarkdownIt, options?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }): void;
}

declare module "markdown-it-deflist" {
  import type MarkdownIt from "markdown-it";
  export default function deflist(md: MarkdownIt): void;
}

declare module "markdown-it-emoji" {
  import type MarkdownIt from "markdown-it";
  export function full(md: MarkdownIt, options?: { shortcuts?: Record<string, string | string[]> }): void;
}

declare module "markdown-it-emoji/lib/data/full.mjs" {
  const emojiMap: Record<string, string>;
  export default emojiMap;
}

declare module "markdown-it-sub" {
  import type MarkdownIt from "markdown-it";
  export default function sub(md: MarkdownIt): void;
}

declare module "markdown-it-sup" {
  import type MarkdownIt from "markdown-it";
  export default function sup(md: MarkdownIt): void;
}

declare module "*?raw" {
  const source: string;
  export default source;
}

// Vite bundles the worker and WASM locally, including the single-file app surface.
declare module "*?worker&inline" {
  const WorkerConstructor: {new (): Worker};
  export default WorkerConstructor;
}
