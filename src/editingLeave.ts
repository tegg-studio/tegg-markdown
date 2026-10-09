import {editingLeaveIsComposing,prepareIndependentEditingLeave,cancelIndependentEditingLeave} from './editingPreflight';
import {htmlDirectEditingIsComposing} from './htmlDirectEditing';
import {footnoteEditingIsComposing,prepareFootnoteChildren} from "./footnoteEditing";
import type {EditorView} from '@codemirror/view';
import type {EditingController} from './editingController';
import {commitTableDrafts,tableWidgetIsComposing} from './tableWidget';
import {commitHtmlTableDrafts,htmlTableWidgetIsComposing} from './htmlTableWidget';
import {commitMetadataPanel} from './metadata';
/** Shared low-level Host preflight. A rejected attempt is never queued for later replay. */
export function prepareEditingLeave(view:EditorView,root:HTMLElement,controller:EditingController):boolean {
  if([root,view.dom].some(scope=>scope.querySelector('[data-callout-temporary-composing="true"]'))){cancelIndependentEditingLeave(view);return false;}
  if(editingLeaveIsComposing(view)||view.composing||htmlDirectEditingIsComposing(view)||tableWidgetIsComposing(view)||htmlTableWidgetIsComposing(view)||footnoteEditingIsComposing(view)){cancelIndependentEditingLeave(view);return false;}
  if(!prepareIndependentEditingLeave(view))return false;
  if(!view.dom.dispatchEvent(new CustomEvent('tegg-editing-preflight',{bubbles:true,cancelable:true})))return false;
  if(!prepareFootnoteChildren(view))return false;
  if(!commitTableDrafts(view)||!commitHtmlTableDrafts(view))return false;
  const panels=new Set([...root.querySelectorAll<HTMLElement>('.frontmatter'),...view.dom.querySelectorAll<HTMLElement>('.frontmatter')]);
  for(const panel of panels)if(!commitMetadataPanel(panel))return false;
  const session=controller.session;
  if(session&&['editing','stale'].includes(session.status)){
    const dirty=session.draft!==session.original;
    view.dom.dispatchEvent(new CustomEvent('tegg-editing-leave-request',{bubbles:true,detail:{session,dirty}}));
    if(dirty)return false;
    if(controller.session?.token===session.token&&controller.session.status==='editing')controller.cancel(session.token);
  }
  return true;
}
