import {MAX_BYTES,parseTrace,validateTrace,settingOf,eventText,artifactNames,isArtifact,directedTies,selectEvents,safeSource,parseGitHub,createGitHubClient,GITHUB_LIMITS} from './core.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let data=null, setting='', selected=null, busy=false, listedRepo='', shown=100;
const state={lens:'interaction',actor:'',query:'',cutoff:1};
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
const github=createGitHubClient(fetch,m=>status(m));
async function task(action){if(busy)return;busy=true;for(const b of document.querySelectorAll('#sources button, #sources input'))b.disabled=true;
  try{await action();}catch(err){status(err.name==='TimeoutError'?'GitHub took too long to respond. Try again or use a saved trace.':err.message,true);}finally{busy=false;for(const b of document.querySelectorAll('#sources button, #sources input'))b.disabled=false;}}
function load(trace,label){data=validateTrace(trace);setting=settingOf(data);selected=null;shown=100;Object.assign(state,{lens:'interaction',actor:'',query:'',cutoff:data.events.length});
  $('case-title').textContent=label || String(data.run_id || 'Uploaded trace');
  $('setting').textContent=setting==='github'?'PUBLIC GITHUB · RETROSPECTIVE SNAPSHOT':setting==='instrumented'?'INSTRUMENTED EXPERIMENT · RETAINED TRACE':'UPLOADED TRACE · USER-SUPPLIED RECORDS';
  const captured=data.metadata?.captured_at_utc;
  $('case-subtitle').textContent=String(data.run_id || 'Unnamed trace')+(captured?' · captured '+captured:'');
  const notes=setting==='github'?[...GITHUB_LIMITS,...(Array.isArray(data.metadata?.collection_warnings)?data.metadata.collection_warnings:[])]:['Directed ties require matching sent/read records. Recorded exposure does not establish understanding or causal influence.','This browser validates structure; it does not verify the original audit manifest or hash chain.'];
  if (typeof data.metadata?.note==='string') notes.unshift(data.metadata.note);
  $('boundary').textContent='OBSERVATION BOUNDARY  ·  '+notes.join(' ');
  $('actor').replaceChildren(new Option('All actors',''));for(const actor of [...new Set(data.events.map(e=>e.actor_id))].sort())$('actor').add(new Option(actor,actor));
  $('search').value='';$('cutoff').max=data.events.length;$('cutoff').value=data.events.length;$('export').disabled=false;render();
  status(`Loaded ${data.events.length} events. Select a lens, narrow the window, and inspect the evidence.`);
}
function visible(){return data?selectEvents(data,state):[];}
function inspect(id){selected=id;renderList();renderDetail();}
function eventButton(id,label){const b=el('button',label || id);b.type='button';b.addEventListener('click',()=>inspect(id));return b;}
function render(){if(!data)return;const events=visible(), window=data.events.slice(0,state.cutoff);shown=Math.max(100,shown);
  for(const b of document.querySelectorAll('[data-lens]'))b.setAttribute('aria-pressed',String(b.dataset.lens===state.lens));
  $('cutoff').value=state.cutoff;$('window-label').textContent=`${state.cutoff} / ${data.events.length}`;
  const ties=directedTies(window,setting);const filteredIDs=new Set(events.map(e=>e.event_id));const activeTies=ties.filter(t=>filteredIDs.has(t.event_id));
  const metrics=[[events.length,'Matching events'],[new Set(events.map(e=>e.actor_id)).size,'Actors in matching events'],[activeTies.length,setting==='github'?'Explicit directed ties':'Matched message reads'],[events.filter(e=>['FILE_CREATED','FILE_UPDATED','COMMIT_AUTHORED'].includes(e.event_type)).length,'Recorded artifact changes']];
  $('metrics').replaceChildren(...metrics.map(([n,label])=>{const box=el('div',undefined,'metric');box.append(el('strong',n),el('span',label));return box;}));
  $('lens-note').textContent=state.lens==='interaction'?(setting==='github'?'Explicit public interactions. Replies, mentions, and review requests identify directed actions; receipt is unknown.':'Message events and matched reads. A sent message alone does not establish that it was read.'):state.lens==='artifact'?'Recorded artifact activity. GitHub patches are partial changes, not complete file versions. Read events are distinguished from writes.':'All retained event types, including model I/O when present. Hidden model reasoning is not observed.';
  renderOverview(events,activeTies);renderList();renderDetail();
}
function renderOverview(events,ties){const root=$('overview');root.replaceChildren();
  if(state.lens==='artifact'){
    root.append(el('h3','Artifact trajectories · select a source event'));
    const groups=new Map();for(const e of events){const names=e.files_changed?.length?e.files_changed.map(f=>f.filename):artifactNames(e);for(const name of names){if(!groups.has(name))groups.set(name,[]);groups.get(name).push(e);}}
    if(!groups.size)root.append(el('p','No artifact activity matches these filters.'));
    let count=0;for(const [name,es] of groups){if(count++>=100){root.append(el('p','First 100 artifact groups shown. Narrow the filters to explore more.'));break;}const row=el('div',undefined,'artifact-row');row.append(el('strong',name));for(const e of es.slice(0,100))row.append(eventButton(e.event_id,`${e.event_id} · ${e.actor_id} · ${e.event_type==='FILE_READ'?'read':e.artifact_version?'v'+e.artifact_version:'change'}`));if(es.length>100)row.append(el('span',`${es.length-100} more events; use the timeline.`));root.append(row);}
  }else{
    root.append(el('h3','Directed interactions · evidence-linked'));
    if(!ties.length)root.append(el('p','No supported directed ties in this view. Co-participation and temporal proximity are not treated as interaction evidence.'));
    const grouped=new Map();for(const t of ties){const key=JSON.stringify([t.from,t.to,t.kind]);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(t);}
    let count=0;for(const ts of grouped.values()){if(count++>=100){root.append(el('p','First 100 directed groups shown. Narrow the filters to explore more.'));break;}const t=ts[0],row=el('div',undefined,'tie');row.append(el('span',`${t.from} → ${t.to}`),el('span',`${t.kind} · ${ts.length}`));for(const tie of ts.slice(0,12))row.append(eventButton(tie.event_id));if(ts.length>12)row.append(el('span','Additional source events appear in the timeline.'));root.append(row);}
  }
}
function renderList(){const events=visible();$('event-count').textContent=`${events.length} matching`;$('event-list').replaceChildren();
  if(!events.length)$('event-list').append(el('p','No matching events. Try another lens or clear the filters.','empty'));
  for(const e of events.slice(0,shown)){const b=el('button',undefined,'event-row'+(isArtifact(e)?' artifact':''));b.type='button';b.setAttribute('aria-pressed',String(e.event_id===selected));const meta=el('span',undefined,'event-meta');meta.append(el('span',e.event_id),el('span',typeof e.timestamp==='string'?(Number.isNaN(Date.parse(e.timestamp))?e.timestamp:new Date(e.timestamp).toISOString().replace('T',' ').slice(0,19)+' UTC'):'Time unavailable'));const name=el('strong');name.append(el('span','','type-dot'),document.createTextNode(e.actor_id+' · '+e.event_type.replaceAll('_',' ').toLowerCase()));b.append(meta,name,el('p',eventText(e).slice(0,170)+(eventText(e).length>170?'…':'')));b.addEventListener('click',()=>inspect(e.event_id));$('event-list').append(b);}
  $('more').hidden=events.length<=shown;
}
function renderDetail(){const e=data.events.find(e=>e.event_id===selected) || visible()[0];const root=$('event-detail');root.replaceChildren();
  if(!e){$('event-id').textContent='';root.append(el('p','No event selected.'));return;}
  $('event-id').textContent=e.event_id;
  if(!visible().some(v=>v.event_id===e.event_id))root.append(el('p','Linked evidence outside the current filters.'));
  const dl=el('dl');for(const [label,value] of [['Actor',e.actor_id],['Event type',e.event_type],['Sequence',e.sequence_id],['Timestamp',e.timestamp || 'Unavailable'],['Artifact',artifactNames(e).join(', ') || '—']])dl.append(el('dt',label),el('dd',String(value)));root.append(dl);
  if(e.github_account_type)root.append(el('p','GitHub account type: '+e.github_account_type+'. This is not a finding of autonomy.'));
  if(e.updated_at && e.updated_at!==e.timestamp)root.append(el('p','Edited after creation: '+e.updated_at+'. The retained body is a snapshot.'));
  const source=safeSource(e.source_url);if(source){const a=el('a','Open original GitHub record ↗');a.href=source;a.target='_blank';a.rel='noopener noreferrer';root.append(a);}
  root.append(el('pre',eventText(e)));
  if(e.files_changed?.length){const details=el('details');details.append(el('summary','Retained commit patches'));for(const f of e.files_changed)details.append(el('h4',f.filename),el('pre',f.patch || 'Patch unavailable.'));root.append(details);}
  const linked=new Set(e.parent_event_ids || []);for(const t of directedTies(data.events,setting).filter(t=>t.event_id===e.event_id))if(t.related_event_id)linked.add(t.related_event_id);
  if(linked.size){const group=el('div',undefined,'tie');group.append(el('span','Linked evidence:'));for(const id of linked)if(data.events.some(e=>e.event_id===id))group.append(eventButton(id));root.append(group);}
  const details=el('details');details.append(el('summary','Complete source event (JSON)'),el('pre',JSON.stringify(e,null,2)));root.append(details);
}
async function bundled(name){status('Loading recorded case…');const path=name==='clearance'?'data/clearance.json':'data/wled.json';const r=await fetch(path);if(!r.ok)throw new Error('Bundled case could not be loaded. Serve the site over HTTP or open the original standalone demo.');load(await r.json(),name==='clearance'?'Four agents. One clearance plan.':'WLED · Negotiating contribution rules');}
$('case-clearance').addEventListener('click',()=>task(()=>bundled('clearance')));
$('case-wled').addEventListener('click',()=>task(()=>bundled('wled')));
$('upload').addEventListener('change',()=>task(async()=>{const file=$('upload').files[0];if(!file)return;try{if(file.size>MAX_BYTES)throw new Error('Choose a trace smaller than 10 MB.');load(parseTrace(await file.text(),file.name),file.name);}finally{$('upload').value='';}}));
$('github-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{const {repo,pr}=parseGitHub($('repo-url').value);$('pr-picker').hidden=true;if(pr){load(await github.importPR(repo,pr),repo+' · PR #'+pr);return;}const prs=await github.list(repo);listedRepo=repo;$('pr-select').replaceChildren();for(const p of prs)$('pr-select').add(new Option('#'+p.number+' · '+p.title,String(p.number)));if(!prs.length){status('No public pull requests found. Try another repository or upload a trace.');return;}$('pr-picker').hidden=false;status('Choose a pull request below the repository field. This list shows up to 20 recently updated pull requests.');});});
$('import-pr').addEventListener('click',()=>task(async()=>{const number=Number($('pr-select').value);if(!number)return;load(await github.importPR(listedRepo,number),listedRepo+' · PR #'+number);}));
for(const b of document.querySelectorAll('[data-lens]'))b.addEventListener('click',()=>{state.lens=b.dataset.lens;selected=null;shown=100;render();});
$('actor').addEventListener('change',()=>{state.actor=$('actor').value;selected=null;shown=100;render();});
let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=$('search').value;selected=null;shown=100;render();},180);});
$('cutoff').addEventListener('input',()=>{state.cutoff=Number($('cutoff').value);selected=null;shown=100;render();});
$('reset').addEventListener('click',()=>{if(!data)return;clearTimeout(searchTimer);Object.assign(state,{lens:'interaction',actor:'',query:'',cutoff:data.events.length});$('actor').value='';$('search').value='';selected=null;shown=100;render();});
$('more').addEventListener('click',()=>{shown+=100;renderList();});
$('export').addEventListener('click',()=>{if(!data)return;const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=String(data.run_id || 'trace').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
task(()=>bundled('clearance'));
