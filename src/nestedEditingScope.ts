import type {EditorView} from '@codemirror/view';
import type {Extension} from '@codemirror/state';
import type {EditingController} from './editingController';
import type {EditingUI} from './editingUI';
export type NestedEditingScope={controller:EditingController;ui:EditingUI;destroy():void};
export type NestedEditingOptions={literalObject?:boolean};
let provider:((parent:EditorView,child:EditorView,options?:NestedEditingOptions)=>NestedEditingScope|null)|undefined;
let inlineProjection:Extension=[];
/** Breaks module initialization cycles; the outer UI owns resource callbacks and lifecycle. */
export function installNestedEditingProvider(value:typeof provider){provider=value;}
export function attachNestedEditingScope(parent:EditorView,child:EditorView,options?:NestedEditingOptions):NestedEditingScope|null{return provider?.(parent,child,options)??null;}
export function installNestedInlineProjection(value:Extension){inlineProjection=value;}
export function nestedInlineProjection(){return inlineProjection;}
