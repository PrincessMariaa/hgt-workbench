import { calculateV2 } from './engine.mjs';
export const VERSION = '0.2.0';
export const GATE_KEYS = ['cargo', 'uptake', 'escape', 'access', 'establish', 'retain'];
export const ROUTES = {
  dna: {name: 'EV DNA → chromosome', short: 'DNA · chromosomal', cargo: 'Intact target DNA', access: 'Nuclear access', establish: 'Chromosomal integration', retain: 'Retention per division', endpoint: 'chromosomal acquisition'},
  episome: {name: 'EV DNA → extrachromosomal', short: 'DNA · extrachromosomal', cargo: 'Intact target DNA', access: 'Nuclear access', establish: 'Productive establishment', retain: 'Maintenance per division', endpoint: 'extrachromosomal acquisition'},
  rna: {name: 'EV RNA → LINE-1 insertion', short: 'RNA · LINE-1', cargo: 'Competent LINE-1 RNA cargo', access: 'Productive machinery access', establish: 'Reverse transcription + insertion', retain: 'Retention per division', endpoint: 'RNA-mediated insertion'}
};
const initial = [.01, .2, .01, .1, .001, .5 ** .2];
export const clamp = (v, a=0, b=1) => Math.max(a, Math.min(b, v));
export const neutralModifiers = () => Object.fromEntries(['encounters', ...GATE_KEYS].map(k => [k, 1]));
export function defaultState() {
  return {
    version: VERSION, route: 'dna', recipients: 100000, ratio: 1, hours: 48, rate: 100,
    generations: 5, drug: 'none', treatment: '', assay: .8,
    gates: Object.fromEntries(Object.keys(ROUTES).map(r => [r, Object.fromEntries(GATE_KEYS.map((k,i) => [k, {value: initial[i], span: k==='retain'?.05:1, locked: false, respond: true, source:'assumed', citation:'', note:''}]))])),
    profiles: Object.fromEntries(['none','doxo','cisplatin','custom'].map(k => [k, neutralModifiers()])),
    poly: {enabled: false, fraction: .25, establish: 1, retain: 1, growthDelta:0, survival:1, expression:1},
    selection: {enabled: false, modified: .8, unmodified: .8, growth: 1},
    function: {expression:.5,efflux:.5},
    dynamics: {enabled:true,donorGrowth:0,koGrowth:0,functionalGrowth:0,divisionHours:24,donorSurvival:1,koSurvival:1,functionalSurvival:1,start:0,end:48,evLag:0},
    experiment: {koAllele:'unknown',recipientMarker:'',donorMarker:'',target:'donor-specific ABCB1 sequence'},
    observation: {endpoint:'phenotype',protein:0,rna:0,transientDNA:0,adaptation:0,carryover:0,fusion:0,background:0},
    calibration: {enabled:false,q:2e-9,priorMin:1e-16,priorMax:1,label:'',demo:false},
    observations: [], snapshots: [], migration:''
  };
}
export function activeModifiers(s, reference=false, stressActive=true) {
  return reference || s.drug === 'none' || !stressActive ? neutralModifiers() : s.profiles[s.drug];
}
export function effectiveGates(s, {reference=false, values=null, poly=false, stressActive=true, perDivision=false}={}) {
  const m = activeModifiers(s, reference, stressActive);
  return GATE_KEYS.map(k => {
    const g = s.gates[s.route][k];
    let v = values?.[k] ?? g.value;
    if (g.respond!==false) {
      v *= m[k];
      if(poly && !reference && s.poly.enabled && (k === 'establish' || k === 'retain')) v *= s.poly[k];
    }
    v=clamp(v); return k==='retain'&&!perDivision?v**s.generations:v;
  });
}
export function rangeFor(g) {
  if(g.value === 0 || g.locked || g.span === 0) return [g.value,g.value];
  const center = Math.log10(g.value);
  return [Math.max(Number.MIN_VALUE,10 ** (center-g.span)), Math.min(1,Math.max(Number.MIN_VALUE,10 ** (center+g.span)))];
}
export function cumulative(vals) {
  let p=1;
  return [1,...vals.map(v => p*=v)];
}
export function calculate(s, options={}) { return calculateV2(s,options,{effectiveGates,activeModifiers,cumulative,clamp}); }
function random(seed) {
  return () => {seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
}
export function quantile(sorted,p) {
  const x=(sorted.length-1)*p,i=Math.floor(x),f=x-i;
  return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*f;
}
export function sample(s, count=400) {
  const rng=random(20261026), rows=[];
  for(let i=0;i<count;i++) {
    const values={};
    for(const k of GATE_KEYS) {
      const [lo,hi]=rangeFor(s.gates[s.route][k]);
      values[k]=lo===hi?lo:10**(Math.log10(lo)+rng()*(Math.log10(hi)-Math.log10(lo)));
    }
    rows.push(calculate(s,{values}));
  }
  const summary={};
  for(const k of ['founders','any','detected','functionalFounders']) {
    const sorted=rows.map(r=>r[k]).sort((a,b)=>a-b);
    summary[k]=[quantile(sorted,.1),quantile(sorted,.5),quantile(sorted,.9)];
  }
  return {rows,summary};
}
export function sensitivity(s) {
  return GATE_KEYS.map(k=>{
    const g=s.gates[s.route][k], [lo,hi]=rangeFor(g);
    const a=calculate(s,{values:{[k]:lo}}).founders, b=calculate(s,{values:{[k]:hi}}).founders;
    return {key:k,lo:a,hi:b,locked:g.locked,unused:s.calibration.enabled&&k!=='retain',orders:a>0?Math.log10(Math.max(1,b/a)):0};
  }).sort((a,b)=>b.orders-a.orders);
}
export function validateState(raw) {
  const d=defaultState();
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('Expected a scenario object.');
  const legacy=!String(raw.version??'0.1').startsWith('0.2'),horizon=raw.generations||1;
  const str=(x,n=300)=>String(x??'').slice(0,n);
  const finite=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('Invalid '+label+'.');return v;};
  if(!Object.hasOwn(ROUTES,raw.route))throw new Error('Unknown transfer pathway.');
  d.route=raw.route;
  for(const [k,min,max] of [['recipients',0,1e9],['ratio',0,1000],['hours',0,8760],['rate',0,1e9],['generations',0,1000],['assay',0,1]])d[k]=finite(raw[k],min,max,k);
  if(!Number.isInteger(d.recipients)||!Number.isInteger(d.generations))throw new Error('Cell count and divisions must be whole numbers.');
  if(!['none','doxo','cisplatin','custom'].includes(raw.drug))throw new Error('Unknown stress condition.');
  d.drug=raw.drug;d.treatment=String(raw.treatment??'').slice(0,300);
  for(const r of Object.keys(ROUTES))for(const k of GATE_KEYS){
    const g=raw.gates?.[r]?.[k];if(!g)throw new Error('Missing gate '+k+'.');
    let value=finite(g.value,0,1,k),span=finite(g.span,0,4,'uncertainty span');
    if(legacy&&k==='retain'){value=value**(1/horizon);span/=horizon;}
    d.gates[r][k]={value,span,locked:g.locked===true,respond:legacy?g.locked!==true:g.respond!==false,source:['assumed','measured','literature','derived'].includes(g.source)?g.source:'assumed',citation:str(g.citation,200),note:str(g.note,500)};
  }
  for(const p of Object.keys(d.profiles))for(const k of Object.keys(d.profiles[p])){let v=finite(raw.profiles?.[p]?.[k],0,1000,'stress modifier');if(legacy&&k==='retain')v=v**(1/horizon);d.profiles[p][k]=v;}
  d.poly={...d.poly,enabled:raw.poly?.enabled===true,fraction:finite(raw.poly?.fraction,0,1,'polyploid fraction'),establish:finite(raw.poly?.establish,0,1000,'polyploid establishment'),retain:finite(raw.poly?.retain,0,1000,'polyploid retention')};
  if(legacy)d.poly.retain**=1/horizon;
  d.selection={enabled:raw.selection?.enabled===true,modified:finite(raw.selection?.modified,0,1,'modified-cell survival'),unmodified:finite(raw.selection?.unmodified,0,1,'unmodified-cell survival'),growth:finite(raw.selection?.growth,0,1000,'relative expansion')};
  if(legacy){d.dynamics.enabled=false;d.function={expression:1,efflux:1};d.migration='Imported v0.1: horizon retention converted to per-division retention. Previous locks retain modifiers-off behavior. Functional rescue is 1 to preserve the old selection assumption; review it before analysis.';}
  else{
    for(const k of ['expression','efflux'])d.function[k]=finite(raw.function?.[k],0,1,k);
    d.dynamics.enabled=raw.dynamics?.enabled===true;
    for(const[k,min,max]of[['donorGrowth',-5,5],['koGrowth',-5,5],['functionalGrowth',-5,5],['divisionHours',1,1000],['donorSurvival',0,1],['koSurvival',0,1],['functionalSurvival',0,1],['start',0,8760],['end',0,8760],['evLag',0,1000]])d.dynamics[k]=finite(raw.dynamics?.[k],min,max,k);
    for(const[k,min,max]of[['growthDelta',-5,5],['survival',0,1000],['expression',0,1000]])d.poly[k]=finite(raw.poly?.[k],min,max,k);
    for(const k of ['koAllele','recipientMarker','donorMarker','target'])d.experiment[k]=str(raw.experiment?.[k]);
    for(const k of ['protein','rna','transientDNA','adaptation','carryover','fusion','background'])d.observation[k]=finite(raw.observation?.[k],0,1,k);
    if(!['phenotype','donorDNA','inheritance','junction'].includes(raw.observation?.endpoint))throw new Error('Unknown observation endpoint.');d.observation.endpoint=raw.observation.endpoint;
    d.calibration={enabled:raw.calibration?.enabled===true,q:finite(raw.calibration?.q,0,1,'combined probability'),priorMin:finite(raw.calibration?.priorMin,Number.MIN_VALUE,1,'prior minimum'),priorMax:finite(raw.calibration?.priorMax,Number.MIN_VALUE,1,'prior maximum'),label:str(raw.calibration?.label),demo:raw.calibration?.demo===true};
    if(d.calibration.priorMin>=d.calibration.priorMax)throw new Error('Prior minimum must be below maximum.');
    d.observations=Array.isArray(raw.observations)?raw.observations.slice(0,200).map(validateObservation):[];
    d.migration=str(raw.migration,500);
  }
  // Imported snapshots are data-only summaries; nested executable or scenario fields are discarded.
  d.snapshots=Array.isArray(raw.snapshots)?raw.snapshots.slice(-8).filter(x=>x&&typeof x==='object'&&typeof x.name==='string'&&Number.isFinite(x.founders)&&x.founders>=0&&Number.isFinite(x.any)&&x.any>=0&&x.any<=1&&Number.isFinite(x.fraction)&&x.fraction>=0&&x.fraction<=1).map(x=>({name:x.name.slice(0,80),route:String(x.route??'').slice(0,50),founders:x.founders,any:x.any,fraction:x.fraction,populationEmpty:x.populationEmpty===true})):[];
  return d;
}
export function validateObservation(x){
 if(!x||typeof x!=='object')throw new Error('Invalid observation row.');
 const num=(k,min,max)=>{const v=x[k];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('Invalid observation '+k);return v;};
 const positive=num('positive',0,1e9),total=num('total',1,1e9);
 if(!Number.isInteger(positive)||!Number.isInteger(total)||positive>total)throw new Error('Positive count must be an integer no greater than total.');
 if(!Object.hasOwn(ROUTES,x.route)||!['none','doxo','cisplatin','custom'].includes(x.condition)||!['phenotype','donorDNA','inheritance','junction'].includes(x.endpoint)||!['lineage','survivors','cells','replicates'].includes(x.unit))throw new Error('Invalid observation category.');
 return{id:String(x.id??Date.now()).slice(0,80),condition:x.condition,route:x.route,hours:num('hours',0,8760),divisions:num('divisions',0,1000),positive,total,endpoint:x.endpoint,unit:x.unit,replicate:String(x.replicate??'').slice(0,100),note:String(x.note??'').slice(0,500),recipient:x.recipient===true,donor:x.donor===true,inherited:x.inherited===true,junction:x.junction===true,demo:x.demo===true};
}
