import {createElement as h} from 'react';
import {getCommandStatus, type TeggMarkdownEditor, type EditorUIState} from '@tegg/markdown/editor';

/** Copyable reference UI; labels and product styling belong to the Host. */
export function MarkdownToolbar({editor,state}:{editor:TeggMarkdownEditor|null;state:EditorUIState|null}) {
  if (!editor || !state) return null;
  const buttons = ['undo','redo','bold','italic','code','underline','strike','highlight','subscript','superscript','task','link','image','table','codeBlock','mathBlock','mermaid','graphviz','footnote'] as const;
  return h('div',{'role':'group','aria-label':'Markdown formatting'},
    ...buttons.filter(command=>state.commands.includes(command)).map(command=> {
      const pressed = state.mixed.includes(command) ? 'mixed' : (state as unknown as Record<string,unknown>)[command];
      return h('button',{key:command,type:'button',disabled:!getCommandStatus(command,state).enabled,
        'aria-pressed':typeof pressed === 'boolean' || pressed === 'mixed' ? pressed : undefined,
        onMouseDown:(event:{preventDefault():void})=>event.preventDefault(),onClick:()=>editor.command(command)},command);
    }),
    h('select',{'aria-label':'Paragraph style',value:state.heading===null?'mixed':String(state.heading),disabled:!state.toolbarEnabled,
      onChange:(event:{currentTarget:{value:string}})=>editor.command(`heading${event.currentTarget.value}`)},
      h('option',{value:'mixed',disabled:true},'Mixed'),...Array.from({length:7},(_,level)=>h('option',{key:level,value:String(level)},level?`Heading ${level}`:'Body'))),
    state.commands.includes('callout') ? h('select',{'aria-label':'Callout type',value:state.callout ? `callout:${state.callout}` : '',disabled:!state.toolbarEnabled,
      onChange:(event:{currentTarget:{value:string}})=>editor.command(event.currentTarget.value)},h('option',{value:'',disabled:true},'Callout'),
      ...state.commands.filter(command=>command.startsWith('callout:')).map(command=>h('option',{key:command,value:command},command.slice(8)))) : null);
}
