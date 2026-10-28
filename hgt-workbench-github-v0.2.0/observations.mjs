import {calculate,validateObservation} from './model.mjs';
export const ENDPOINTS={phenotype:'Pgp / efflux / drug phenotype',donorDNA:'Donor DNA detected',inheritance:'Inherited donor DNA',junction:'New recipient–donor junction'};
export const EXPLANATIONS={
 protein:{label:'Transferred Pgp protein',endpoints:['phenotype'],paper:'bebawy2009'},
 rna:{label:'Transient donor RNA expression',endpoints:['phenotype'],paper:'lee2016'},
 transientDNA:{label:'Non-inherited donor DNA',endpoints:['donorDNA'],paper:'fischer2016'},
 adaptation:{label:'Recipient adaptation / other resistance',endpoints:['phenotype'],paper:'lee2016'},
 carryover:{label:'Donor-cell carryover / misclassification',endpoints:['phenotype','donorDNA','inheritance','junction']},
 fusion:{label:'Donor–recipient fusion',endpoints:['phenotype','donorDNA','inheritance'],paper:'dewhurst2014'},
 background:{label:'Other assay background',endpoints:['phenotype','donorDNA','inheritance','junction']}
};
export function observationPrediction(s,r,endpoint=s.observation.endpoint,unit='lineage'){
 let signal=endpoint==='phenotype'?(unit==='cells'?r.functionalFraction:(s.recipients?r.functionalFounders/s.recipients:0)):(unit==='cells'?r.fraction:r.survivingP);
 if(endpoint==='junction'&&s.route==='episome')signal=0;
 const contributors=Object.entries(EXPLANATIONS).map(([key,v])=>({key,...v,active:v.endpoints.includes(endpoint),p:s.observation[key]}));
 const background=1-contributors.filter(c=>c.active).reduce((p,c)=>p*(1-c.p),1);
 return {signal,background,positive:signal*s.assay+(1-signal)*background,contributors,unit};
}
export function rowEligibility(row,s){
 if(row.condition!==s.drug||row.route!==s.route||row.hours!==s.hours||row.divisions!==s.generations)return 'Different condition, pathway, time, or division horizon';
 if(row.unit!=='lineage')return 'Fit requires tracked starting lineages; survivor-only, descendant, and replicate counts need a different likelihood';
 if(row.total>s.recipients)return 'Tracked lineages exceed the starting recipient count in this culture context';
 if(!['inheritance','junction'].includes(row.endpoint))return 'A genetic inheritance endpoint is required';
 if(!row.recipient||!row.donor||!row.inherited)return 'Recipient identity, donor sequence, and inheritance must be verified';
 if(row.endpoint==='junction'&&!row.junction)return 'A new recipient–donor junction must be verified';
 if(row.endpoint==='junction'&&s.route==='episome')return 'A junction endpoint does not match extrachromosomal inheritance';
 if(!row.replicate.trim())return 'Give each independent cohort a replicate / cohort identifier';
 return '';
}
export function matchedRows(s){
 const candidates=s.observations.filter(x=>!rowEligibility(x,s)),real=candidates.filter(x=>!x.demo),selected=real.length?real:candidates;
 const seen=new Set(),used=[],duplicates=[];
 for(const r of selected){if(seen.has(r.replicate)){duplicates.push(r);continue;}seen.add(r.replicate);used.push(r);}
 return {used,duplicates,demo:used.length>0&&used.every(r=>r.demo),excluded:s.observations.length-used.length};
}
export function fitCombined(s){
 const match=matchedRows(s);if(!match.used.length)throw new Error('Add matched, verified inheritance counts from independent recipient lineages first.');
 const min=s.calibration.priorMin,max=s.calibration.priorMax;if(!(min>0&&min<max&&max<=1))throw new Error('Set a prior minimum > 0 and a larger maximum ≤ 1.');
 const points=360,grid=[],logs=[];
 for(let i=0;i<points;i++){
  const q=10**(Math.log10(min)+(Math.log10(max)-Math.log10(min))*i/(points-1)),r=calculate(s,{qOverride:q});
  if(r.limited)throw new Error('The time model exceeded its numerical envelope. Reduce the horizon or growth rates before fitting.');
  let ll=0;
  for(const row of match.used){const p=observationPrediction(s,r,row.endpoint,'lineage').positive,k=row.positive,n=row.total;
   if(p<=0){if(k>0)ll=-Infinity;}else if(p>=1){if(k<n)ll=-Infinity;}else ll+=k*Math.log(p)+(n-k)*Math.log1p(-p);
  }
  grid.push(q);logs.push(ll);
 }
 const top=Math.max(...logs);if(!Number.isFinite(top))throw new Error('These counts cannot be explained under the exposure and detection assumptions.');
 const weights=logs.map(l=>Math.exp(l-top)),sum=weights.reduce((a,b)=>a+b,0);
 const quantile=p=>{let cum=0;for(let i=0;i<weights.length;i++){cum+=weights[i]/sum;if(cum>=p)return grid[i];}return grid.at(-1);};
 const k=match.used.reduce((a,r)=>a+r.positive,0),n=match.used.reduce((a,r)=>a+r.total,0);
 return {low:quantile(.1),median:quantile(.5),high:quantile(.9),mle:grid[logs.indexOf(top)],k,n,rows:match.used.length,demo:match.demo,duplicates:match.duplicates.length,
  prior:[min,max],edge:logs.indexOf(top)===0||logs.indexOf(top)===points-1,zero:k===0,uninformative:top-Math.min(...logs.filter(Number.isFinite))<1e-6};
}
export function interpretRow(row){
 const findings=[];
 if(row.endpoint==='phenotype')findings.push('Phenotype alone leaves protein/RNA transfer, adaptation, donor carryover, fusion, and genetic acquisition compatible.');
 if(row.endpoint==='donorDNA')findings.push('Donor DNA detection leaves transient cargo, donor carryover, and fusion compatible.');
 if(!row.recipient)findings.push('Recipient lineage identity has not been verified.');
 if(!row.donor)findings.push('Donor-specific sequence evidence has not been verified.');
 if(!row.inherited)findings.push('Persistence through recipient divisions has not been verified.');
 if(row.recipient&&row.donor&&row.inherited)findings.push('These checks support inherited donor material in a recipient lineage; they do not identify an EV route by themselves.');
 if(row.endpoint==='junction'&&row.junction)findings.push('A verified new recipient–donor junction supports physical integration. Existing donor tag junctions alone do not qualify.');
 if(row.unit==='cells')findings.push('Descendant cells can share a founder; this count is not used as independent transfer opportunities.');
 if(row.demo)findings.unshift('Illustrative demonstration data, not an experimental result.');
 return findings;
}
const COLUMNS=['id','condition','route','hours','divisions','positive','total','endpoint','unit','replicate','recipient','donor','inherited','junction','demo','note'];
export function observationsCSV(rows){
 const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 return [COLUMNS.map(cell).join(','),...rows.map(r=>COLUMNS.map(k=>cell(r[k])).join(','))].join('\r\n');
}
export function parseObservationsCSV(text){
 const records=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))records.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw new Error('Unclosed quoted CSV field.');if(field||row.length){row.push(field);records.push(row);}
 if(records.length<2)throw new Error('Include a header and at least one observation.');
 const header=records.shift().map(x=>x.trim().replace(/^\uFEFF/,''));
 if(!COLUMNS.every(k=>header.includes(k)))throw new Error('Use the exported observations CSV as a template.');
 if(records.length>200)throw new Error('Import at most 200 observations.');
 return records.map(cols=>{const raw=Object.fromEntries(header.map((k,i)=>[k,cols[i]??'']));for(const k of ['hours','divisions','positive','total']){if(!String(raw[k]).trim())throw new Error('A numeric observation field is empty.');raw[k]=Number(raw[k]);}for(const k of ['recipient','donor','inherited','junction','demo'])raw[k]=String(raw[k]).toLowerCase()==='true';return validateObservation(raw);});
}
