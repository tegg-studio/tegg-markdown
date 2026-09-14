// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {attachConflictUI, type ConflictUI, type ConflictUIContext, type ConflictUIHost} from "./conflictUI";
import {applySourcePatches} from "./sourcePatch";

const uis: ConflictUI[] = [];
afterEach(() => {uis.splice(0).forEach(ui => ui.dispose()); document.body.replaceChildren();});

function fixture() {
  const base = "alpha=old\nbeta=old\ngamma=old\n";
  let context: ConflictUIContext = {
    base: {documentId: "fixture.md", revision: "disk-1", source: base},
    local: {documentId: "fixture.md", baseRevision: "disk-1", generation: "page", sequence: 1, source: base.replace("beta=old", "beta=local")},
    incoming: {documentId: "fixture.md", revision: "disk-2", source: base.replace("alpha=old", "alpha=new").replace("gamma=old", "gamma=new")},
  };
  const savedCopies: string[] = [];
  const host: ConflictUIHost = {
    getContext: vi.fn(() => context),
    applyPatches: vi.fn((patches, expected) => {
      expect(expected).toEqual(context.local);
      context = {...context, local: {...context.local, sequence: context.local.sequence + 1, source: applySourcePatches(context.local.source, patches)}};
      return context.local;
    }),
    adoptIncomingBaseline: vi.fn((incoming, expected) => {
      expect(expected).toEqual(context.local); expect(incoming).toEqual(context.incoming);
      savedCopies.push(incoming.source);
      context = {...context, base: incoming, local: {...context.local, baseRevision: incoming.revision}};
      return true;
    }),
    acceptExternal: vi.fn((incoming, expected) => {
      expect(expected).toEqual(context.local);
      savedCopies.push(expected.source);
      context = {...context, base: incoming, local: {...context.local, baseRevision: incoming.revision, source: incoming.source, sequence: context.local.sequence + 1}};
      return true;
    }),
    saveCopy: vi.fn((source, expected) => {expect(expected).toEqual(context.local); savedCopies.push(source); return true;}),
  };
  const root = document.createElement("div"); document.body.append(root);
  return {root, host, savedCopies, get: () => context, set: (next: ConflictUIContext) => {context = next;}};
}
const findButton = (ui: ConflictUI, label: string) => [...ui.element.querySelectorAll("button")].find(button => button.textContent === label)!;
const select = (ui: ConflictUI, index: number, value: string) => {
  const control = ui.element.querySelectorAll("fieldset")[index].querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
  control.checked = true; control.dispatchEvent(new Event("change", {bubbles: true}));
};
async function mount(item: ReturnType<typeof fixture>) {
  const ui = attachConflictUI(item.root, item.host); uis.push(ui);
  await vi.waitFor(() => expect(ui.element.querySelectorAll("fieldset").length).toBeGreaterThan(0));
  return ui;
}

describe("optional external change review UI", () => {
  it("shows all versions and applies a partial selection without advancing its baseline", async () => {
    const item = fixture(), original = item.get(), ui = await mount(item);
    expect(ui.element.textContent).toContain("Original version");
    expect(ui.element.textContent).toContain("Your current draft");
    expect(ui.element.textContent).toContain("External version");
    select(ui, 0, "apply"); findButton(ui, "Apply selected changes").click();
    await vi.waitFor(() => expect(ui.element.textContent).toContain("Selected changes applied."));
    expect(item.host.applyPatches).toHaveBeenCalledTimes(1);
    expect(item.host.adoptIncomingBaseline).not.toHaveBeenCalled();
    expect(item.get().base).toEqual(original.base);
    expect(item.get().local.baseRevision).toBe("disk-1");
    expect(item.get().local.source).toContain("alpha=new");
    expect(item.get().local.source).toContain("gamma=old");
    expect(document.activeElement).toBe(ui.element);
    findButton(ui, "Keep my version for all remaining changes").click();
    findButton(ui, "Complete review").click();
    await vi.waitFor(() => expect(item.host.adoptIncomingBaseline).toHaveBeenCalledTimes(1));
    expect(item.get().local.source).toContain("beta=local");
    expect(item.get().local.source).toContain("gamma=old");
    expect(ui.element.textContent).toContain("still needs a successful save");
  });

  it("requires explicit decisions and never writes after the displayed document changes", async () => {
    const item = fixture(), ui = await mount(item);
    expect(findButton(ui, "Apply selected changes").disabled).toBe(true);
    select(ui, 0, "apply");
    item.set({...item.get(), local: {...item.get().local, documentId: "other.md"}});
    findButton(ui, "Apply selected changes").click();
    await vi.waitFor(() => expect(ui.element.textContent).toContain("refresh the comparison"));
    expect(item.host.applyPatches).not.toHaveBeenCalled();
    expect(item.host.adoptIncomingBaseline).not.toHaveBeenCalled();
  });

  it("does not adopt a new baseline if another update arrives after patch application", async () => {
    const item = fixture(), apply = item.host.applyPatches;
    item.host.applyPatches = vi.fn(async (patches, expected) => {
      const result = await apply(patches, expected);
      item.set({...item.get(), incoming: {...item.get().incoming, revision: "disk-3", source: "a newer version"}});
      return result;
    });
    const ui = await mount(item);
    for (let i = 0; i < ui.element.querySelectorAll("fieldset").length; i++) select(ui, i, "apply");
    findButton(ui, "Complete review").click();
    await vi.waitFor(() => expect(ui.element.textContent).toContain("refresh the comparison"));
    expect(item.host.adoptIncomingBaseline).not.toHaveBeenCalled();
    expect(item.get().local.baseRevision).toBe("disk-1");
  });

  it("saves a copy without resolving or changing the original conflict", async () => {
    const item = fixture(), original = item.get(), ui = await mount(item);
    findButton(ui, "Save my draft as a copy").click();
    await vi.waitFor(() => expect(item.savedCopies).toEqual([original.local.source]));
    expect(item.get()).toEqual(original);
    expect(item.host.applyPatches).not.toHaveBeenCalled();
    expect(item.host.adoptIncomingBaseline).not.toHaveBeenCalled();
  });

  it("requires a successful Host result before showing external acceptance", async () => {
    const item = fixture(); item.host.acceptExternal = vi.fn(() => false);
    const ui = await mount(item); findButton(ui, "Use external version").click();
    await vi.waitFor(() => expect(ui.element.textContent).toContain("refresh the comparison"));
    expect(ui.element.textContent).not.toContain("External version opened.");
  });

  it("renders untrusted source as text and supports Chinese labels and Escape focus return", async () => {
    const item = fixture(); item.host.locale = "zh";
    item.set({...item.get(), local: {...item.get().local, source: '<img src=x onerror="alert(1)">'}});
    const launcher = document.createElement("button"); document.body.prepend(launcher); launcher.focus();
    const ui = await mount(item);
    expect(ui.element.textContent).toContain("检查外部修改");
    expect(ui.element.querySelector("img")).toBeNull();
    ui.element.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    expect(ui.element.isConnected).toBe(false);
    expect(document.activeElement).toBe(launcher);
  });

  it("disposal during an asynchronous context lookup cannot trigger a late write", async () => {
    const item = fixture(), ui = await mount(item);
    let release!: (context: ConflictUIContext) => void;
    item.host.getContext = () => new Promise(resolve => {release = resolve;});
    select(ui, 0, "apply"); findButton(ui, "Apply selected changes").click();
    ui.dispose(); release(item.get());
    await Promise.resolve(); await Promise.resolve();
    expect(item.host.applyPatches).not.toHaveBeenCalled();
    expect(item.host.adoptIncomingBaseline).not.toHaveBeenCalled();
  });
});
