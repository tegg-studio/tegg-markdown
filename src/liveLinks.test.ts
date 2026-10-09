import {prepareIndependentEditingLeave,editingLeaveAwaitingChoice,editingLeaveIsComposing} from './editingPreflight';
/** @vitest-environment jsdom */
import {afterEach, describe, expect, it, vi} from "vitest";
import {EditorState,StateEffect} from "@codemirror/state";
import {EditorView} from "@codemirror/view";
import {history, undo} from "@codemirror/commands";
import {readLinkDraft} from "./objectDraft";
import {bindUI,type UIOptions} from "./uiContext";
import {markdown} from "@codemirror/lang-markdown";
import {resourceContext} from "./editorHost";
import {GFM} from "@lezer/markdown";
import {editCurrentLink, liveLinks, linkAt, linkReplacement, linkPopoverPlacement, linkActionLabel} from "./liveLinks";
import {resolveHeadingLink} from "./linkNavigation";
function link(source: string, position: number, profile: "tegg" | "github" | "gfm" = "tegg") {
  return linkAt({state: EditorState.create({doc: source, extensions: [markdown({extensions: GFM}),resourceContext.of({documentPath:"",profile})]})} as EditorView, position);
}
describe("Live Edit link targets", () => {
  it.each(["github","gfm"] as const)("does not turn literal wiki syntax into navigation in %s", profile => {
    expect(link("[[Note]]",3,profile)).toBeNull();
    expect(link("[Text](target.md)",3,profile)?.target).toBe("target.md");
  });
  it.each([
    ["[Text](https://example.com)", 3, "https://example.com"],
    ["[Note](folder/note.md#title)", 3, "folder/note.md#title"],
    ["[[笔记#标题|文字]]", 4, "笔记#标题"],
    ["[Ref][id]\n\n[id]: target.md", 3, "target.md"],
    ["<https://example.com>", 4, "https://example.com"],
  ])("resolves %s", (source, position, target) => {
    expect(link(String(source), Number(position))?.target).toBe(target);
  });
  it("never edits apparent links in code or images", () => {
    expect(link("`[[Note]]`", 4)).toBeNull();
    expect(link("```md\n[[Note]]\n```", 10)).toBeNull();
    expect(link("![alt](image.png)", 9)).toBeNull();
  });
  it("escapes edited labels and preserves Wiki syntax", () => {
    const original = link("[Text](target.md)", 3)!;
    expect(linkReplacement(original, "[New]", "other note.md#heading")).toBe("[\\[New\\]](<other%20note.md#heading>)");
    expect(linkReplacement(link("[[Note]]", 3)!, "Label", "Other#Section")).toBe("[[Other#Section|Label]]");
    expect(() => linkReplacement(original, "Text", "javascript:alert(1)")).toThrow();
  });
  it("preserves label formatting and the optional title when only the destination changes", () => {
    const original = link('[**Bold**](old.md "description")', 5)!;
    expect(linkReplacement(original, original.label, "new.md")).toBe('[**Bold**](<new.md> "description")');
  });
  it("resolves explicit IDs, generated slugs and duplicate headings after Metadata", () => {
    const source = "---\ntitle: sample\n---\n# Start {#start}\n\n## 中文 标题\n\n## Repeat\n\n## Repeat";
    expect(resolveHeadingLink(source, "start")?.from).toBe(source.indexOf("# Start"));
    expect(resolveHeadingLink(source, "中文-标题")?.from).toBe(source.indexOf("## 中文"));
    expect(resolveHeadingLink(source, "repeat-1")?.from).toBe(source.lastIndexOf("## Repeat"));
    expect(resolveHeadingLink(source, "missing")).toBeNull();
  });
});


describe("Link popup placement", () => {
  it("flips above a bottom link without covering it", () => {
    const result = linkPopoverPlacement({left: 700, top: 720, bottom: 744}, 280, 150, {width: 800, height: 768});
    expect(result.top + 150).toBeLessThanOrEqual(712);
    expect(result.left + 280).toBeLessThanOrEqual(792);
  });
  it("uses available space and limits tall panels instead of overlapping the anchor", () => {
    const below = linkPopoverPlacement({left: 20, top: 20, bottom: 44}, 280, 150, {width: 800, height: 768});
    expect(below.top).toBe(52);
    const tall = linkPopoverPlacement({left: 20, top: 200, bottom: 224}, 280, 600, {width: 800, height: 400});
    expect(tall.top).toBe(8);
    expect(tall.maxHeight).toBe(184);
  });
});


describe("Link action copy", () => {
  it.each([
    ["https://example.com/file.pdf", "Open in browser"],
    ["mailto:hello@example.com", "Open in mail app"],
    ["#heading", "Jump to heading"],
    ["note%20name.md#heading", "Open note"],
    ["manual.PDF#page=2", "Open file"],
    ["./folder/", "Show in Finder"],
    ["archive.zip", "Show in Finder"],
    ["custom:action", "Unsupported link"],
  ])("describes %s", (target, label) => expect(linkActionLabel(target)).toBe(label));
  it("describes Wiki notes without a file extension", () => expect(linkActionLabel("Note#Heading", true)).toBe("Open note"));
});


describe("legacy link editing preserves source properties", () => {
  const views: EditorView[] = [];
  const bindings:ReturnType<typeof bindUI>[]=[];
  afterEach(() => {for (const view of views.splice(0)) view.destroy();for(const binding of bindings.splice(0))binding.destroy();vi.restoreAllMocks();document.body.replaceChildren();});
  const open = (source: string, position = 4, options?:UIOptions) => {
    const view = new EditorView({parent: document.body, state: EditorState.create({doc: source, selection: {anchor: position},
      extensions: [markdown({extensions: GFM}), resourceContext.of({documentPath: "", profile: "tegg"}), history(), liveLinks]})});
    views.push(view);if(options)bindings.push(bindUI(view.dom,options));vi.spyOn(view, "coordsAtPos").mockReturnValue({left: 20, right: 30, top: 20, bottom: 40});
    expect(editCurrentLink(view)).toBe(true);return view;
  };
  const edit = (name: string, value: string) => {const input = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;input.value = value;input.dispatchEvent(new Event("input"));};
  const save = () => document.querySelector(".md-link-editor form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
  const remove = () => document.querySelector<HTMLButtonElement>(".md-link-remove")!.click();
  const original = '[**first**\nsecond](old "line&#10;next&#9;tab &amp;copy;")';

  const clickChoice=(label:string)=>{const button=Array.from(document.querySelectorAll<HTMLButtonElement>('.md-link-editor button')).find(item=>item.textContent===label)!;expect(button).toBeTruthy();button.click();};
  it.each([true,false])('keeps the complete action associated with its form and supports one source Undo on mobile=%s',mobile=>{
    const original='[old](old.md "author&#10;title")',view=open(original,2,{mobile});
    const dialog=document.querySelector<HTMLElement>('.md-link-editor')!,header=dialog.querySelector('header')!,form=dialog.querySelector('form')!;
    expect(header.querySelector('h2')?.textContent).toBe('Edit link');
    expect([...header.querySelectorAll('button')].map(button=>button.textContent)).toEqual(mobile?['Cancel','Done']:[]);
    expect([...dialog.querySelectorAll('.md-link-editor-actions button')].map(button=>button.textContent)).toEqual(mobile?[]:['Cancel','Done']);
    expect(form.querySelector('.md-link-remove')).not.toBeNull();expect(dialog.querySelector('.md-link-editor-actions .md-link-remove')).toBeNull();
    const done=[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Done')!;
    expect(done.form).toBe(form);edit('Link destination','next.md');done.click();expect(view.state.doc.toString()).toBe('[old](<next.md> "author&#10;title")');
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
  it('mounts in the bound overlay, translates field captions without losing drafts and disposes only its own surface',async()=>{
    const overlay=document.createElement('aside'),sentinel=document.createElement('span');overlay.append(sentinel);document.body.append(overlay);
    const original='[old](old.md)',view=open(original,2,{mobile:true,overlayContainer:overlay}),binding=bindings.at(-1)!;
    expect(overlay.querySelector('.md-link-editor')).not.toBeNull();expect(view.dom.querySelector('.md-link-editor')).toBeNull();
    edit('Link destination','draft.md');binding.update({locale:'zh-CN'});await new Promise(resolve=>setTimeout(resolve,0));
    const dialog=overlay.querySelector('.md-link-editor')!;expect(dialog.querySelector('h2')?.textContent).toBe('\u7f16\u8f91\u94fe\u63a5');
    expect(dialog.querySelector<HTMLInputElement>('input[data-tegg-ui-label="Link destination"]')?.value).toBe('draft.md');
    [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.dataset.teggUiText==='Cancel')!.click();
    expect(view.state.doc.toString()).toBe(original);expect(overlay.children.length).toBe(1);expect(overlay.firstElementChild).toBe(sentinel);
  });
  it('blocks implicit single-line Return and completes only an explicit Command-Return',()=>{
    const original='[old](old.md)',view=open(original),field=document.querySelector<HTMLInputElement>('[aria-label="Display text"]')!;edit('Display text','new');
    const ordinary=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});field.dispatchEvent(ordinary);expect(ordinary.defaultPrevented).toBe(true);expect(view.state.doc.toString()).toBe(original);
    field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,bubbles:true,cancelable:true}));expect(view.state.doc.toString()).toBe('[new](old.md)');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
  it('returns from a protective layer to the original field selection and leaves other window controls inert only while it is open',()=>{
    open('[old](old.md)');edit('Link destination','changed.md');const field=document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!;field.focus();field.setSelectionRange(2,6,'backward');field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    const dialog=document.querySelector('.md-link-editor')!,protection=dialog.querySelector('[role="alertdialog"]')!;expect(document.activeElement?.textContent).toBe('Keep editing');expect((dialog.querySelector('form') as HTMLElement).inert).toBe(true);protection.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(document.activeElement).toBe(field);expect([field.selectionStart,field.selectionEnd,field.selectionDirection]).toEqual([2,6,'backward']);expect((dialog.querySelector('form') as HTMLElement).inert).toBe(false);
  });
  it('edits an existing fully selected link or its final caret without nesting a new wrapper',()=>{for(const selected of [true,false]){const raw='[old](old.md)';const view=open(raw,2);view.dispatch({selection:selected?{anchor:0,head:raw.length}:{anchor:raw.length}});expect(editCurrentLink(view)).toBe(true);expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.value).toBe('old.md');edit('Link destination','next.md');save();expect(view.state.doc.toString()).toBe('[old](<next.md>)');view.destroy();views.splice(views.indexOf(view),1);}});
  it('never lets deferred initial focus steal a destination field the user already selected',()=>{const callbacks:FrameRequestCallback[]=[];vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{callbacks.push(callback);return callbacks.length;});open('[old](old.md)');const pending=callbacks.at(-1)!;const target=document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!;target.focus();target.setSelectionRange(2,2);pending(0);expect(document.activeElement).toBe(target);expect(target.selectionStart).toBe(2);expect(document.querySelector<HTMLInputElement>('[aria-label="Display text"]')!.value).toBe('old');});
  it('retains dirty fields when write access changes and completion fails until explicit discard',()=>{const view=open('[old](old.md)');edit('Link destination','next.md');expect(prepareIndependentEditingLeave(view)).toBe(false);view.dispatch({effects:StateEffect.appendConfig.of(EditorState.readOnly.of(true))});clickChoice('Complete and continue');expect(view.state.doc.toString()).toBe('[old](old.md)');expect(editingLeaveAwaitingChoice(view)).toBe(true);expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.value).toBe('next.md');expect(document.querySelector<HTMLButtonElement>('.md-link-leave-choice [data-tegg-ui-text="Complete and continue"]')!.disabled).toBe(true);expect(document.querySelector('.md-link-leave-error')?.textContent).toContain('read-only');clickChoice('Discard changes');expect(document.querySelector('.md-link-editor')).toBeNull();expect(view.state.doc.toString()).toBe('[old](old.md)');});
  it('does not cancel or discard an independent link field while composition is unfinished',()=>{const view=open('[old](old.md)');edit('Display text','new');const field=document.querySelector<HTMLInputElement>('[aria-label="Display text"]')!;field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));clickChoice('Cancel');expect(document.querySelector('.md-link-editor')).not.toBeNull();expect(view.state.doc.toString()).toBe('[old](old.md)');field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));clickChoice('Cancel');expect(document.querySelector('.md-link-editor')).toBeNull();expect(view.state.doc.toString()).toBe('[old](old.md)');});
  it('retains dirty fields on blur and prepares an explicit choice without replay after Keep editing',()=>{
    const view=open('[old](old.md)');let cancelled=0,resolved=0;view.dom.addEventListener('tegg-editing-leave-cancelled',()=>cancelled++);view.dom.addEventListener('tegg-editing-leave-resolved',()=>resolved++);
    edit('Link destination','new.md');document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.value).toBe('new.md');expect(view.state.doc.toString()).toBe('[old](old.md)');
    expect(prepareIndependentEditingLeave(view)).toBe(false);expect(editingLeaveAwaitingChoice(view)).toBe(true);clickChoice('Keep editing');expect(cancelled).toBe(1);expect(editingLeaveAwaitingChoice(view)).toBe(false);save();expect(resolved).toBe(0);expect(view.state.doc.toString()).toBe('[old](<new.md>)');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe('[old](old.md)');
  });
  it('never queues an IME leave and invalidates a prior pending choice when composition begins',()=>{
    const view=open('[old](old.md)');let cancelled=0,resolved=0;view.dom.addEventListener('tegg-editing-leave-cancelled',()=>cancelled++);view.dom.addEventListener('tegg-editing-leave-resolved',()=>resolved++);edit('Display text','new');expect(prepareIndependentEditingLeave(view)).toBe(false);
    const field=document.querySelector<HTMLInputElement>('[aria-label="Display text"]')!;field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));expect(editingLeaveIsComposing(view)).toBe(true);expect(editingLeaveAwaitingChoice(view)).toBe(false);expect(cancelled).toBe(1);expect(prepareIndependentEditingLeave(view)).toBe(false);save();expect(view.state.doc.toString()).toBe('[old](old.md)');
    field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));clickChoice('Complete and continue');expect(resolved).toBe(0);expect(view.state.doc.toString()).toBe('[new](old.md)');
  });
  it('retains fields across unrelated source edits and refuses a changed target until explicit discard',()=>{
    const view=open('prefix [old](old.md)',10);edit('Link destination','new.md');view.dispatch({changes:{from:0,insert:'added '}});expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.value).toBe('new.md');save();expect(view.state.doc.toString()).toBe('added prefix [old](<new.md>)');
    expect(editCurrentLink(view)).toBe(true);edit('Link destination','other.md');const from=view.state.doc.toString().indexOf('[old]');view.dispatch({changes:{from:from+1,to:from+4,insert:'external'}});save();expect(document.querySelector('[role="alert"]')?.textContent).toContain('link changed');expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.value).toBe('other.md');expect(prepareIndependentEditingLeave(view)).toBe(false);clickChoice('Discard changes');expect(document.querySelector('.md-link-editor')).toBeNull();expect(view.state.doc.toString()).toContain('[external](<new.md>)');
  });

  it("changes only the target and retains formatted multiline label and title semantics", () => {
    const view = open(original);edit("Link destination", "folder/new note.md");expect(view.state.doc.toString()).toBe(original);save();
    const source = view.state.doc.toString();expect(source).toContain("[**first**\nsecond]");
    expect(readLinkDraft(source)).toEqual({label: "first\nsecond", url: "folder/new%20note.md", title: "line\nnext\ttab &copy;"});
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
  it("edits the label without flattening title entities or decoding the untouched destination", () => {
    const raw = '[first](<folder/a%20b.md?literal=%2520> "line&#10;next&#9;tab &amp;copy;")';const view = open(raw);
    edit("Display text", "[replacement] &copy;");save();
    expect(readLinkDraft(view.state.doc.toString())).toEqual({label: "[replacement] &copy;", url: "folder/a%20b.md?literal=%2520", title: "line\nnext\ttab &copy;"});
    expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);
  });
  it("submits untouched multiline content without creating a transaction", () => {
    const view = open(original);save();expect(view.state.doc.toString()).toBe(original);expect(undo(view)).toBe(false);
  });
  it("unwraps only an untouched link while preserving label Markdown", () => {
    const view = open(original);remove();expect(view.state.doc.toString()).toBe("**first**\nsecond");expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(original);
  });
  it("removes the wrapper around an edited plain label with Markdown escaping", () => {
    const view = open("[plain](old)");edit("Display text", "**literal** &copy;");remove();
    expect(view.state.doc.toString()).toBe("\\*\\*literal\\*\\* &amp;copy;");expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe("[plain](old)");
  });
  it("changes a reference destination only after entering shared scope and preserves occurrence syntax and title bytes", () => {
    const raw='[**first**\nsecond][id]\n\n[id]: old "line&#10;next&#9;tab &amp;copy;"';const view=open(raw);
    expect(document.querySelector<HTMLInputElement>('[aria-label="Link destination"]')!.readOnly).toBe(true);
    clickChoice('Shared target (1 occurrences)');edit('Link destination','new.md');save();
    expect(view.state.doc.toString()).toBe(raw.replace(': old ',': <new.md> '));expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);
  });

  it("unwraps a reference occurrence without editing its shared definition", () => {
    const raw = '[**first**][id]\n\n[id]: old "title"';const view = open(raw);remove();expect(view.state.doc.toString()).toBe('**first**\n\n[id]: old "title"');expect(undo(view)).toBe(true);expect(view.state.doc.toString()).toBe(raw);
  });
  it("retains target validation and leaves source unchanged after a rejected edit", () => {
    const view = open(original);edit("Link destination", "javascript:alert(1)");save();expect(view.state.doc.toString()).toBe(original);expect(document.querySelector('[role="alert"]')?.textContent).toContain("supported link");expect(undo(view)).toBe(false);
  });
});
