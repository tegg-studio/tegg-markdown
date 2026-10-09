import {selectionHistory, undo, redo} from "./selectionHistory";
// Keep editing/history/completion/folding, deliberately omit Find/Replace.
import { EditorState } from "@codemirror/state";
import { lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap } from "@codemirror/view";
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap } from "@codemirror/language";
import { history, defaultKeymap, historyKeymap, undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";

export const editorSetup = [lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
  history(), selectionHistory, foldGutter(), drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
  indentOnInput(), syntaxHighlighting(defaultHighlightStyle, {fallback: true}), bracketMatching(),
  closeBrackets(), autocompletion(), rectangularSelection(), crosshairCursor(), highlightActiveLine(),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap.map(binding => binding.run === cmUndo ? {...binding,run:undo} : binding.run === cmRedo ? {...binding,run:redo} : binding), ...foldKeymap, ...completionKeymap, ...lintKeymap])];
