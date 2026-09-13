import {bindUI, type UIOptions} from "./uiContext";
import {disposeInteractions} from "./renderInteraction";
import {TechnicalMarkdownReader, type ReaderHost, type ReaderInput} from "./reader";
import {createAttribution, type AttributionPlacement} from "./attribution";
export class TeggMarkdownReader {
  private readonly frame = document.createElement("div");
  private readonly reader: TechnicalMarkdownReader;
  private destroyed = false;
  private ui: ReturnType<typeof bindUI>;
  constructor(root: HTMLElement, host: ReaderHost & {attribution?: AttributionPlacement} = {}) {
    this.frame.className = "tegg-sdk-frame tegg-surface";
    this.frame.dataset.layout = host.layout ?? "internal"; this.frame.dataset.chrome = host.chrome ?? "default";
    const content = document.createElement("div"); content.className = "tegg-sdk-content";
    this.frame.append(content);
    const attribution = createAttribution(host.attribution); if (attribution) this.frame.append(attribution);
    root.append(this.frame);
    this.ui = bindUI(this.frame,host,false);
    this.reader = new TechnicalMarkdownReader(content, host);
  }
  setUI(options: UIOptions) {this.reader.setUI(options); this.ui.update(options);}
  render(input: ReaderInput): Promise<void> {
    if (this.destroyed) throw new Error("Reader has been destroyed");
    return this.reader.render(input);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; disposeInteractions(this.frame); this.reader.destroy(); this.ui.destroy(); this.frame.remove();
  }
}
