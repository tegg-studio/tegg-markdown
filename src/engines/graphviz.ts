import type {RenderEngines} from "../renderEngines";
import {technicalValidationUnavailable} from "../technicalSyntax";
import {diagramDefaults,graphvizDisplaySource} from '../diagramDefaults';
export const graphvizEngine: NonNullable<RenderEngines["graphviz"]> = async (source,target,current) => {
  const {graphvizRenderer}=await import('../graphviz');if(!current())return '';const defaults=diagramDefaults(target);return graphvizRenderer.render(defaults.formal?graphvizDisplaySource(source,defaults):source,current);
};

graphvizEngine.validate = async (source, _target, current) => {
  if (!current()) return {status: "stale"};
  try {
    const {graphvizRenderer} = await import("../graphviz");
    if (!current()) return {status: "stale"};
    return await graphvizRenderer.validate(source, current);
  } catch (error) {return current() ? technicalValidationUnavailable(error) : {status: "stale"};}
};
