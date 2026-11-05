const out=document.getElementById('out'),pw=document.getElementById('pw');
const tm=i=>i?new Date(i).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'never';
async function call(path,method){
  if(pw.value.length<12){out.textContent='Type the admin password first.';return null}
  document.querySelectorAll('button').forEach(b=>b.disabled=true);out.textContent='Working...';
  try{const r=await fetch('/api/dmz-patches/admin/'+path,{method,headers:{authorization:'Bearer '+pw.value.trim()}});const d=await r.json().catch(()=>({}));
    if(r.status===429){out.textContent='Too many wrong passwords from this connection. Wait 15 minutes, then try again.';return}if(r.status===403){out.textContent='Wrong password, or the ADMIN_TOKEN secret has not been set in Cloudflare yet.';return null}
    if(r.status===503){out.textContent='The patch notes store (KV) has not been connected yet. Follow step 2 of PATCH-NOTES-SETUP.md.';return null}
    if(r.status===429){out.textContent=d.error||'Please wait a few minutes.';return null}
    return d}catch(e){out.textContent='Could not reach the site.';return null}
  finally{document.querySelectorAll('button').forEach(b=>b.disabled=false)}
}
document.getElementById('check').onclick=async()=>{
  const d=await call('refresh','POST');if(!d)return;
  if(d.skipped){out.textContent=d.skipped;return}
  const L=[d.ok?'Check finished.':'Check finished with a problem: '+(d.error||'unknown'),'Time: '+tm(d.at),''];
  if(d.baseline)L.push('This was the FIRST check. It recorded the existing notes as the starting point, so nothing is marked NEW.','');
  for(const [id,s] of Object.entries(d.sources||{}))L.push((s.ok?'OK     ':'FAILED ')+id+(s.docs_read?' ('+s.docs_read+' pages read)':'')+(s.cards_dmz!=null?' ('+s.cards_dmz+' DMZ cards)':'')+(s.error?' - '+s.error:'')+((s.problems&&s.problems.length)?' - '+s.problems.join(' | '):''));
  L.push('','New: '+d.added+'   Updated: '+d.updated+'   Removed: '+d.removed+'   Held for review: '+d.held+'   Not DMZ (left out): '+d.excluded,'Entries on the site now: '+(d.entries??'?'));
  out.textContent=L.join('\n');
};
document.getElementById('review').onclick=async()=>{
  const d=await call('review','GET');if(!d)return;const a=d.items||[];
  out.textContent=a.length?a.map((x,i)=>(i+1)+'. ['+(x.path||[]).join(' > ')+'] '+x.text+'\n   '+x.reason).join('\n\n'):'Nothing is being held. Every item was either clearly DMZ (published) or clearly not (left out).';
};
document.getElementById('diag').onclick=async()=>{
  const d=await call('diagnostics','GET');if(!d)return;const m=d.meta;
  if(!m){out.textContent='No check has run yet. Press "Check now".';return}
  const L=['Last successful check: '+tm(m.last_success),'Last attempt: '+tm(m.last_attempt),'Checks run: '+m.runs,'Starting point recorded: '+(m.baseline_done?tm(m.baseline_at):'no'),''];
  for(const [id,s] of Object.entries(m.sources||{}))L.push((s.ok?'OK     ':'FAILED ')+s.name+' - last good '+tm(s.last_ok)+(s.last_error?' - '+s.last_error:''));
  if((m.errors||[]).length){L.push('','Recent problems:');m.errors.slice(0,8).forEach(e=>L.push('  '+tm(e.at)+' ['+e.source+'] '+e.message))}
  out.textContent=L.join('\n');
};
