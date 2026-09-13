import {configureDefaultEngines} from "./renderEngines";
import {katexEngine} from "./engines/katex";
import {highlightEngine} from "./engines/highlight";
import {mermaidEngine} from "./engines/mermaid";
import {graphvizEngine} from "./engines/graphviz";
configureDefaultEngines({math: katexEngine, highlight: highlightEngine, mermaid: mermaidEngine, graphviz: graphvizEngine});
