/** UTF-16 source units; conservative shared policy for standalone and native Hosts. */
export const editingBudgets=Object.freeze({sourcePreviewUnits:524288,draftPreviewUnits:8192,diagramDraftUnits:2048,diagramDraftLines:32});
export function editingPerformancePolicy(source:string|number){const units=typeof source==="string"?source.length:source;return {sourcePreview:units>=editingBudgets.sourcePreviewUnits,reason:units>=editingBudgets.sourcePreviewUnits?"large-document" as const:null};}
