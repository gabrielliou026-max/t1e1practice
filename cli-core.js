/* 語音介接 CLI 練習器共用核心：文法樹、Tab / ? 補齊、pipe、歷史指令、dial-peer 比對與側欄元件。
   各練習器只保留自己的設備狀態、模式指令樹、show 輸出、通話模擬與任務。 */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const clone=o=>JSON.parse(JSON.stringify(o));
function ts(){
  const d=new Date(), M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const p=(n,l=2)=>String(n).padStart(l,'0');
  return `*${M} ${String(d.getDate()).padStart(2,' ')} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}:`;
}

/* ---------- grammar helpers ---------- */
const K=(k,h,c,run,o)=>Object.assign({t:'k',k,h,c:c||[],run},o||{});
const NUM=(min,max,h,c,run,o)=>Object.assign({t:'p',type:'num',min,max,label:`<${min}-${max}>`,h,c:c||[],run},o||{});
const WORD=(label,h,c,run,v,o)=>Object.assign({t:'p',type:'word',label,h,c:c||[],run,v},o||{});
const LINE=(h,run)=>({t:'p',type:'line',label:'LINE',h,c:[],run});
const kids=n=>typeof n.c==='function'?n.c():(n.c||[]);
const isIp=t=>/^\d{1,3}(\.\d{1,3}){3}$/.test(t);
const isDial=t=>/^[0-9.\[\]\-T*#+%?,]+$/i.test(t);
const sortK=l=>l.sort((a,b)=>(a.k||a.label).localeCompare(b.k||b.label));

function accepts(p,tok){
  if(p.type==='num') return /^\d+$/.test(tok)&&+tok>=p.min&&+tok<=p.max;
  if(p.type==='line') return true;
  return p.v?p.v(tok):true;
}
function matchTok(children,tok){
  const low=tok.toLowerCase();
  const kws=children.filter(n=>n.t==='k'&&n.k.toLowerCase().startsWith(low));
  const ex=kws.find(n=>n.k.toLowerCase()===low);
  if(ex) return {node:ex};
  const ps=children.filter(n=>n.t==='p'&&accepts(n,tok));
  if(kws.length===1) return {node:kws[0]};
  if(kws.length>1) return {amb:true};
  if(ps.length) return {node:ps[0]};
  return {bad:true};
}
function walk(tokens,roots){
  let children=roots,node=null; const vals=[];
  for(let i=0;i<tokens.length;i++){
    const m=matchTok(children,tokens[i]);
    if(m.amb) return {err:'amb',i};
    if(m.bad) return {err:'bad',i};
    node=m.node;
    if(node.t==='p'&&node.type==='line'){ vals.push(tokens.slice(i).join(' ')); return {node,vals,done:true}; }
    vals.push(node.t==='k'?node.k:tokens[i]);
    children=kids(node);
  }
  return {node,vals};
}
function pipeRoots(){ return [
  K('begin','Begin with the line that matches',[LINE('Regular Expression',null)]),
  K('include','Include lines that match',[LINE('Regular Expression',null)]),
  K('section','Filter a section of output',[LINE('Regular Expression',null)])
];}
function applyPipe(text,pipe){
  const [kw,...rest]=pipe.trim().split(/\s+/), pat=rest.join(' ');
  const k=['begin','include','section'].find(w=>kw&&w.startsWith(kw.toLowerCase()));
  if(!k||!pat) return '% Incomplete or invalid filter after |';
  let re; try{ re=new RegExp(pat); }catch(e){ return '% Invalid regular expression'; }
  const lines=text.split('\n');
  if(k==='include') return lines.filter(l=>re.test(l)).join('\n');
  if(k==='begin'){ const i=lines.findIndex(l=>re.test(l)); return i<0?'':lines.slice(i).join('\n'); }
  const o=[]; let on=false;
  lines.forEach(l=>{ if(!/^\s/.test(l)) on=re.test(l); if(on) o.push(l); });
  return o.join('\n');
}
function cands(children,partial){
  const low=partial.toLowerCase(), set=[];
  children.forEach(n=>{
    if(n.t==='k'&&n.k.toLowerCase().startsWith(low)) set.push(n.k);
    if(n.t==='p'&&n.sug) n.sug().forEach(s=>{ if(s.toLowerCase().startsWith(low)&&!set.includes(s)) set.push(s); });
  });
  return set;
}
function helpList(children,runnable){
  const items=children.map(n=>[n.t==='k'?n.k:n.label,n.h||'']);
  if(runnable) items.push(['<cr>','']);
  const w=Math.max(4,...items.map(i=>i[0].length));
  return items.map(([a,b])=>'  '+a.padEnd(w+2)+b).join('\n');
}

/* ---------- dial-peer matching ---------- */
function patInfo(p){
  let r='^',score=0;
  for(let i=0;i<p.length;i++){
    const ch=p[i];
    if(/[0-9*#]/.test(ch)){ r+=ch==='*'?'\\*':ch; score+=10; }
    else if(ch==='.'){ r+='\\d'; score+=1; }
    else if(ch==='['){ const j=p.indexOf(']',i); if(j<0) return null; r+=p.slice(i,j+1); score+=5; i=j; }
    else if(ch==='T'||ch==='t'){ r+='\\d*'; }
    else if(ch==='+'){ r+='+'; }
    else if(ch===','){ }
    else return null;
  }
  try{ return {re:new RegExp(r+'$'),score}; }catch(e){ return null; }
}
const operational=(cfg,d)=>!!d.dest&&(d.type==='voip'?!!d.target:(!!d.port&&!!cfg.voicePorts[d.port]));
function bestPeer(cfg,num){
  let best=null;
  for(const d of cfg.dialPeers){
    if(!operational(cfg,d)) continue;
    const pi=patInfo(d.dest); if(!pi||!pi.re.test(num)) continue;
    if(!best||pi.score>best.score) best={d,score:pi.score};
  }
  return best&&best.d;
}
const literalPrefix=d=>((d.dest||'').match(/^\d+/)||[''])[0];
function forward(d,num){
  if(d.fwd==='all') return num;
  if(d.fwd!=null) return num.slice(-Number(d.fwd)||num.length);
  return num.slice(literalPrefix(d).length);
}
function fwdDesc(d){
  if(d.fwd==='all') return 'forward-digits all，送完整號碼';
  if(d.fwd!=null) return `forward-digits ${d.fwd}，只送最後 ${d.fwd} 碼`;
  const lit=literalPrefix(d);
  return lit?`沒有設定 forward-digits，預設去掉明確比對的前置碼 ${lit}`:'沒有設定 forward-digits';
}

/* ---------- terminal ----------
   o.state()        目前的狀態物件 S（重設時會換掉，所以每次都重新取）
   o.modes          {模式: {roots, prompt}}；exec / priv / config 以外都視為子模式
   o.refresh()      每次送出指令、按 Ctrl+Z 之後呼叫
   o.fix(s)         選用，送出前整理輸入
   o.newDialPeer    選用，新建 dial-peer 的初始內容
   o.doneHint       選用，任務全部完成後按提示顯示的文字

   任務可以帶 g()，回傳分三層的提示：
     {where, a, b, c}
     where  做這一步要在哪裡：{mode, enter, at(ctx)} 是終端機的模式，{tab, name} 是右側分頁
     a      第 1 層：方向，不講指令
     b      第 2 層：要用哪個指令
     c      第 3 層：完整指令（字串或陣列）；省略時用任務的 h */
function createTerminal(o){
  const out=$('#out'), inp=$('#cmd'), screen=$('#screen');
  const st=()=>o.state();
  const fix=o.fix||(s=>s);
  const isSub=m=>!['exec','priv','config'].includes(m);
  const modeRoots=m=>o.modes[m].roots();
  const configRoots=()=>modeRoots('config');
  const privRoots=()=>modeRoots('priv');

  function print(text,cls){
    String(text).split('\n').forEach(l=>{
      const d=document.createElement('div');
      let c=cls; if(!c && /^% /.test(l)) c='err';
      if(c) d.className=c; d.textContent=l; out.appendChild(d);
    });
    while(out.childNodes.length>2500) out.removeChild(out.firstChild);
  }
  const scrollDown=()=>{ screen.scrollTop=screen.scrollHeight; };
  function flash(){ screen.classList.remove('flash'); void screen.offsetWidth; screen.classList.add('flash'); }
  const mark=()=>{ st().dirty=true; };
  function promptStr(){
    const S=st();
    if(S.pending) return S.pending.prompt;
    return S.cfg.hostname+o.modes[S.mode].prompt;
  }

  /* ---------- shared commands ---------- */
  function commonCfg(){ return [
    K('do','To run exec commands in config mode',()=>privRoots()),
    K('end','Exit from configure mode',null,()=>toPriv()),
    K('exit','Exit from current mode',null,()=>exitMode())
  ];}
  const withCommon=list=>sortK(list.concat(commonCfg(),[K('no','Negate a command or set its defaults',()=>list)]));
  function enterConfig(){ const S=st(); S.mode='config'; S.ctx=null; S.flags.conf=true; return 'Enter configuration commands, one per line.  End with CNTL/Z.'; }
  function toPriv(){ const S=st(); S.mode='priv'; S.ctx=null; return ts()+' %SYS-5-CONFIG_I: Configured from console by console'; }
  function exitMode(){ const S=st(); if(S.mode==='config') return toPriv(); S.mode='config'; S.ctx=null; }
  function logout(){ const S=st(); S.mode='exec'; S.ctx=null; return `\n${S.cfg.hostname} con0 is now available\n\nPress RETURN to get started.`; }
  function enterDP(tag,type,x){
    const S=st(), ex=S.cfg.dialPeers.find(d=>d.tag===tag);
    if(x.neg){ if(!ex) return `% Dial-peer ${tag} does not exist`; S.cfg.dialPeers=S.cfg.dialPeers.filter(d=>d.tag!==tag); mark(); return; }
    if(ex&&ex.type!==type) return `% Dial-peer ${tag} already exists as type ${ex.type}`;
    if(!ex){ S.cfg.dialPeers.push(o.newDialPeer?o.newDialPeer(tag,type):{tag,type}); mark(); }
    S.mode='dp'; S.ctx={tag};
  }
  function doSave(){ const S=st(); S.startup=clone(S.cfg); S.dirty=false; S.flags.saved=true; }
  function save(){ doSave(); return 'Building configuration...\n[OK]'; }
  function copyRun(){
    st().pending={prompt:'Destination filename [startup-config]? ',handler:a=>{
      const t=a.trim(); if(t===''||t==='startup-config'){ doSave(); print('Building configuration...\n[OK]'); }
      else print('% The simulator only supports startup-config');
    }};
  }

  /* dial-peer 子模式裡兩個練習器共用的指令。dp() 回傳目前的 dial-peer。 */
  function dialPeerNodes(dp,destExample){
    const del=k=>(v,x)=>{ delete dp()[k]; mark(); };
    const setv=(k,i,val)=>(v,x)=>{ if(x.neg) delete dp()[k]; else dp()[k]=val!==undefined?val:v[i]; mark(); };
    return {
      description:K('description','A string describing this dial-peer',[LINE('Up to 64 characters',setv('desc',1))],del('desc'),{nOnly:true}),
      destination:K('destination-pattern','A full E.164 telephone number prefix',[WORD('WORD','A dial-peer destination pattern, e.g. '+destExample,null,setv('dest',1),isDial)],del('dest'),{nOnly:true}),
      forwardDigits:K('forward-digits','Number of digits to be forwarded',[K('all','Forward all digits',null,setv('fwd',0,'all')),NUM(0,32,'Number of digits to forward',null,setv('fwd',1))],del('fwd'),{nOnly:true}),
      port:K('port','Voice port',[WORD('<slot/subunit/port>','Voice port',null,setv('port',1),t=>!!st().cfg.voicePorts[t],{sug:()=>Object.keys(st().cfg.voicePorts)})],del('port'),{nOnly:true}),
      session:K('session','Specify session parameters',[
        K('protocol','The session protocol to be used',[K('sipv2','IETF Session Initiation Protocol',null,setv('proto',0,'sipv2'))],del('proto'),{nOnly:true}),
        K('target','Specify session target',[WORD('WORD','ipv4:A.B.C.D',null,setv('target',2),t=>/^ipv4:\d{1,3}(\.\d{1,3}){3}$/.test(t))],del('target'),{nOnly:true}),
        K('transport','Set the session transport',[K('tcp','TCP transport',null,setv('transport',0,'tcp')),K('udp','UDP transport',null,setv('transport',0,'udp'))],del('transport'),{nOnly:true})
      ])
    };
  }
  function showDP(destW,empty){
    const S=st(), L=['TAG        TYPE  OPER  '+'DEST-PATTERN'.padEnd(destW)+'FWD   SESS-TARGET              PORT'];
    S.cfg.dialPeers.forEach(d=>{
      L.push(d.tag.padEnd(11)+d.type.padEnd(6)+(operational(S.cfg,d)?'up':'down').padEnd(6)+(d.dest||'').padEnd(destW)+(d.type==='pots'?(d.fwd==null?'def':d.fwd):'').padEnd(6)+(d.target||'').padEnd(25)+(d.port||''));
    });
    if(!S.cfg.dialPeers.length&&empty) L.push(empty);
    return L.join('\n');
  }

  /* ---------- input handling ---------- */
  function analyze(raw){
    const S=st(); let str=raw, roots=modeRoots(S.mode);
    const pi=str.indexOf('|'); if(pi>=0){ roots=pipeRoots(); str=str.slice(pi+1); }
    const endsSpace=str.length===0||/\s$/.test(str);
    const toks=str.trim().split(/\s+/).filter(Boolean);
    const partial=endsSpace?'':toks.pop();
    const r=walk(toks,roots);
    if(r.err) return {err:r.err,i:r.i};
    if(r.done) return {done:true,children:[],partial:'',runnable:true};
    const vals=r.vals||[];
    const neg=vals[0]==='no'||(vals[0]==='do'&&vals[1]==='no');
    const children=r.node?kids(r.node):roots;
    const runnable=r.node?(!!r.node.run&&(!r.node.nOnly||neg)):false;
    return {children,partial,runnable};
  }
  function caret(raw,idx){
    const m=[...raw.matchAll(/\S+/g)][idx];
    print(' '.repeat(promptStr().length+(m?m.index:raw.length))+'^','err');
    print("% Invalid input detected at '^' marker.");
  }
  function doHelp(){
    if(st().pending) return;
    const raw=fix(inp.value);
    print(promptStr()+raw+'?');
    const a=analyze(raw);
    if(a.err==='amb') print(`% Ambiguous command:  "${raw.trim()}"`);
    else if(a.err) caret(raw,a.i);
    else if(a.partial){ const c=cands(a.children,a.partial); print(c.length?c.join('  '):'% Unrecognized command'); }
    else if(!a.children.length&&!a.runnable) print('% Unrecognized command');
    else print(helpList(a.children,a.runnable));
    inp.value=raw; scrollDown();
  }
  function doTab(){
    if(st().pending) return;
    const raw=fix(inp.value), a=analyze(raw);
    if(a.err||a.done){ flash(); return; }
    if(!a.partial){
      if(!a.children.length){ flash(); return; }
      print(promptStr()+raw); print(helpList(a.children,a.runnable)); scrollDown(); return;
    }
    const c=cands(a.children,a.partial), base=raw.slice(0,raw.length-a.partial.length);
    if(c.length===1) inp.value=base+c[0]+' ';
    else if(c.length>1){
      let cp=c[0];
      c.forEach(x=>{ let i=0; while(i<cp.length&&i<x.length&&cp[i].toLowerCase()===x[i].toLowerCase()) i++; cp=cp.slice(0,i); });
      if(cp.length>a.partial.length) inp.value=base+cp;
      else { print(promptStr()+raw); print(c.join('  ')); scrollDown(); }
    } else flash();
    const L=inp.value.length; inp.setSelectionRange(L,L);
  }
  let errStreak=0;
  function failed(){ if(++errStreak===3) print('卡住了嗎？按下方的「提示」或輸入 hint，會告訴你下一步。','hint'); }
  function execute(rawIn){
    const S=st(), raw=fix(rawIn); let line=raw.trim(); if(!line) return;
    if(/^hint$/i.test(line)){ hint(); return; }
    let pipe=null; const pi=line.indexOf('|');
    if(pi>=0){ pipe=line.slice(pi+1); line=line.slice(0,pi).trim(); }
    const toks=line.split(/\s+/);
    let r=walk(toks,modeRoots(S.mode));
    if(r.err&&isSub(S.mode)){
      const r2=walk(toks,configRoots());
      if(!r2.err&&r2.node&&r2.node.run){ S.mode='config'; S.ctx=null; r=r2; }
    }
    if(r.err==='amb'){ print(`% Ambiguous command:  "${line}"`); failed(); return; }
    if(r.err){ caret(raw,r.i); failed(); return; }
    let vals=r.vals, neg=false;
    if(vals[0]==='do') vals=vals.slice(1);
    if(vals[0]==='no'){ neg=true; vals=vals.slice(1); }
    const node=r.node;
    if(!node.run||(node.nOnly&&!neg)){ print('% Incomplete command.'); failed(); return; }
    errStreak=0;
    const res=node.run(vals,{neg});
    if(typeof res==='string'&&res.length) print(pipe?applyPipe(res,pipe):res);
  }
  function submit(){
    const S=st(), v=inp.value; inp.value='';
    if(S.pending){ const p=S.pending; S.pending=null; print(p.prompt+v); p.handler(v); }
    else {
      print(promptStr()+v);
      if(v.trim()){ S.history.push(v); if(S.history.length>200) S.history.shift(); }
      S.hidx=S.history.length;
      execute(v);
    }
    o.refresh(); scrollDown();
  }
  function hist(dir){
    const S=st(); if(!S.history.length) return;
    S.hidx=Math.max(0,Math.min(S.history.length,S.hidx+dir));
    inp.value=S.history[S.hidx]||'';
    const L=inp.value.length; inp.setSelectionRange(L,L);
  }
  function ctrlZ(){
    const S=st(); if(S.pending) return;
    print(promptStr()+inp.value+'^Z'); inp.value='';
    if(S.mode!=='exec'&&S.mode!=='priv') print(toPriv(),'log');
    o.refresh(); scrollDown();
  }
  inp.addEventListener('keydown',e=>{
    if(e.isComposing) return;
    if(e.key==='Tab'){ e.preventDefault(); doTab(); }
    else if(e.key==='?'){ e.preventDefault(); doHelp(); }
    else if(e.key==='Enter'){ e.preventDefault(); submit(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); hist(-1); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); hist(1); }
    else if(e.ctrlKey&&(e.key==='z'||e.key==='Z')){ e.preventDefault(); ctrlZ(); }
    else if(e.ctrlKey&&(e.key==='c'||e.key==='C')&&!String(window.getSelection())){ e.preventDefault(); print(promptStr()+inp.value); inp.value=''; scrollDown(); }
  });
  inp.addEventListener('input',()=>{
    const i=inp.value.indexOf('?');
    if(i>=0){ inp.value=inp.value.slice(0,i); doHelp(); }
  });
  screen.addEventListener('click',()=>{ if(!String(window.getSelection())) inp.focus(); });
  document.querySelectorAll('.keys button').forEach(b=>{
    b.addEventListener('pointerdown',e=>e.preventDefault());
    b.addEventListener('click',()=>{
      const k=b.dataset.k;
      if(k==='tab') doTab(); else if(k==='?') doHelp(); else if(k==='hint') hint(); else if(k==='up') hist(-1); else if(k==='down') hist(1); else if(k==='z') ctrlZ(); else submit();
      inp.focus();
    });
  });

  /* ---------- side panel ---------- */
  document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.tabs button').forEach(x=>{
      x.setAttribute('aria-selected',x===b?'true':'false');
      $('#tab-'+x.dataset.tab).hidden=x!==b;
    });
  }));
  const val=x=>typeof x==='function'?x():x;
  const openHints=new Set();
  let lastTasks=[], lastResults={};
  function renderTasks(tasks,results){
    lastTasks=tasks; lastResults=results;
    const next=tasks.find(t=>!results[t.id]);
    let n=0; const ol=$('#tasks'); ol.innerHTML='';
    tasks.forEach(t=>{
      const done=!!results[t.id]; if(done) n++;
      const li=document.createElement('li'); if(done) li.className='done'; else if(t===next) li.className='now'; li.dataset.id=t.id;
      const h=val(t.h);
      li.innerHTML=`<span class="box" aria-hidden="true"></span><span class="tt">${val(t.t)}${done?'<span class="sr" style="position:absolute;left:-9999px">（完成）</span>':''}</span><details ${openHints.has(t.id)?'open':''}><summary>提示</summary><div>${h}</div></details>`;
      li.querySelector('details').addEventListener('toggle',e=>{ e.target.open?openHints.add(t.id):openHints.delete(t.id); });
      ol.appendChild(li);
    });
    $('#prog').textContent=`${n}/${tasks.length}`;
    $('#meter').style.width=(n/tasks.length*100)+'%';
  }
  /* 題目卡：rows 是 [標題, 值或值的陣列]，畫在 #quiz */
  function renderQuiz(note,rows){
    const q=$('#quiz'); q.innerHTML='';
    const h=document.createElement('h2'); h.textContent='題目';
    const sm=document.createElement('small'); sm.textContent=note; h.appendChild(sm); q.appendChild(h);
    const dl=document.createElement('dl');
    rows.forEach(([k,v])=>{
      const dt=document.createElement('dt'); dt.textContent=k; dl.appendChild(dt);
      const dd=document.createElement('dd');
      (Array.isArray(v)?v:[v]).forEach(x=>{ const d=document.createElement('div'); d.textContent=x; dd.appendChild(d); });
      dl.appendChild(dd);
    });
    q.appendChild(dl);
  }
  function setLed(id,s){ $('#'+id).className='led'+(s?' '+s:''); }
  /* show(kind) 決定該類 debug 行是否要印到終端機 */
  function renderTrace(title,r,show){
    const t=$('#trace'); t.innerHTML='';
    const p=document.createElement('p'); p.className='tt '+(r.ok?'good':'bad'); p.textContent=`${title}：${r.ok?'成功':'失敗'}`; t.appendChild(p);
    const ol=document.createElement('ol');
    r.st.forEach(([k,m])=>{ const li=document.createElement('li'); li.className=k; li.textContent=m; ol.appendChild(li); });
    t.appendChild(ol);
    const lines=r.dbg.filter(([k])=>show(k));
    if(lines.length){ lines.forEach(([,l])=>print(l,'dbg')); scrollDown(); }
  }
  /* ---------- hints ---------- */
  const plain=html=>{ const d=document.createElement('div'); d.innerHTML=html; return d.textContent; };
  const MODE_NAME={exec:'使用者模式',priv:'特權模式',config:'全域設定模式'};
  /* 從目前模式走到 w 指定的模式要打哪些指令 */
  function route(w){
    const S=st(), m=S.mode, sub=isSub(m), steps=[];
    if(w.mode==='exec') return steps;
    if(m==='exec') steps.push('enable');
    if(w.mode==='priv'){ if(m==='config'||sub) steps.push('end'); return steps; }
    if(m==='exec'||m==='priv') steps.push('configure terminal');
    if(w.mode==='config'){ if(sub) steps.push('exit'); return steps; }
    if(m!==w.mode||(w.at&&!w.at(S.ctx))) steps.push(w.enter);
    return steps;
  }
  function where(w){
    if(!w) return null;
    if(w.tab) return `這一步不在終端機，要到右側「${w.name}」分頁操作。`;
    const steps=route(w), m=st().mode;
    const here=`你現在在${MODE_NAME[m]||'子設定模式'}（${promptStr()}）`;
    return steps.length?`${here}，先輸入：${steps.join(' → ')}`:`${here}，位置正確，可以直接輸入。`;
  }
  let hs={id:null,level:0};
  function hint(){
    if(st().pending) return;
    errStreak=0;
    const t=lastTasks.find(x=>!lastResults[x.id]);
    if(!t){ print(o.doneHint||'全部任務都完成了。','hint'); scrollDown(); return; }
    hs.level=hs.id===t.id?Math.min(3,hs.level+1):1; hs.id=t.id;
    const g=t.g?t.g():{}, lv=hs.level;
    const L=[`提示 ${lv}/3｜任務 ${lastTasks.indexOf(t)+1}：${plain(val(t.t))}`];
    const nav=where(g.where);
    if(lv===1) L.push(g.a||'看右側任務的說明。');
    if(lv>=2&&nav) L.push(nav);
    if(lv===2) L.push(g.b||'');
    if(lv===3){
      const c=g.c||plain(val(t.h));
      L.push(...(Array.isArray(c)?c:[c]));
    }
    L.push(lv<3?'（再按一次提示，看更具體的做法）':'（做完後再按提示，會換下一個任務）');
    print(L.filter(Boolean).map((l,i)=>i?'  '+l:l).join('\n'),'hint'); scrollDown();
  }
  function clear(){ out.innerHTML=''; $('#trace').innerHTML=''; hs={id:null,level:0}; errStreak=0; }
  function focus(opts){ inp.focus(opts); }

  return {print,scrollDown,mark,promptStr,withCommon,enterConfig,toPriv,exitMode,logout,enterDP,doSave,save,copyRun,
    dialPeerNodes,showDP,renderTasks,renderQuiz,setLed,renderTrace,clear,focus,hint};
}

/* 出題用：rnd(a,b) 是 a 到 b 的整數，pad(n,l) 補零 */
const rnd=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
const pad=(n,l)=>String(n).padStart(l,'0');
/* 節點編號 301–370 換算位址：Loopback0 是三位數拆成三段加 .2（345 → 3.4.5.2），
   語音伺服器是 10.211.(編號-300).124（345 → 10.211.45.124） */
const node={
  pick:()=>String(rnd(301,370)),
  loop:n=>String(n).split('').join('.')+'.2',
  voip:n=>`10.211.${Number(n)-300}.124`
};

window.CliCore={$,clone,ts,rnd,pad,node,K,NUM,WORD,LINE,isIp,isDial,sortK,patInfo,operational,bestPeer,forward,fwdDesc,createTerminal};
})();
