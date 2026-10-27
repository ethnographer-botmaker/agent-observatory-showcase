// Pure adapters: source records remain unchanged; no model-based interpretations.
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_EVENTS = 10000;
export const GITHUB_LIMITS = [
  'Public records do not establish who read a comment or why a change was made.',
  'Comment bodies are current snapshots; commit author dates can precede public exposure.',
  'Account type does not establish AI identity or autonomous agency.'
];
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function validateTrace(input) {
  if (!isObject(input) || !Array.isArray(input.events) || !input.events.length)
    throw new Error('Expected a JSON object containing a nonempty events array.');
  if (input.events.length > MAX_EVENTS) throw new Error('This viewer supports at most 10,000 events.');
  const ids = new Set(); let last = 0;
  for (const e of input.events) {
    if (!isObject(e)) throw new Error('Each event must be an object.');
    for (const k of ['event_id', 'actor_id', 'event_type'])
      if (typeof e[k] !== 'string' || !e[k].trim() || e[k].length > 500) throw new Error(`Each event needs a nonempty ${k} (up to 500 characters).`);
    if (ids.has(e.event_id)) throw new Error(`Duplicate event ID: ${e.event_id}`);
    if (!Number.isSafeInteger(e.sequence_id) || e.sequence_id <= last) throw new Error('sequence_id must be positive integers in strictly increasing order.');
    ids.add(e.event_id); last = e.sequence_id;
    for (const k of ['parent_event_ids','explicit_mentions','files_changed']) {
      if (e[k] !== undefined && !Array.isArray(e[k])) throw new Error(`${k} must be an array.`);
    }
    for (const k of ['parent_event_ids','explicit_mentions'])
      if (e[k]?.some(v => typeof v !== 'string')) throw new Error(`${k} must contain strings.`);
    if (e.files_changed?.some(f => !isObject(f) || typeof f.filename !== 'string')) throw new Error('files_changed entries need a filename.');
  }
  if (input.metadata !== undefined && !isObject(input.metadata)) throw new Error('metadata must be an object.');
  return input;
}
export function parseTrace(text, name = '') {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('File exceeds the 10 MB limit.');
  text = text.replace(/^\uFEFF/, '');
  let data;
  if (name.toLowerCase().endsWith('.jsonl')) {
    data = {run_id: name, metadata: {setting: 'uploaded_event_stream'}, events: text.split(/\r?\n/).filter(x => x.trim()).map((line, i) => {
      try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${i + 1}.`); }
    })};
  } else { try { data = JSON.parse(text); } catch { throw new Error('Could not parse JSON. Use an Observatory reconstruction or a .jsonl event stream.'); } }
  return validateTrace(data);
}
export const settingOf = data => data.schema_version === 'github_public_trace_v1' ? 'github' : data.metadata?.provider ? 'instrumented' : 'uploaded';
export const eventText = e => typeof e.output === 'string' ? e.output : e.output != null ? JSON.stringify(e.output) : String(e.task || e.tool_name || e.event_type);
export const artifactNames = e => [...new Set([...(typeof e.artifact_id === 'string' ? [e.artifact_id] : []), ...(typeof e.file_path === 'string' ? [e.file_path] : []), ...(e.files_changed || []).map(f => f.filename)])];
export const isArtifact = e => ['FILE_CREATED','FILE_UPDATED','FILE_READ','COMMIT_AUTHORED'].includes(e.event_type);
export const isInteraction = e => ['MESSAGE_SENT','MESSAGE_DELIVERED','MESSAGE_READ','ISSUE_COMMENT_POSTED','REVIEW_COMMENT_POSTED','REVIEW_SUBMITTED'].includes(e.event_type) || (e.event_type === 'PR_TIMELINE_EVENT' && e.github_event === 'review_requested');
export function directedTies(events, setting) {
  const ties = [];
  const add = (from, to, kind, e, related) => { if (typeof from === 'string' && typeof to === 'string' && from && to && from !== to) ties.push({from, to, kind, event_id:e.event_id, related_event_id:related || null}); };
  if (setting !== 'github') {
    const sent = new Map();
    for (const e of events) {
      if (e.event_type === 'MESSAGE_SENT' && typeof e.message_id === 'string') sent.set(e.message_id, e);
      if (e.event_type === 'MESSAGE_READ') {
        const s = sent.get(e.message_id);
        if (s && s.recipient_id === e.actor_id && (!e.sender_id || e.sender_id === s.actor_id)) add(s.actor_id, e.actor_id, 'recorded read', e, s.event_id);
      }
    }
  } else {
    const known = new Set(events.map(e=>e.actor_id));
    const comments = new Map(events.filter(e=>e.event_type==='REVIEW_COMMENT_POSTED').map(e=>[String(e.source_id), e]));
    for (const e of events) {
      const parent = comments.get(String(e.in_reply_to_source_id));
      if (parent) add(e.actor_id, parent.actor_id, 'explicit reply', e, parent.event_id);
      if (['ISSUE_COMMENT_POSTED','REVIEW_COMMENT_POSTED'].includes(e.event_type)) for (const handle of new Set(e.explicit_mentions || [])) {
        // Match the retained demo: handle tokens can also be Markdown file paths.
        const who = known.has(handle+'[bot]') ? handle+'[bot]' : handle;
        if (known.has(who)) add(e.actor_id, who, 'explicit mention', e);
      }
      if (e.event_type === 'PR_TIMELINE_EVENT' && e.github_event === 'review_requested' && known.has(e.details?.requested_reviewer)) add(e.actor_id, e.details?.requested_reviewer, 'review request', e);
    }
  }
  return ties;
}
export function selectEvents(data, {lens='interaction', actor='', query='', cutoff=data.events.length}={}) {
  query=query.toLocaleLowerCase();
  return data.events.slice(0,cutoff).filter(e => (!actor || e.actor_id===actor) && (lens==='all' || (lens==='artifact'?isArtifact(e):isInteraction(e))) && (!query || [e.event_id,e.actor_id,e.event_type,eventText(e),...artifactNames(e)].join(' ').toLocaleLowerCase().includes(query)));
}
export function safeSource(value) {
  try { const u = new URL(value); return u.protocol==='https:' && u.hostname==='github.com' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function parseGitHub(value) {
  let s=value.trim(); if (!s.includes('://')) s='https://'+(s.startsWith('github.com/') ? s : 'github.com/'+s);
  let u; try {u=new URL(s);} catch {throw new Error('Enter owner/repository or a GitHub repository / pull-request URL.');}
  const match=u.pathname.replace(/\/$/,'').match(/^\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+)(?:\/pull\/([1-9]\d*))?$/);
  if(u.protocol!=='https:' || u.hostname!=='github.com' || u.port || u.username || u.password || u.search || !match || ['.','..'].includes(match[2])) throw new Error('Use a public github.com repository or pull-request URL.');
  return {repo:match[1]+'/'+match[2], pr:match[3]?Number(match[3]):null};
}
const mentions = text => [...new Set((String(text || '').match(/(?<![\w@])@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?![\w-])/g)||[]).map(s=>s.slice(1)))];
export function githubTrace(repo, number, raw, warnings=[], captured=new Date().toISOString()) {
  const pr=raw.pull_request; const events=[]; const url=`https://github.com/${repo}/pull/${number}`;
  function add(type, item, time, text, extra={}) {
    const who=item.user || item.actor || item.author || {};
    events.push({event_type:type,timestamp:time || null,actor_id:who.login || 'unattributed',github_account_type:who.type || null,source_id:String(item.id || item.sha || number),source_url:item.html_url || url,artifact_id:`github:${repo}:pull:${number}`,output:text || '',explicit_mentions:mentions(text),...extra});
  }
  add('PR_OPENED',pr,pr.created_at,pr.title,{source_id:String(number),body_snapshot:pr.body || '',note:'Title and body are current API snapshots.'});
  for(const c of raw.commits) {const detail=raw.commit_details[c.sha];add('COMMIT_AUTHORED',c,c.commit?.author?.date,c.commit?.message,{actor_id:c.author?.login || c.commit?.author?.name || 'unattributed',commit_sha:c.sha,files_changed:(detail?.files || []).map(f=>({filename:f.filename,status:f.status,additions:f.additions,deletions:f.deletions,patch:f.patch || '',source_url:f.blob_url})),commit_detail_available:!!detail,timestamp_note:'Author time is not necessarily public push time.'});}
  for(const c of raw.issue_comments) add('ISSUE_COMMENT_POSTED',c,c.created_at,c.body,{updated_at:c.updated_at});
  for(const c of raw.review_comments) add('REVIEW_COMMENT_POSTED',c,c.created_at,c.body,{updated_at:c.updated_at,file_path:c.path,diff_hunk:c.diff_hunk,review_id:c.pull_request_review_id,in_reply_to_source_id:c.in_reply_to_id?String(c.in_reply_to_id):null});
  for(const r of raw.reviews) if(r.submitted_at) add('REVIEW_SUBMITTED',r,r.submitted_at,r.body,{review_state:r.state,review_commit_id:r.commit_id});
  for(const t of raw.timeline_events) if(t.created_at) add('PR_TIMELINE_EVENT',t,t.created_at,t.event,{github_event:t.event,details:{requested_reviewer:t.requested_reviewer?.login || null,assignee:t.assignee?.login || null,commit_id:t.commit_id || null}});
  events.sort((a,b)=>String(a.timestamp || '9999').localeCompare(String(b.timestamp || '9999')) || a.event_type.localeCompare(b.event_type) || a.source_id.localeCompare(b.source_id));
  events.forEach((e,i)=>{e.event_id=`G${i+1}`;e.sequence_id=i+1;e.parent_event_ids=[];});
  const comments=new Map(events.filter(e=>e.event_type==='REVIEW_COMMENT_POSTED').map(e=>[e.source_id,e]));
  for(const e of events) {const p=comments.get(e.in_reply_to_source_id);if(p){e.parent_event_ids=[p.event_id];e.reply_to_actor_id=p.actor_id;}}
  return validateTrace({schema_version:'github_public_trace_v1',run_id:`github_${repo.replace('/','_')}_pr_${number}`,metadata:{setting:'naturally_occurring_github_public_pull_request',source_repository:repo,source_pr_number:number,source_url:url,captured_at_utc:captured,collection_mode:'bounded_browser_public_snapshot',observation_limits:GITHUB_LIMITS,collection_warnings:warnings,collection_bounds:{per_endpoint:100,commit_details:10},commit_file_diffs_included:Object.keys(raw.commit_details).length>0},result:{pr_state_snapshot:pr.state,merged_at:pr.merged_at || null},events,raw_api:raw});
}
// GET only. No credentials, remote code, tokens, uploads, or persistent browser storage.
export function createGitHubClient(fetcher=fetch, progress=()=>{}) {
  const cache=new Map();
  async function get(path) {
    if(!/^\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\//.test(path)) throw new Error('Invalid GitHub API path.');
    if(cache.has(path)) return structuredClone(cache.get(path));
    progress('Reading public GitHub records…');
    const response=await fetcher('https://api.github.com'+path,{headers:{Accept:'application/vnd.github+json'},credentials:'omit',signal:AbortSignal.timeout(20000)});
    if(!response.ok) {
      if(response.status===403 || response.status===429) {const reset=Number(response.headers.get('x-ratelimit-reset'));throw new Error('GitHub rate limit or access restriction. '+(reset?'Try again after '+new Date(reset*1000).toLocaleTimeString()+'. ':'')+'You can still use the bundled cases or upload a trace.');}
      if(response.status===404) throw new Error('Public repository or pull request not found. Check the URL; private repositories are not supported.');
      throw new Error(`GitHub returned HTTP ${response.status}. Please retry later.`);
    }
    const reader=response.body?.getReader(); let text;
    if(reader) {let bytes=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw new Error('This GitHub response exceeds the 10 MB limit. Choose a smaller pull request.');}chunks.push(value);}const all=new Uint8Array(bytes);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}text=new TextDecoder().decode(all);} else text=await response.text();
    if(new TextEncoder().encode(text).length>MAX_BYTES) throw new Error('GitHub response exceeds the 10 MB limit.');
    const result={data:JSON.parse(text),more: /rel="next"/.test(response.headers.get('link') || '')};
    if(cache.size>=30) cache.delete(cache.keys().next().value);
    cache.set(path,result);return structuredClone(result);
  }
  async function list(repo) {const r=await get(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=20`);if(!Array.isArray(r.data))throw new Error('Unexpected GitHub response.');return r.data;}
  async function importPR(repo,number) {
    const root=`/repos/${repo}`, warnings=[];
    const raw={pull_request:(await get(`${root}/pulls/${number}`)).data,commit_details:{}};
    if(raw.pull_request.base?.repo?.private) throw new Error('Only public pull requests can be imported.');
    const endpoints={issue_comments:`issues/${number}/comments`,review_comments:`pulls/${number}/comments`,reviews:`pulls/${number}/reviews`,commits:`pulls/${number}/commits`,timeline_events:`issues/${number}/events`,changed_files_snapshot:`pulls/${number}/files`};
    for(const [key,path] of Object.entries(endpoints)) {
      const r=await get(`${root}/${path}?per_page=100`);
      if(!Array.isArray(r.data))throw new Error(`Unexpected GitHub collection: ${key}`);
      raw[key]=r.data;if(r.more) warnings.push(`${key}: first 100 items only; additional pages were not collected.`);
    }
    if(raw.commits.length>10)warnings.push(`Commit details: first 10 of ${raw.commits.length} collected commits; later commit patches are missing.`);
    for(const c of raw.commits.slice(0,10)) {
      if(!/^[a-f0-9]{40,64}$/i.test(c.sha)) throw new Error('GitHub returned an invalid commit identifier.');
      try {const r=await get(`${root}/commits/${c.sha}`);raw.commit_details[c.sha]=r.data;if(r.more)warnings.push(`Commit ${c.sha.slice(0,7)}: additional file pages were not collected.`);} catch(err) {warnings.push('Commit details incomplete: '+err.message);break;}
    }
    if(raw.changed_files_snapshot.some(f=>!f.patch))warnings.push('Some changed-file patches are unavailable (for example binary or large files).');
    if(Object.values(raw.commit_details).some(c=>(c.files || []).some(f=>!f.patch)))warnings.push('Some per-commit patches are unavailable.');
    const data=githubTrace(repo,number,raw,warnings);
    if(new TextEncoder().encode(JSON.stringify(data)).length>MAX_BYTES)throw new Error('Combined trace exceeds 10 MB. Choose a smaller pull request.');
    return data;
  }
  return {list,importPR};
}
