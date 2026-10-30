import {eventText, artifactNames, directedTies, safeSource, validateTrace} from './core.mjs';
const n=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const moments={
 clearance:[['E1','Task assignment','Four agents receive a task with distributed constraints.'],['E55','Constraint request','A1 sends a coordination request.'],['E69','Availability message','A2 communicates its scientific-review window.'],['E111','Message read','A1 reads the message containing A2’s constraint.'],['E139','Plan · version 1','A1 creates clearance_plan.'],['E144','Plan · version 2','A2 replaces the timetable, moving scientific review outside its stated availability.'],['E149','Plan · version 3','A3 writes the same timetable values as version 1.'],['E154','Plan · version 4','A4 moves publication to 14:00–14:30.'],['E159','Submitted answer','The answer specifies publication at 14:30–15:00; the latest shared plan specifies 14:00–14:30.']],
 wled:[['G3','Pull request opened','The pull request concerns rules for AI-assisted contributions. Its body is a retrospective snapshot.'],['G41','Review comment','A human reviewer questions whether guidance is duplicated.'],['G54','Wording request','The human response specifies how the disclosure wording should change and links to an earlier review comment.'],['G56','Automated reply','CodeRabbit replies in the same review thread.'],['G59','Section-order request','A human comment requests moving the contribution section to the top.'],['G70','Document revision','The commit moves the contribution section.'],['G72','Review request','The comment explicitly addresses CodeRabbit and requests readability and clarity checks.'],['G74','Automated response','CodeRabbit acknowledges the request. This retained body was edited later and reports the review as finished.'],['G76','Review finding','The automated review flags ambiguous wording in the agent boundary and proposes a revision.'],['G79','Document revision','A human-authored commit revises headings and wording.'],['G81','Pull request merged','The pull request is merged.']]
};
async function mount(key){
 const root=document.getElementById(key+'-replay');
 try{
 const response=await fetch('data/'+key+'.json');if(!response.ok)throw Error('Unable to load retained records');
 const trace=validateTrace(await response.json()),events=trace.events,guide=moments[key];
 for(const [id] of guide)if(!events.some(e=>e.event_id===id))throw Error('Guided source record missing: '+id);
 let index=events.findIndex(e=>e.event_id===guide[0][0]);
 root.replaceChildren();
 const controls=n('div',undefined,'replay-controls'),prev=n('button','Previous'),next=n('button','Next'),mode=n('select'),modeLabel=n('label','Browse ');
 mode.add(new Option('Selected events','guided'));mode.add(new Option('All events','all'));mode.id=key+'-mode';modeLabel.htmlFor=mode.id;modeLabel.append(mode);controls.append(prev,next,modeLabel);
 const position=n('p',undefined,'eyebrow');position.setAttribute('role','status');
 const range=n('input');range.type='range';range.min=0;range.max=events.length-1;range.setAttribute('aria-label','Replay position for '+key);
 const chapters=n('label','Go to '),jump=n('select');jump.setAttribute('aria-label','Selected event for '+key);jump.add(new Option('Select an event',''));chapters.append(jump);controls.append(chapters);
 const columns=n('div',undefined,'replay-columns'),record=n('article',undefined,'replay-record'),artifacts=n('aside',undefined,'replay-artifacts');columns.append(record,artifacts);
 root.append(controls,position,range,columns);
 for(const [id,title] of guide)jump.add(new Option(id+' · '+title,id));jump.onchange=()=>{if(jump.value){index=events.findIndex(e=>e.event_id===jump.value);render();}};
 function target(direction){if(mode.value==='all')return Math.max(0,Math.min(events.length-1,index+direction));const choices=guide.map(([id])=>events.findIndex(e=>e.event_id===id));return direction>0?(choices.find(i=>i>index)??index):([...choices].reverse().find(i=>i<index)??index);}
 function step(direction){index=target(direction);render();}
 prev.onclick=()=>step(-1);next.onclick=()=>step(1);
 mode.onchange=render;range.oninput=()=>{index=Number(range.value);render();};
 function details(label,text){const d=n('details');d.append(n('summary',label),n('pre',text));return d;}
 function render(){
 const e=events[index],reached=events.slice(0,index+1),moment=guide.find(m=>m[0]===e.event_id);
 position.textContent=`${e.event_id} · Record ${index+1} of ${events.length} · ${e.timestamp || 'Time unavailable'}`;range.value=index;prev.disabled=target(-1)===index;next.disabled=target(1)===index;
 jump.value=moment?e.event_id:'';
 record.replaceChildren(n('p',`${e.actor_id} · ${e.event_type.replaceAll('_',' ').toLowerCase()}`,'eyebrow'),n('h3',moment?.[1]||'Recorded activity'));
 if(moment)record.append(n('p',moment[2]));
 if(e.github_account_type)record.append(n('p','Recorded account type: '+e.github_account_type));
 record.append(n('pre',eventText(e)||e.task||'No text body retained.','event-body'));
 if(e.updated_at&&e.updated_at!==e.timestamp)record.append(n('p','Retained body last updated: '+e.updated_at+'. It may contain text added after the event’s creation.','boundary'));
 if(e.body_snapshot)record.append(details('Retained pull-request body',e.body_snapshot));
 const ties=directedTies(reached,key==='wled'?'github':'instrumented').filter(t=>t.event_id===e.event_id);
 if(ties.length){record.append(n('h4','Recorded relationships'));for(const t of ties)record.append(n('p',`${t.from} → ${t.to} · ${t.kind}`));}
 const linked=new Set([...(e.parent_event_ids||[]),...ties.map(t=>t.related_event_id).filter(Boolean)]);
 for(const id of linked){const i=events.findIndex(v=>v.event_id===id);if(i<0)continue;const b=n('button','Inspect linked record '+id);b.onclick=()=>{index=i;render();};record.append(b);}
 const url=safeSource(e.source_url);if(url){const a=n('a','Open original GitHub record ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';record.append(a);}
 record.append(details('Complete source event',JSON.stringify(e,null,2)));
 artifacts.replaceChildren(n('h3',key==='clearance'?'Shared plan at this moment':'Artifact revisions reached'));
 if(key==='clearance'){
 const writes=reached.filter(v=>['FILE_CREATED','FILE_UPDATED'].includes(v.event_type)&&artifactNames(v).includes('clearance_plan'));
 if(!writes.length)artifacts.append(n('p','No shared clearance_plan write has been reached yet.'));
 else{const latest=writes.at(-1);artifacts.append(n('p',`${writes.length} shared version(s) · latest ${latest.event_id} by ${latest.actor_id}`),n('pre',latest.output));if(writes.length>1)artifacts.append(details('Compare with preceding version · '+writes.at(-2).event_id,writes.at(-2).output));}
 }else{
 const commits=reached.filter(v=>v.event_type==='COMMIT_AUTHORED');artifacts.append(n('p',`${commits.length} authored commit(s) reached. Patches show changes, not complete file contents.`));
 if(!commits.length)artifacts.append(n('p','No authored commit reached.'));
 for(const c of commits.slice().reverse()){const d=n('details');if(c===commits.at(-1))d.open=true;d.append(n('summary',`${c.event_id} · ${c.actor_id} · ${String(c.output).split('\n')[0]}`));for(const f of c.files_changed||[])d.append(n('h4',f.filename),n('pre',f.patch||'Patch not retained.'));if(!c.files_changed?.length)d.append(n('p','No file patches retained for this commit.'));artifacts.append(d);}
 }
 }
 render();
 }catch(error){root.replaceChildren(n('p',error.message+'. Reload to retry.','error'));}
}
await Promise.all(['clearance','wled'].map(mount));

