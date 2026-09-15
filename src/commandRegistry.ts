import {calloutTypes} from "./callouts";
import {resolveProfile,type MarkdownProfile} from "./syntaxProfiles";
import type {EditorUIState} from "./editor";
const supportedCommands = new Set(["undo","redo","bold","italic","code","underline","strike","highlight","subscript","superscript","task","list","orderedList","quote","link","image","fileLink","wikilink","table","divider","codeBlock","mathBlock","mermaid","graphviz","footnote","callout", ...Array.from({length:7}, (_,i) => `heading${i}`)]);
export type CommandStatus = {supported: boolean; enabled: boolean; reason?: "unknown-command" | "unsupported-profile" | "editing-disabled" | "selection-disabled" | "empty-history"};
const profileCommands = Object.fromEntries((["tegg", "github", "gfm"] as const).map(profile => [profile, Object.freeze([...supportedCommands, ...calloutTypes.map(item => `callout:${item.id}`)].filter(command =>
  !(profile !== "tegg" && ["wikilink", "highlight", "subscript", "superscript", "graphviz"].includes(command)) &&
  !(profile === "gfm" && (["mathBlock", "mermaid", "footnote", "callout"].includes(command) || command.startsWith("callout:")))
))])) as Record<MarkdownProfile, readonly string[]>;
/** Stable profile support, distinct from transient selection/focus availability. */
export function getSupportedCommands(profile: MarkdownProfile = "tegg"): readonly string[] {resolveProfile(profile); return profileCommands[profile];}
const inlineCommands = new Set(["bold","italic","code","underline","strike","highlight","subscript","superscript"]);
/** Evaluate an existing UI snapshot without repeatedly scanning the selection. */
export function getCommandStatus(command: string, state: EditorUIState): CommandStatus {
    const known = supportedCommands.has(command) || calloutTypes.some(item => command === `callout:${item.id}`);
    if (!known) return {supported:false, enabled:false, reason:"unknown-command"};
    if (!state.commands.includes(command)) return {supported:false, enabled:false, reason:"unsupported-profile"};
    if(state.parsing)return {supported:true,enabled:false,reason:"selection-disabled"};
    if (!state.toolbarEnabled) return {supported:true, enabled:false, reason:"editing-disabled"};
    if (inlineCommands.has(command) && !state.inlineFormattingEnabled) return {supported:true, enabled:false, reason:"selection-disabled"};
    if ((command === "undo" && !state.canUndo) || (command === "redo" && !state.canRedo)) return {supported:true, enabled:false, reason:"empty-history"};
    return {supported:true, enabled:true};
}
