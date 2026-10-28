import {VERSION,GATE_KEYS,ROUTES,defaultState,calculate,effectiveGates,rangeFor,sample,sensitivity,validateState} from './model.mjs';
import {PAPERS,DRUGS} from './evidence.mjs';
import {mountAdvanced} from './advanced.mjs';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ICONS={
 sliders:'<path d="M4 6h16M4 12h16M4 18h16"/><path d="M9 3v6m7 0v6m-9 0v6"/>',
 book:'<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
 diagram:'<rect x="8" y="3" width="8" height="5" rx="1"/><rect x="2" y="16" width="7" height="5" rx="1"/><rect x="15" y="16" width="7" height="5" rx="1"/><path d="M12 8v4H5v4m7-4h7v4"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
 flask:'<path d="M9 3h6m-5 0v7L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M7 15h10"/>',
 upload:'<path d="M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5"/>',
 download:'<path d="M12 3v13m-4-4 4 4 4-4M4 17v4h16v-4"/>',
 reset:'<path d="M4 9a8 8 0 1 1 1 9M4 3v6h6"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
 unlock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2m-3.5 10v2"/>',
 spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
 cells:'<ellipse cx="8" cy="12" rx="5" ry="8"/><ellipse cx="16" cy="12" rx="5" ry="8"/><path d="M8 10v4m8-4v4"/>',
 branch:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10c0 6-12 0-12 6"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>'
};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]??ICONS.info}</svg>`;
function fillIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
const STORAGE='hgt-workbench-v01';
let advanced=null;
let state=defaultState(), activeView='workbench', calculation=null, simulation=null, updateTimer, toastTimer, storageAvailable=true;
try{const stored=localStorage.getItem(STORAGE);if(stored)state=validateState(JSON.parse(stored));}catch{storageAvailable=false;}

function number(v,digits=2){
 if(!Number.isFinite(v))return '—';
 if(v===0)return '0';
 if(v>=1e6 || v<.001)return v.toExponential(digits).replace('e+','e');
 return new Intl.NumberFormat('en',{maximumFractionDigits:v<.1?4:v<1?3:digits}).format(v);
}
function prob(v){
 if(v===0)return '0%';
 if(v===1)return '100%';
 const p=v*100;
 return p<.001?`${number(p,1)}%`:`${new Intl.NumberFormat('en',{maximumFractionDigits:p<1?3:2}).format(p)}%`;
}
const inputNumber=v=>Number(v.toPrecision(5)).toString();
const names=()=>({cargo:ROUTES[state.route].cargo,uptake:'Recipient internalization',escape:'Cargo escape',access:ROUTES[state.route].access,establish:ROUTES[state.route].establish,retain:ROUTES[state.route].retain});
function save(){
 try{localStorage.setItem(STORAGE,JSON.stringify(state));storageAvailable=true;}catch{storageAvailable=false;}
 $('#save-status').textContent=storageAvailable?'Changes saved in this browser':'Use Export to preserve this scenario';
}
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3600);}
function setView(view){
 activeView=['workbench','evidence','notes','observations'].includes(view)?view:'workbench';
 $$('.view').forEach(e=>e.hidden=e.id!==`view-${activeView}`);
 $$('.nav-button').forEach(e=>e.classList.toggle('active',e.dataset.view===activeView));
 $('#breadcrumb').textContent={workbench:'Workbench',evidence:'Evidence library',notes:'How the model works',observations:'My observations'}[activeView];
 if(activeView==='evidence')renderEvidence();
 history.replaceState(null,'',`#${activeView}`);
 window.scrollTo({top:0,behavior:'instant'});
}
function paperLinks(ids){return `<div class="source-links">${ids.map(id=>{const p=PAPERS.find(x=>x.id===id);return `<button class="text-button" data-paper="${id}">${esc(p.author)} ${p.year} ↗</button>`;}).join('')}</div>`;}

function renderGates(){
 const n=names();
 $('#gate-list').innerHTML=GATE_KEYS.map((k,i)=>{
 const g=state.gates[state.route][k],unused=state.calibration.enabled&&k!=='retain',disabled=g.locked||unused;
 const spans=[...new Set([0,.05,.1,.2,.5,1,2,3,4,g.span])].sort((a,b)=>a-b);
 return `<article class="gate ${unused?'unused-gate':''}" data-gate="${k}"><div class="gate-top"><div class="gate-name"><span class="gate-num">${String(i+1).padStart(2,'0')}</span><strong>${n[k]}</strong><button class="icon-button" data-help="${k}" aria-label="Help with ${n[k]}">${icon('help')}</button></div><label class="sr-only" for="value-${k}">${n[k]} probability, 0 to 1</label><input id="value-${k}" class="gate-value-input" type="number" min="0" max="1" step="any" data-prob="${k}" value="${g.value}" ${disabled?'disabled':''}></div><div class="gate-controls"><label class="sr-only" for="slider-${k}">${n[k]} logarithmic slider</label><input id="slider-${k}" class="gate-range" type="range" min="0" max="1200" step="1" data-slider="${k}" ${disabled?'disabled':''}><label class="sr-only" for="span-${k}">${n[k]} uncertainty range in orders of magnitude</label><select id="span-${k}" class="gate-span" data-span="${k}" ${disabled?'disabled':''}>${spans.map(v=>`<option value="${v}">${v===0?'Exact':`± ${number(v,2)}`}</option>`).join('')}</select><button class="lock-button" data-lock="${k}" aria-pressed="${g.locked}" aria-label="${g.locked?'Unlock':'Lock'} ${n[k]} baseline" title="Fix baseline value and uncertainty; modifiers are controlled separately">${icon(g.locked?'lock':'unlock')}</button></div><div class="gate-meta"><span class="gate-effective"></span><label class="response-label"><input type="checkbox" data-respond="${k}" ${g.respond!==false?'checked':''}> Allow modifiers</label></div><details class="gate-provenance"><summary>Provenance · ${esc(g.source)}${unused?' · gate value inactive':''}</summary><div><label>Parameter status<select data-gate-source="${k}">${['assumed','measured','literature','derived'].map(v=>`<option ${g.source===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Source / DOI / dataset<input data-gate-citation="${k}" value="${esc(g.citation)}" maxlength="200" placeholder="A matching numerical source, if available"></label><label>Denominator, conditions & limitations<input data-gate-note="${k}" value="${esc(g.note)}" maxlength="500" placeholder="e.g. positives / EVs; cell line; exposure time"></label></div></details></article>`;
 }).join('');
 syncGates();
}
function syncGates(){
 const eff=effectiveGates(state),n=names();
 GATE_KEYS.forEach((k,i)=>{
  const g=state.gates[state.route][k],v=$(`#value-${k}`),slider=$(`#slider-${k}`),span=$(`#span-${k}`);
  if(document.activeElement!==v)v.value=inputNumber(g.value);
  if(document.activeElement!==slider)slider.value=g.value>0?Math.round((Math.log10(g.value)+12)*100):0;
  slider.style.setProperty('--progress',`${Number(slider.value)/12}%`);
  slider.setAttribute('aria-valuetext',`${prob(g.value)} probability`);
  span.value=g.span;
  $(`[data-gate="${k}"] .gate-provenance summary`).textContent=`Provenance · ${g.source}${state.calibration.enabled&&k!=='retain'?' · gate value inactive':''}`;
  const [lo,hi]=rangeFor(g);
  $(`[data-gate="${k}"] .gate-effective`).textContent=state.calibration.enabled&&k!=='retain'?'Replaced by the combined rate':k==='retain'?`${prob(g.value)} / division · ${prob(eff[i])} over ${state.generations} divisions`:`Current ${prob(eff[i])}${g.locked?' · baseline fixed':` · range ${number(lo,1)}–${number(hi,1)}`}`;
 });
 const all=GATE_KEYS.every(k=>state.gates[state.route][k].locked);
 $('#lock-all').innerHTML=`${icon(all?'unlock':'lock')}<span>${all?'Unlock all':'Lock all'}</span>`;
 const defaults=ROUTES[state.route];
 $('#route-caption').textContent=state.route==='rna'?'Engineered LINE-1 evidence informs the route. Ordinary ABCB1 mRNA is not assumed to be retrotransposition-competent.':state.route==='episome'?'Counts inherited extrachromosomal DNA. It does not count a chromosomal insertion. EV establishment parameters remain uncalibrated.':'Counts an inherited donor sequence integrated into a recipient chromosome; expression is a separate outcome.';
 $('#poly-establish-label').textContent=state.route==='dna'?'Relative integration':'Relative establishment';
}
function renderModifiers(){
 const labels={encounters:'EV encounter supply',cargo:'Intact target cargo',uptake:'Internalization',escape:'Cargo escape',access:state.route==='rna'?'Machinery access':'Nuclear access',establish:state.route==='dna'?'Integration':'Establishment',retain:'Retention'};
 const profile=state.profiles[state.drug];
 $('#modifier-list').innerHTML=Object.entries(labels).map(([k,label])=>{
 const locked=k!=='encounters'&&state.gates[state.route][k].respond===false;
 return `<div class="modifier-row ${locked?'locked':''}"><label for="modifier-${k}">${label}${locked?' · fixed':''}</label><div class="unit-input"><input id="modifier-${k}" data-modifier="${k}" type="number" min="0" max="1000" step="any" value="${profile[k]}" ${locked?'disabled':''}><span>×</span></div></div>`;
 }).join('');
}
function syncControls(){
 for(const k of ['recipients','ratio','hours','rate','generations'])$$(`[data-context="${k}"]`).forEach(el=>{if(document.activeElement!==el)el.value=state[k];});
 $('#route').value=state.route;
 $$('#route option').forEach(el=>el.selected=el.value===state.route);
 $$('[data-drug]').forEach(el=>el.setAttribute('aria-pressed',el.dataset.drug===state.drug));
 const d=DRUGS[state.drug];
 $('#stress-guidance').innerHTML=`<h3>${d.title}</h3><p>${d.text}</p>${paperLinks(d.papers)}`;
 $('#stress-editors').hidden=state.drug==='none';
 if(document.activeElement!==$('#treatment'))$('#treatment').value=state.treatment;
 $('#poly-enabled').checked=state.poly.enabled;
 $('#poly-controls').hidden=!state.poly.enabled;
 for(const k of ['fraction','establish','retain']){const el=$(`#poly-${k}`);if(document.activeElement!==el)el.value=state.poly[k];el.disabled=k!=='fraction'&&state.gates[state.route][k].respond===false;}
 $('#selection-enabled').checked=state.selection.enabled;
 $('#selection-controls').hidden=!state.selection.enabled;
 for(const k of ['modified','unmodified','growth']){const el=$(`#selection-${k}`);if(document.activeElement!==el)el.value=state.selection[k];}
 if(document.activeElement!==$('#assay'))$('#assay').value=state.assay;
}
function renderFunnel(result){
 const n=names(),labels=result.aggregate?['EV–cell encounters','Combined productive acquisition',`Retention over ${state.generations} divisions`]:['EV–cell encounters',...GATE_KEYS.map(k=>n[k])];
 const stages=result.aggregate?[1,result.productiveQ,result.productiveQ*state.gates[state.route].retain.value**state.generations]:result.stages;
 $('#funnel').innerHTML=stages.map((p,i)=>{
  const count=p*1e6,width=count>0?Math.max(0,Math.min(100,(Math.log10(count)+6)/12*100)):0;
  return `<div class="funnel-row"><span class="funnel-label">${labels[i]}${i===6?`<small>Through ${state.generations} divisions</small>`:''}</span><div class="funnel-track"><div class="funnel-bar" style="width:${width}%"></div></div><span class="funnel-number">${number(count,2)}</span></div>`;
 }).join('');
}
function renderResults(result){
 $('#result-founders').textContent=number(result.founders,2);
 $('#result-any').textContent=prob(result.any);
 $('#result-detected').textContent=prob(result.detected);
 const n=names(), base=effectiveGates(state);
 const idx=base.reduce((best,v,i)=>v<base[best]?i:best,0);
 $('#biggest-loss').textContent=result.aggregate?'Combined rate active: individual acquisition gates are not identified':`Largest condition-gate loss: ${n[GATE_KEYS[idx]].toLowerCase()}`;
 $('#condition-label').textContent=`${DRUGS[state.drug].name}${state.poly.enabled?' + polyploid mix':''} · ${state.route==='rna'?'RNA':'DNA'}`;
 $('#encounter-caption').textContent=`Current exposure: ${number(result.m)} effective encounters / recipient. ${state.drug==='none'?'Reference multipliers are neutral.':'The orange marker includes your encounter-supply multiplier.'}`;
 renderFunnel(result);renderDoseChart(result);renderComparisons(result);
}
function renderRanges(){
 const s=simulation.summary;
 $('#founder-range').textContent=`Assumed range ${number(s.founders[0])}–${number(s.founders[2])}`;
 $('#any-range').textContent=`Assumed range ${prob(s.any[0])}–${prob(s.any[2])}`;
 $('#detected-range').textContent=`Assumed range ${prob(s.detected[0])}–${prob(s.detected[2])}`;
}
function renderDoseChart(result){
 const W=560,H=238,L=48,R=18,T=16,B=43,w=W-L-R,h=H-T-B;
 const m=result.m>0?result.m:1;
 const low=Math.floor(Math.log10(m))-3,high=Math.ceil(Math.log10(m))+3;
 const x=v=>L+(Math.log10(v)-low)/(high-low)*w;
 const y=v=>T+(1-v)*h;
 const line=(reference)=>Array.from({length:60},(_,i)=>{
  const dose=10**(low+(high-low)*i/59),r=calculate(state,{reference,encounters:dose});
  return `${i?'L':'M'}${x(dose).toFixed(2)},${y(r.any).toFixed(2)}`;
 }).join(' ');
 let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chance of at least one surviving heritable founder as effective EV encounters per recipient increase, comparing current and reference conditions."><defs><linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#df986e" stop-opacity=".14"/><stop offset="1" stop-color="#df986e" stop-opacity=".015"/></linearGradient></defs>`;
 for(const tick of [0,.25,.5,.75,1])svg+=`<line x1="${L}" y1="${y(tick)}" x2="${W-R}" y2="${y(tick)}" stroke="#e9eddf" stroke-width="1"/><text x="${L-10}" y="${y(tick)+3}" text-anchor="end" fill="#94a28b" font-size="9">${tick*100}%</text>`;
 for(let e=low;e<=high;e++)if((e-low)%Math.max(1,Math.ceil((high-low)/6))===0)svg+=`<text x="${x(10**e)}" y="${H-B+17}" text-anchor="middle" fill="#94a28b" font-size="9">${e===0?'1':e===1?'10':`10<tspan dy="-4" font-size="7">${e}</tspan>`}</text>`;
 const current=line(false),reference=line(true);
 svg+=`<path d="${current} L${W-R},${T+h} L${L},${T+h}Z" fill="url(#curve-fill)"/><path d="${reference}" stroke="#7c9eb8" stroke-width="1.7" stroke-dasharray="5 4" fill="none"/><path d="${current}" stroke="#d48359" stroke-width="2.4" fill="none"/>`;
 if(result.m>0){const xx=x(result.m),yy=y(result.any);svg+=`<line x1="${xx}" y1="${T}" x2="${xx}" y2="${T+h}" stroke="#d8b694" stroke-dasharray="2 4"/><circle cx="${xx}" cy="${yy}" r="4" fill="#d48359" stroke="#fffefa" stroke-width="2"/><text x="${xx+7}" y="${Math.max(T+11,yy-8)}" fill="#b88059" font-size="9">Current</text>`;}
 svg+=`<text x="${L+w/2}" y="${H-5}" text-anchor="middle" fill="#9aa58c" font-size="8">Effective EV encounters per recipient · log scale</text></svg>`;
 $('#dose-chart').innerHTML=svg;
}
function renderSensitivity(){
 const rows=sensitivity(state),n=names(),max=Math.max(1,...rows.map(r=>r.orders));
 $('#sensitivity').innerHTML=rows.map(r=>`<div class="sensitivity-row" title="${esc(n[r.key])}: ${number(r.lo)} to ${number(r.hi)} expected surviving founders"><span class="sensitivity-label">${n[r.key]}</span><div class="sensitivity-track"><div class="sensitivity-bar" style="width:${r.orders/max*100}%"></div></div><span class="sensitivity-number">${r.unused?'Unused':r.locked?'Fixed':r.orders<.005?'0':`${number(r.orders,1)} log`}</span></div>`).join('');
}
function renderComparisons(r){
 const row=(p,current=false,i=-1)=>`<tr class="${current?'current-row':''}"><td>${esc(p.name)}<small>${esc(p.route)}</small></td><td>${number(p.founders)}</td><td>${prob(p.any)}</td><td>${p.populationEmpty?'—':prob(p.fraction)}</td><td>${current?'':`<button class="icon-button" data-remove="${i}" aria-label="Remove ${esc(p.name)} comparison">${icon('close')}</button>`}</td></tr>`;
 $('#comparisons').innerHTML=row({name:'Current scenario',route:ROUTES[state.route].short,...r},true)+state.snapshots.map((p,i)=>row(p,false,i)).join('')+(state.snapshots.length?'':'<tr class="comparison-empty"><td colspan="5">Save a comparison, change a parameter, and see the difference here.</td></tr>');
}
function renderEvidence(){
 const q=$('#evidence-search').value.toLowerCase(),tag=$('#evidence-filter').value;
 const papers=PAPERS.filter(p=>(tag==='All processes'||p.tag===tag)&&[p.title,p.author,p.supports,p.limit,p.system].join(' ').toLowerCase().includes(q));
 $('#evidence-list').innerHTML=papers.map(p=>`<article class="panel paper" id="paper-${p.id}"><div class="paper-meta"><span>${p.journal} · ${p.year}</span><span class="pill subtle">${esc(p.tag)}</span></div><h2>${p.title}</h2><div class="paper-authors">${p.author}</div><div class="paper-section"><strong>Supports this mechanism</strong>${p.supports}</div><div class="paper-section limit"><strong>Boundary of the evidence</strong>${p.limit}</div><div class="paper-system">SYSTEM · ${p.system}</div><a class="paper-link" href="https://doi.org/${p.doi}" target="_blank" rel="noopener noreferrer">Read the paper <span>↗</span></a></article>`).join('')||'<div class="panel muted">No papers match this search.</div>';
}
function openPaper(id){
 $('#help-dialog').close();$('#evidence-search').value='';$('#evidence-filter').value='All processes';
 setView('evidence');
 const el=$(`#paper-${id}`);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('highlight');setTimeout(()=>el.classList.remove('highlight'),2000);}
}
function showHelp(key){
 const n=names(),g=state.gates[state.route][key],e=calculate(state);
 const data={
  culture:{title:'Define one culture and one window',text:'The donor is Pgp WT SW620 and the recipient is Pgp KO SW620. Static mode uses a fixed encounter rate at a 1:1 ratio. The time model instead integrates changing donor supply, recipient opportunities, stress survival, and event-time retention. Starting recipient lineages are the units for founder probabilities.',extra:'The last gate is now per-division retention. Changing post-exposure divisions changes the calculation. Donor and recipient markers are recorded separately from Pgp expression.',papers:[]},
  pathway:{title:'Choose the inheritance endpoint',text:'Chromosomal integration, inherited extrachromosomal DNA, and RNA-mediated LINE-1 insertion are modeled separately. Switching pathway keeps a separate set of gate values. The RNA pathway is relevant to competent LINE-1 cargo, not automatically to ordinary mRNA.',extra:'Direct cell-contact transfer and apoptotic-body transfer are alternative mechanisms, outside this EV-only calculation.',papers:['kawamura2019','maurais2026']},
  cargo:{title:n.cargo,text:state.route==='rna'?'The fraction of encountered EVs with an intact, competent LINE-1 RNA intermediate suitable for the selected route. Ordinary ABCB1 mRNA is not assumed competent.':'The fraction of encountered EVs associated with the intact donor DNA required for your endpoint. A short marker, a coding sequence, and an entire functional genomic locus are different cargo requirements.',extra:'DNA inside EVs, attached to their surface, and co-isolated non-vesicular DNA require different interpretation. Total DNA mass and nuclease-protected DNA mass are not direct per-EV cargo probabilities.',papers:state.route==='rna'?['kawamura2019']:['lazaro2019','jeppesen2019']},
  uptake:{title:n.uptake,text:'Probability of internalization, conditional on encountering relevant cargo. Surface binding, dye transfer, and the fraction of cells that become fluorescent do not directly measure a per-EV uptake probability.',extra:'Keep the denominator explicit. The encounter rate already accounts for effective EV supply; do not count the same loss again in uptake.',papers:['joshi2020']},
  escape:{title:n.escape,text:'Probability that relevant internalized cargo becomes productively accessible beyond the uptake compartment. Uptake alone can leave material trapped in endosomes or destined for degradation.',extra:'The EV delivery pathway may vary. This gate is a coarse-grained probability, not a claim that every cargo follows one membrane-escape mechanism.',papers:['joshi2020']},
  access:{title:n.access,text:state.route==='rna'?'Probability that escaped LINE-1 RNA is in a productive, competent molecular context for reverse transcription and insertion. Nuclear access and molecular competence are folded into this coarse-grained gate.':'Probability that escaped donor DNA gains productive access to the recipient nucleus. Recipient cell cycle and DNA integrity may matter, but are not independently parameterized here.',extra:'No SW620-specific numerical probability is assigned from the literature in this version.',papers:state.route==='rna'?['kawamura2019']:['fischer2016','lee2016']},
  establish:{title:n.establish,text:state.route==='dna'?'Probability of a physical chromosomal insertion, conditional on prior gates. Donor–recipient junction evidence distinguishes integration from donor-sequence detection.':state.route==='episome'?'Probability that delivered DNA becomes an extrachromosomal element capable of being maintained. This is a separate endpoint from chromosomal integration.':'Probability of coupled reverse transcription and insertion, conditional on productive LINE-1 machinery access. These molecular steps are not treated as independent events.',extra:'DNA damage, repair activity, or a drug-resistance phenotype does not directly measure this probability. Stress multipliers here are explicit hypotheses.',papers:state.route==='rna'?['kawamura2019']:state.route==='episome'?['maurais2026']:['fischer2016','lee2016']},
  retain:{title:n.retain,text:`The per-division probability r of retaining the sequence. Static retention is r raised to ${state.generations} divisions. The time model also accounts for divisions between acquisition and the end of exposure, followed by these post-exposure divisions.`,extra:'Detection immediately after exposure can include non-inherited material. Expression and selection are separate processes. The survival layer accounts for lineage death and should not be counted again in this retention gate.',papers:['lee2016','maurais2026']},
  founders:{title:'Count founders before counting descendants',text:'The result is an expected number of independent recipient lineages that acquire and retain donor material and survive selection. One founder may have many descendants; relative expansion changes their later fraction without creating additional founders.',extra:'A fractional expectation is not a fractional cell. For example, an expectation below one describes rare outcomes across repeat experiments. The adjacent probability estimates how often at least one surviving founder would occur.',papers:[]},
  exposure:{title:'An effective encounter model',text:`This scenario has ${number(e.m)} effective EV encounters per recipient. The x-axis varies that encounter number directly. The reference curve turns off stress modifiers, the polyploid mixture, and selection while keeping the same baseline gates and recipient count.`,extra:'The shaded area is decorative under-curve fill, not an uncertainty band. The displayed assumed ranges are calculated separately from 400 draws of active gate probabilities.',papers:[]},
  uncertainty:{title:'A sensitivity envelope, not a fitted probability',text:'Each unlocked active gate is drawn from a bounded log-uniform distribution over its selected ± orders of magnitude. Baseline locks and Exact remove sampling; Allow modifiers independently controls drug and ploidy responses. The 10th–90th percentiles summarize assumed ranges, not experimental confidence.',extra:'The bar chart changes one gate at a time and reports the log10 fold change in expected surviving founders. Equal relative changes often have equal influence. Gate distributions are assumed independent; stress magnitudes, survival, and culture context are held fixed.',papers:[]}
 };
 data.function={title:'Genetic, expressed, and functional are separate',text:'An inherited donor sequence can remain silent or fail to restore Pgp. Expression given retention and functional Pgp given expression are separate conditional probabilities. Only the functional class receives functional-rescue survival and expansion.',extra:'These are assumed biological probabilities, not assay sensitivities. Protein/RNA transfer, fusion, carryover, and adaptation are explored as alternative observations without the modeled EV genetic acquisition.',papers:['bebawy2009','lee2016']};
 const d=data[key]??data.pathway;
 $('#help-content').innerHTML=`<h2>${d.title}</h2>${g?`<div class="help-value">Baseline probability ${number(g.value)} · ${g.locked?'locked':`assumed ±${g.span} orders`}</div>`:''}<p>${d.text}</p><p>${d.extra}</p>${paperLinks(d.papers)}`;
 $('#help-dialog').showModal();
}
function queueUpdate(){
 calculation=calculate(state,{trace:true});syncGates();syncControls();renderResults(calculation);advanced?.render(calculation);save();
 clearTimeout(updateTimer);
 updateTimer=setTimeout(()=>{simulation=sample(state);renderRanges();renderSensitivity();},240);
}
function fullRender(){renderGates();renderModifiers();syncControls();queueUpdate();}
function checkedNumber(el){return el.value.trim()!=='' && el.validity.valid && Number.isFinite(Number(el.value))?Number(el.value):null;}
function processInput(el){
 if(el.id==='treatment'){state.treatment=el.value;save();return;}
 if(el.id==='evidence-search'){renderEvidence();return;}
 const v=checkedNumber(el);if(v===null)return;
 if(el.dataset.prob){state.gates[state.route][el.dataset.prob].value=v;}
 else if(el.dataset.slider){state.gates[state.route][el.dataset.slider].value=10**(v/100-12);}
 else if(el.dataset.context){state[el.dataset.context]=v;}
 else if(el.dataset.modifier){state.profiles[state.drug][el.dataset.modifier]=v;}
 else if(el.id==='assay')state.assay=v;
 else if(el.id.startsWith('poly-'))state.poly[el.id.slice(5)]=v;
 else if(el.id.startsWith('selection-'))state.selection[el.id.slice(10)]=v;
 else return;
 queueUpdate();
}
document.addEventListener('input',e=>{if(e.target.matches('input:not([type=file]):not([type=checkbox])'))processInput(e.target);});
document.addEventListener('change',e=>{
 const el=e.target;
 if(el.id==='route'){state.route=el.value;fullRender();return;}
 if(el.dataset.span){state.gates[state.route][el.dataset.span].span=Number(el.value);queueUpdate();return;}
 if(el.id==='evidence-filter'){renderEvidence();return;}
 if(el.id==='poly-enabled'){state.poly.enabled=el.checked;queueUpdate();return;}
 if(el.id==='selection-enabled'){state.selection.enabled=el.checked;queueUpdate();return;}
 if(el.matches('input[type=number]')&&checkedNumber(el)===null){toast('Enter a finite number within the displayed limits.');fullRender();}
});
document.addEventListener('click',e=>{
 const el=e.target.closest('button');if(!el)return;
 if(el.dataset.view){setView(el.dataset.view);return;}
 if(el.dataset.openView){setView(el.dataset.openView);return;}
 if(el.dataset.help){showHelp(el.dataset.help);return;}
 if(el.dataset.paper){openPaper(el.dataset.paper);return;}
 if(el.dataset.drug){state.drug=el.dataset.drug;renderModifiers();queueUpdate();return;}
 if(el.dataset.lock){const g=state.gates[state.route][el.dataset.lock];g.locked=!g.locked;renderGates();renderModifiers();queueUpdate();return;}
 if(el.dataset.remove!==undefined){state.snapshots.splice(Number(el.dataset.remove),1);queueUpdate();return;}
});
$('#lock-all').addEventListener('click',()=>{const lock=!GATE_KEYS.every(k=>state.gates[state.route][k].locked);GATE_KEYS.forEach(k=>state.gates[state.route][k].locked=lock);renderGates();renderModifiers();queueUpdate();toast(lock?'Baseline values and uncertainty fixed; modifier responses are independent.':'Baseline values unlocked.');});
$('#reset').title='Reset unlocked gate values and ranges for the current pathway; keep culture and stress settings.';
$('#reset').addEventListener('click',()=>{const d=defaultState();GATE_KEYS.forEach(k=>{if(!state.gates[state.route][k].locked)state.gates[state.route][k]={...d.gates[state.route][k],respond:state.gates[state.route][k].respond};});fullRender();toast('Unlocked gates reset. Culture and stress settings kept.');});
$('#illustrate').addEventListener('click',()=>{
 const p=state.profiles[state.drug];p.encounters=3;
 if(state.gates[state.route].establish.respond!==false)p.establish=2;
 state.selection={enabled:true,modified:.8,unmodified:.2,growth:1};
 renderModifiers();queueUpdate();toast(`Demonstration assumptions: 3× encounters, ${state.gates[state.route].establish.respond===false?'establishment response off':'2× establishment'}, and differential survival.`);
});
$('#pin').addEventListener('click',()=>{
 const r=calculate(state),now=new Date();
 state.snapshots.push({name:`${DRUGS[state.drug].name}${state.poly.enabled?' + polyploid mix':''} · ${now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`,route:ROUTES[state.route].short,founders:r.founders,any:r.any,fraction:r.fraction,populationEmpty:r.populationEmpty});
 state.snapshots=state.snapshots.slice(-8);queueUpdate();toast('Comparison saved in this browser. Export preserves full settings.');
});
$('#close-help').addEventListener('click',()=>$('#help-dialog').close());
$('#help-dialog').addEventListener('click',e=>{const d=e.currentTarget,b=d.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)d.close();});
$('#export-button').addEventListener('click',()=>{
 const body={title:'HGT Workbench scenario',modelVersion:VERSION,exportedAt:new Date().toISOString(),parameterStatus:'All starter probabilities and effect sizes are assumptions, not fitted SW620 estimates.',state,calculated:calculate(state),evidence:PAPERS.map(p=>({id:p.id,doi:p.doi}))};
 const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'})),a=document.createElement('a');
 a.href=url;a.download=`hgt-sw620-${state.drug}-${state.route}-scenario.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Full scenario exported, including locks, ranges, and evidence links.');
});
$('#import-button').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async e=>{
 const f=e.target.files[0];if(!f)return;
 try{if(f.size>1000000)throw new Error('Choose a scenario JSON file smaller than 1 MB.');const raw=JSON.parse(await f.text());state=validateState(raw.state??raw);fullRender();toast('Scenario imported and recalculated.');}
 catch(err){toast(`Import could not be completed: ${err.message}`);}finally{e.target.value='';}
});

// Keep culture settings reachable on small screens without duplicating element IDs.
const mobile=document.createElement('details');mobile.className='mobile-culture';mobile.style.display='none';
mobile.innerHTML='<summary>Culture context · Pgp WT → Pgp KO SW620</summary><div>'+['recipients','ratio','hours','rate','generations'].map(k=>{
 const original=$(`[data-context="${k}"]`),label=original.closest('label').cloneNode(true),input=label.querySelector('input');input.id=`mobile-${k}`;return label.outerHTML;
}).join('')+'</div>';
$('.app-shell').prepend(mobile);
advanced=mountAdvanced({getState:()=>state,onChange:(rebuild=false)=>rebuild?fullRender():queueUpdate(),toast,icon,esc,number,prob});
fillIcons();fullRender();
const requested=location.hash.slice(1);if(requested)setView(requested);
window.addEventListener('hashchange',()=>setView(location.hash.slice(1)));
// A small, read-only interface for reproducible local QA of scientific calculations.
window.HGTWorkbench=Object.freeze({getState:()=>structuredClone(state),getResult:()=>calculate(state),version:VERSION});
