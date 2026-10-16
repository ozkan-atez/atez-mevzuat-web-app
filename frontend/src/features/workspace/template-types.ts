export interface TemplateRequirement {
  id:string;heading:string;instruction:string;required:boolean;enabled:boolean;
  scope:'REPORT'|'DOCUMENT';length:'SHORT'|'MEDIUM'|'DETAILED';condition:string;missing:'NOTE'|'OMIT'|'BLOCK'
}
export interface TemplateNode {id:string;type:'paragraph'|'list'|'table'|'comparison'|'timeline'|'notice'|'divider'|'heading';field:string;label:string;text:string}
export interface TemplateComponent {id:string;name:string;description:string;nodes:TemplateNode[]}
export interface TemplatePlacement {id:string;requirementId:string|null;componentId:string;enabled:boolean;title:string;staticText:string;columns:1|2;tone:'plain'|'info'|'warning'}
export interface TemplateDefinition {
  brief?:string;schemaVersion:2;requirements:TemplateRequirement[];components:TemplateComponent[];layout:TemplatePlacement[];
  theme:{accent:string;background:string;fontSize:number;spacing:number};
  shell:{heading:string;footer:string;showLogo:boolean;showHeader:boolean;showFooter:boolean}
}
export interface TemplateAiResult {definition?:TemplateDefinition;componentId?:string;html?:string;issues?:Array<{heading:string;message:string;blocking:boolean}>}
export const newId=()=>crypto.randomUUID()
export function moveItem<T>(items:T[],from:number,to:number):T[]{const next=[...items];const [item]=next.splice(from,1);if(item!==undefined)next.splice(to,0,item);return next}
