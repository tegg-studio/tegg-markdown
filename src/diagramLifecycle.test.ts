/** @vitest-environment jsdom */
import {afterEach, expect, it, vi} from "vitest";
const engine = vi.hoisted(() => ({finish: undefined as undefined | ((value:{svg:string})=>void)}));
vi.mock("mermaid", () => ({default:{initialize:vi.fn(),render:vi.fn(()=>new Promise(resolve=>{engine.finish=resolve;}))}}));
import {renderDiagram} from "./renderKit";
afterEach(()=>{vi.useRealTimers(); document.body.replaceChildren();});
it("bounds queued readiness without claiming to cancel the engine, and discards late SVG", async () => {
 vi.useFakeTimers();const first=document.createElement('div'),second=document.createElement('div');document.body.append(first,second);
 const one=renderDiagram({kind:'diagram',engine:'mermaid',source:'flowchart LR\nA-->B'},first);
 const two=renderDiagram({kind:'diagram',engine:'mermaid',source:'flowchart LR\nC-->D'},second);
 await vi.advanceTimersByTimeAsync(4000);await Promise.all([one,two]);
 expect(first.dataset.renderState).toBe('over-budget');expect(second.dataset.renderState).toBe('over-budget');
 engine.finish?.({svg:'<svg><text>Late</text></svg>'});await vi.advanceTimersByTimeAsync(1);
 expect(first.querySelector('svg')).toBeNull();expect(second.querySelector('svg')).toBeNull();
});
