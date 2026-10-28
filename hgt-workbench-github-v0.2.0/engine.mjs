// Exploratory marked-Poisson lineage model. No fitted biological constants.
export function calculateV2(s,{reference=false,values=null,encounters=null,qOverride=null,trace=false}={},helpers){
 const {effectiveGates,activeModifiers,cumulative,clamp}=helpers;
 const keys=['cargo','uptake','escape','access','establish'];
 const power=(p,t)=>t===0?1:p===0?0:p**t;
 const safeExp=x=>Math.exp(clamp(x,-60,60));
 const eventP=h=>h>0?-Math.expm1(-h):0;
 const np=!reference&&s.poly.enabled?Math.round(s.recipients*s.poly.fraction):0;
 const classes=[{poly:false,n:s.recipients-np},{poly:true,n:np}],d=s.dynamics;
 const steps=d.enabled?Math.min(360,Math.max(96,Math.ceil(s.hours*4))):1;
 const drug=!reference&&s.drug!=='none',start=clamp(d.start,0,s.hours),end=clamp(d.end,start,s.hours);
 const activeHours=t=>drug?Math.max(0,Math.min(t,end)-start):0;
 const productive=(poly,stressActive)=>{
  const override=qOverride??(s.calibration.enabled?s.calibration.q:null),opt={reference,values,poly,stressActive,perDivision:true};
  if(override===null)return effectiveGates(s,opt).slice(0,5).reduce((a,b)=>a*b,1);
  let q=override;const m=activeModifiers(s,reference,stressActive);
  for(const k of keys)if(s.gates[s.route][k].respond!==false)q*=m[k];
  if(poly&&!reference&&s.poly.enabled&&s.gates[s.route].establish.respond!==false)q*=s.poly.establish;
  return clamp(q);
 };
 let meanM=0,limited=false;const result=[],timeSeries=[];
 for(const c of classes){
  const opts={reference,values,poly:c.poly,perDivision:true};
  const expression=clamp(s.function.expression*(c.poly&&!reference?s.poly.expression:1)),efflux=s.function.efflux;
  const marks=[expression*efflux,expression*(1-efflux),1-expression];
  const koG=d.koGrowth+(c.poly&&!reference?s.poly.growthDelta:0),koS=clamp(d.koSurvival*(c.poly&&!reference?s.poly.survival:1));
  let H=[0,0,0],weights=[0,0,0],rawH=0,retH=0,mClass=0;
  if(!d.enabled){
   const m=encounters??s.rate*s.ratio*s.hours/24*activeModifiers(s,reference).encounters;
   const q=productive(c.poly,true),r=effectiveGates(s,{...opts,stressActive:true})[5]**s.generations;
   rawH=m*q;retH=rawH*r;H=marks.map(v=>retH*v);weights=[...H];mClass=m;
  }else if(s.hours>0){
   const dt=s.hours/steps,qOn=productive(c.poly,true),qOff=productive(c.poly,false);
   const rOn=effectiveGates(s,{...opts,stressActive:true})[5],rOff=effectiveGates(s,{...opts,stressActive:false})[5];
   let rawM=0,pool=0;const cohorts=[];
   for(let i=0;i<steps;i++){
    const t=(i+.5)*dt,a=activeHours(t),on=drug&&t>=start&&t<end;
    if(Math.abs(d.donorGrowth*t/24)>60||Math.abs(koG*t/24)>60)limited=true;
    const donorRel=s.ratio*safeExp(d.donorGrowth*t/24)*power(d.donorSurvival,a/24);
    const source=donorRel*(on?s.profiles[s.drug].encounters:1);
    let supply=source;
    if(d.evLag>0){const decay=Math.exp(-dt/d.evLag),old=pool;pool=source+(pool-source)*decay;supply=source+(old-source)*(d.evLag/dt)*(1-decay);}
    const available=safeExp(koG*t/24)*power(koS,a/24);
    const dm=s.rate/24*supply*dt,remaining=s.hours-t,remainingStress=activeHours(s.hours)-a;
    const retention=power(rOn,remainingStress/d.divisionHours)*power(rOff,s.generations+(remaining-remainingStress)/d.divisionHours);
    cohorts.push({dm,available,retention,q:on?qOn:qOff,remainingStress,remaining});rawM+=dm;
    if(trace&&!c.poly&&i%Math.max(1,Math.floor(steps/60))===0)timeSeries.push({t,donors:s.recipients*donorRel,ko:(s.recipients-np)*available,poly:np*safeExp((d.koGrowth+(!reference?s.poly.growthDelta:0))*t/24)*power(clamp(d.koSurvival*(!reference?s.poly.survival:1)),a/24)});
   }
   const factor=encounters===null?1:rawM>0?encounters/rawM:0;
   for(const x of cohorts){
    const h=x.dm*factor*x.available*x.q;rawH+=h;retH+=h*x.retention;
    for(let j=0;j<3;j++){
     const survival=power(j===0?d.functionalSurvival:koS,x.remainingStress/24),contribution=h*x.retention*marks[j]*survival;
     H[j]+=contribution;const g=j===0?d.functionalGrowth:koG;
     if(Math.abs(g*x.remaining/24)>60)limited=true;
     weights[j]+=contribution*safeExp(g*x.remaining/24);
    }
   }
   mClass=rawM*factor;
  }
  const selected=s.selection.enabled&&!reference,sm=selected?s.selection.modified:1,su=selected?s.selection.unmodified:1;
  // Functional > expressed-only > silent when a starting lineage has multiple marked events.
  const pF=eventP(H[0])*sm,pE=Math.exp(-H[0])*eventP(H[1])*su,pS=Math.exp(-H[0]-H[1])*eventP(H[2])*su;
  const p=pF+pE+pS,growth=selected?s.selection.growth:1,avg=H.map((h,i)=>h?weights[i]/h:1);
  const unmodified=c.n*Math.exp(-rawH)*su*(d.enabled?safeExp(koG*s.hours/24)*power(koS,activeHours(s.hours)/24):1);
  // Lineages with loss of all donor DNA return to the non-genetic abundance approximation.
  const lost=c.n*Math.max(0,eventP(rawH)-eventP(retH))*su*(d.enabled?safeExp(koG*s.hours/24)*power(koS,activeHours(s.hours)/24):1);
  result.push({...c,p,pF,pE,pS,expressed:pF+pE,raw:eventP(rawH),retained:eventP(retH),H,
   functionalAbundance:c.n*pF*avg[0]*growth,otherGeneticAbundance:c.n*(pE*avg[1]+pS*avg[2]),unmodifiedAbundance:unmodified+lost});
  meanM+=s.recipients?mClass*c.n/s.recipients:0;
 }
 const sum=k=>result.reduce((a,c)=>a+c.n*c[k],0);
 const any=(key,detect=1)=>{let log=0;for(const c of result){if(!c.n)continue;const p=clamp(c[key]*detect);if(p===1)return 1;log+=c.n*Math.log1p(-p);}return log===0?0:-Math.expm1(log);};
 const founders=sum('p'),functionalFounders=sum('pF'),expressedFounders=sum('expressed');
 const functionalCells=result.reduce((a,c)=>a+c.functionalAbundance,0),otherGenetic=result.reduce((a,c)=>a+c.otherGeneticAbundance,0),unmodifiedCells=result.reduce((a,c)=>a+c.unmodifiedAbundance,0),total=functionalCells+otherGenetic+unmodifiedCells;
 const f=s.recipients?np/s.recipients:0,base=effectiveGates(s,{reference,values}),poly=effectiveGates(s,{reference,values,poly:true}),cb=cumulative(base),cp=cumulative(poly);
 return {m:meanM,q:cb.at(-1),qp:cp.at(-1),f,p:s.recipients?sum('retained')/s.recipients:0,survivingP:s.recipients?founders/s.recipients:0,
  founders,functionalFounders,expressedFounders,acquiredFounders:sum('raw'),beforeSelection:sum('retained'),
  any:any('p'),functionalAny:any('pF'),detected:any('p',s.assay),detectionExpected:founders*s.assay,
  fraction:total?(functionalCells+otherGenetic)/total:0,functionalFraction:total?functionalCells/total:0,
  populationEmpty:total===0,stages:cb.map((v,i)=>(1-f)*v+f*cp[i]),base,poly,
  modifiedCells:functionalCells+otherGenetic,functionalCells,unmodifiedCells,classes:result,timeSeries,limited,
  aggregate:qOverride!==null||s.calibration.enabled,productiveQ:qOverride??(s.calibration.enabled?s.calibration.q:base.slice(0,5).reduce((a,b)=>a*b,1))};
}
