import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultState,calculate,effectiveGates,sample,validateState,validateObservation,rangeFor,GATE_KEYS} from './model.mjs';
import {observationPrediction,rowEligibility,matchedRows,fitCombined,parseObservationsCSV,observationsCSV} from './observations.mjs';
const near=(a,b,rel=1e-8)=>assert.ok(Math.abs(a-b)<=rel*Math.max(1e-300,Math.abs(b)),`${a} != ${b}`);
const staticState=()=>{const s=defaultState();s.dynamics.enabled=false;return s;};
const row=(s,extra={})=>validateObservation({id:'1',condition:s.drug,route:s.route,hours:s.hours,divisions:s.generations,positive:1,total:1000,endpoint:'inheritance',unit:'lineage',replicate:'cohort-1',recipient:true,donor:true,inherited:true,junction:false,...extra});

test('Static limits preserve rare-event arithmetic and separate expression from function',()=>{
 const s=staticState(),r=calculate(s);near(r.q,1e-9);near(r.m,200);near(r.founders,100000*(-Math.expm1(-2e-7)));
 assert.ok(r.functionalFounders<r.expressedFounders&&r.expressedFounders<r.founders);
 assert.ok(r.functionalAny<=r.any&&r.detected<r.any);
 s.function.expression=0;assert.equal(calculate(s).functionalFounders,0);assert.equal(calculate(s).expressedFounders,0);near(calculate(s).founders,r.founders);
 s.function.expression=1;s.function.efflux=1;near(calculate(s).functionalFounders,calculate(s).founders);
});
test('Baseline locks do not suppress independent stress and ploidy responses',()=>{
 const s=staticState();s.drug='doxo';s.profiles.doxo.establish=100;s.gates.dna.establish.locked=true;
 near(effectiveGates(s)[4],.1);s.gates.dna.establish.respond=false;near(effectiveGates(s)[4],.001);
 s.poly.enabled=true;s.poly.establish=20;near(effectiveGates(s,{poly:true})[4],.001);
 s.gates.dna.establish.respond=true;near(effectiveGates(s,{poly:true})[4],1);
});
test('Retention responds to division horizon, including zero and exact closure',()=>{
 const s=staticState();s.gates.dna.retain.value=.9;s.generations=2;near(effectiveGates(s)[5],.81);
 const a=calculate(s).founders;s.generations=10;assert.ok(calculate(s).founders<a);
 s.generations=0;near(effectiveGates(s)[5],1);s.gates.dna.retain.value=0;s.generations=1;assert.equal(calculate(s).founders,0);
});
test('Dynamic constant conditions agree with analytic event-time retention integral',()=>{
 const s=defaultState(),r=s.gates.dna.retain.value,T=s.hours,q=2e-9,lambda=s.rate/24;
 const loss=Math.log(r)/s.dynamics.divisionHours;
 const expectedH=lambda*q*r**s.generations*Math.expm1(loss*T)/loss;
 const out=calculate(s,{trace:true});near(out.founders,s.recipients*(-Math.expm1(-expectedH)),2e-6);
 assert.ok(out.timeSeries.length>0);near(out.m,200);
 s.gates.dna.retain.value=1;const dynamic=calculate(s);s.dynamics.enabled=false;near(dynamic.founders,calculate(s).founders);
});
test('EV lag follows an empty-pool analytic solution and stress windows apply conditionally',()=>{
 const s=defaultState();s.dynamics.evLag=12;const T=s.hours,tau=12,expected=s.rate/24*(T-tau*(1-Math.exp(-T/tau)));
 near(calculate(s).m,expected);s.dynamics.evLag=0;s.drug='doxo';s.profiles.doxo.encounters=3;s.dynamics.start=24;s.dynamics.end=48;
 near(calculate(s).m,400);s.dynamics.end=24;near(calculate(s).m,200);
 s.dynamics.start=0;s.dynamics.end=48;s.dynamics.donorSurvival=0;assert.equal(calculate(s).founders,0);
});
test('Polyploid classes are converted separately and integer class probabilities are exact',()=>{
 const s=staticState();GATE_KEYS.forEach(k=>s.gates.dna[k].value=1);s.rate=1;s.hours=24;s.poly.enabled=true;s.poly.fraction=.5;s.poly.establish=.01;
 const r=calculate(s);near(r.p,.5*(-Math.expm1(-1))+.5*(-Math.expm1(-.01)));
 near(r.any,-Math.expm1(-s.recipients*.505));
 assert.ok(Math.abs(r.p-(-Math.expm1(-.505)))>.01);
});
test('Functional survival acts only on functional acquisitions, growth never creates founders',()=>{
 const s=staticState();s.selection={enabled:true,modified:0,unmodified:1,growth:1};let r=calculate(s);
 assert.equal(r.functionalFounders,0);assert.ok(r.founders>0);
 s.selection.modified=.8;r=calculate(s);const founders=r.founders,any=r.any,fraction=r.functionalFraction;
 s.selection.growth=100;const expanded=calculate(s);near(expanded.founders,founders);near(expanded.any,any);assert.ok(expanded.functionalFraction>fraction);
});
test('No cells, no encounters, no donors, no productive gate and no detection are handled',()=>{
 for(const key of ['recipients','rate','ratio','hours']){const s=defaultState();s[key]=0;const r=calculate(s);assert.equal(r.founders,0,key);assert.equal(r.any,0,key);}
 const s=defaultState();s.gates.dna.establish.value=0;assert.equal(calculate(s).founders,0);
 s.gates.dna.establish.value=.001;s.assay=0;assert.equal(calculate(s).detected,0);
});
test('Ranges stay finite below 1e-12 and exact locks collapse sampling',()=>{
 const s=staticState();s.gates.dna.establish.value=1e-14;const[lo,hi]=rangeFor(s.gates.dna.establish);near(lo,1e-15);near(hi,1e-13);
 GATE_KEYS.forEach(k=>s.gates.dna[k].locked=true);const r=sample(s,12);near(r.summary.founders[0],r.summary.founders[2]);
 assert.deepEqual(sample(s,5),sample(s,5));s.gates.dna.establish.value=Number.MIN_VALUE;assert.ok(rangeFor(s.gates.dna.establish)[0]>0);
});
test('V0.1 scenario migration preserves horizon retention and explicit old functional assumption',()=>{
 // Build the serialized v0.1 schema without executing source from another revision.
 const s=staticState();s.version='0.1.1';delete s.function;delete s.dynamics;
 for(const route of Object.values(s.gates))for(const g of Object.values(route)){delete g.respond;delete g.source;delete g.citation;delete g.note;}
 for(const route of Object.values(s.gates))route.retain.value=.5;
 s.gates.dna.establish.locked=true;const migrated=validateState(s);
 near(effectiveGates(migrated)[5],.5);assert.equal(migrated.gates.dna.establish.respond,false);assert.equal(migrated.function.expression,1);assert.equal(migrated.dynamics.enabled,false);assert.ok(migrated.migration);
});
test('New scenario round trips, input rejects invalid numbers, and cohort CSV preserves quoted notes',()=>{
 const s=defaultState();assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
 assert.throws(()=>validateState({...s,recipients:Infinity}));assert.throws(()=>validateState({...s,route:'__proto__'}));
 const rows=[row(s,{note:'Quoted "marker", then\nsecond line'})];assert.deepEqual(parseObservationsCSV(observationsCSV(rows)),rows);
 assert.throws(()=>validateObservation({...rows[0],positive:1001,total:1000}));
});
test('Competing phenotype signals do not fabricate genetic founders or enter inheritance fitting',()=>{
 const s=staticState();s.rate=0;s.observation.protein=.4;const r=calculate(s);
 assert.equal(r.founders,0);near(observationPrediction(s,r,'phenotype').positive,.4);near(observationPrediction(s,r,'inheritance').positive,0);
 assert.ok(rowEligibility(row(s,{endpoint:'phenotype'}),s));assert.ok(rowEligibility(row(s,{unit:'survivors'}),s));
 s.observations=[row(s),row(s,{id:'2',positive:2}),row(s,{id:'3',replicate:'DEMO',demo:true})];assert.equal(matchedRows(s).used.length,1);
});
test('Conditional combined-rate posterior recovers a synthetic aggregate and labels demonstration data',()=>{
 const s=staticState(),truth=1e-5,r=calculate(s,{qOverride:truth});s.calibration.priorMin=1e-8;s.calibration.priorMax=1e-3;
 const n=40000,k=Math.round(n*observationPrediction(s,r,'inheritance').positive);
 s.observations=[row(s,{positive:k,total:n,demo:true})];const fit=fitCombined(s);
 assert.ok(fit.low<truth&&fit.high>truth);assert.ok(fit.median>truth/1.5&&fit.median<truth*1.5);assert.equal(fit.demo,true);
 s.calibration.enabled=true;s.calibration.q=truth;const baseline=calculate(s);s.gates.dna.cargo.value=0;near(calculate(s).founders,baseline.founders);
});
