import type Token from "markdown-it/lib/token.mjs";
import {parserFor} from "./markdownParser";
import type {MarkdownProfile} from "./syntaxProfiles";
import {findFrontmatter} from "./profile";

export type OutlineHeading = {id: string; level: number; title: string; from: number; anchor: string};

function plainText(tokens: Token[]): string {
  return tokens.map(token => {
    if (token.type === "html_inline") return "";
    if (token.type === "image") return token.content;
    if (token.type === "softbreak" || token.type === "hardbreak") return " ";
    return token.children ? plainText(token.children) : token.nesting === 0 ? token.content : "";
  }).join("");
}

/** Same parser as Reader; cache one immutable result per source revision. */
export class HeadingIndex {
  private source: string | null = null;
  private entries: OutlineHeading[] = [];
  private serial = 0;
  private profile: MarkdownProfile = "tegg";

  update(source: string, profile: MarkdownProfile = "tegg"): OutlineHeading[] {
    if (source === this.source && profile === this.profile) return this.entries;
    const normalized = source.replace(/\r\n?|\n/g, "\n");
    const {body} = profile === "tegg" ? findFrontmatter(normalized) : {body: normalized};
    const offset = normalized.length - body.length;
    const starts = [offset];
    for (let i = 0; i < body.length; i++) if (body[i] === "\n") starts.push(offset + i + 1);
    const tokens = parserFor(profile).parse(body, {profile});
    const used=new Set<string>();
    const byTitle=new Map<string,{items:OutlineHeading[];index:number}>();
    const byPosition=new Map<string,OutlineHeading>();
    const titleKey=(item:{level:number;title:string})=>JSON.stringify([item.level,item.title]);
    for(const item of this.entries){const key=titleKey(item);let queue=byTitle.get(key);if(!queue){queue={items:[],index:0};byTitle.set(key,queue);}queue.items.push(item);byPosition.set(item.level+":"+item.from,item);}
    const pending: Omit<OutlineHeading, "id">[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== "heading_open" || !token.map) continue;
      const title = plainText(tokens[i + 1]?.children ?? []).trim();
      const level = Number(token.tag.slice(1));
      const from = starts[token.map[0]] ?? offset;
      pending.push({level, title, from, anchor: `outline-line-${token.map[0]}`});
    }
    // Reserve unchanged headings first. A new heading inserted at an old
    // position must not steal the identity of an unchanged heading below it.
    const matchedIDs = pending.map(item => {
      const queue=byTitle.get(titleKey(item)),match=queue?.items[queue.index++];
      if(match)used.add(match.id);return match?.id??null;
    });
    const next = pending.map((item, index) => {
      let id = matchedIDs[index];
      if (!id) {
        const match=byPosition.get(item.level+":"+item.from);
        id=match&&!used.has(match.id)?match.id:`heading-${++this.serial}`;
        used.add(id);
      }
      return {...item, id};
    });
    this.source = source; this.profile = profile;
    this.entries = next;
    return next;
  }
}
