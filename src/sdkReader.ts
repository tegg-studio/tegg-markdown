import {TechnicalMarkdownReader, type ReaderHost, type ReaderInput} from "./reader";
import {createAttribution, type AttributionPlacement} from "./attribution";
export class TeggMarkdownReader {
  private readonly frame = document.createElement("div");
  private readonly reader: TechnicalMarkdownReader;
  private destroyed = false;
  constructor(root: HTMLElement, host: ReaderHost & {attribution?: AttributionPlacement} = {}) {
    this.frame.className = "tegg-sdk-frame tegg-surface";
    const content = document.createElement("div"); content.className = "tegg-sdk-content";
    this.frame.append(content);
    const attribution = createAttribution(host.attribution); if (attribution) this.frame.append(attribution);
    root.append(this.frame);
    this.reader = new TechnicalMarkdownReader(content, host);
  }
  render(input: ReaderInput): Promise<void> {
    if (this.destroyed) throw new Error("Reader has been destroyed");
    return this.reader.render(input);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.reader.destroy(); this.frame.remove();
  }
}
