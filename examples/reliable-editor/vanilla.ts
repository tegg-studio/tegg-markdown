import {TeggMarkdownEditor,type EditorDocument,type EditorHost,type EditorMode} from '@tegg/markdown/editor';
import {attachEditingUI,type EditingUIHost} from '@tegg/markdown/ui';
import '@tegg/markdown/editor.css';
import '@tegg/markdown/ui.css';

/** The Host supplies persistence, permissions and attachment storage through the public contracts. */
export function createReliableEditor(root:HTMLElement,doc:EditorDocument,host:EditorHost & EditingUIHost={},mode:EditorMode='live'){
  const toolbar=document.createElement('div'),surface=document.createElement('div');
  surface.style.height='min(70vh, 720px)';surface.style.minHeight='320px';root.append(toolbar,surface);
  const editor=new TeggMarkdownEditor(surface,doc,host,mode);
  const ui=attachEditingUI(editor.editing,toolbar,host);
  return {
    editor,ui,
    update(next:EditorDocument){const result=editor.update(next);if(result==='applied')ui.attachToCurrentState();return result;},
    destroy(){ui.destroy();editor.destroy();toolbar.remove();surface.remove();},
  };
}
