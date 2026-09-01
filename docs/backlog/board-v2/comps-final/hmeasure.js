/* HOME's measurement instrument — the sibling of measure.js, same traps.
 * Text overflowing a FIXED grid track does not move its box's right edge, so
 * shoot.js's right-edge probe is blind to it; `text-align: right` start-aligns
 * an over-long line box and invades the column to its LEFT with nothing firing.
 * So: scan every leaf for scrollWidth > clientWidth (separating deliberate
 * ellipsis from SPILL), and stress every track with the WIDEST legal value its
 * vocabulary can produce, not the scenario's actual one.
 *
 * Usage: node hmeasure.js home-a
 */
const { spawn } = require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR='/tmp/trains_comps8'; const PORT=9407;
const FILE=process.argv[2]||'home';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function connect(url){return new Promise((res,rej)=>{const s=new WebSocket(url);let id=0;const p=new Map();
 s.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){const{r,j}=p.get(m.id);p.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}};
 s.onerror=rej;const raw=(me,pa,si)=>new Promise((r,j)=>{const g={id:++id,method:me,params:pa||{}};if(si)g.sessionId=si;p.set(g.id,{r,j});s.send(JSON.stringify(g));});
 s.onopen=()=>res({send:(m,q)=>raw(m,q),session:sid=>({send:(m,q)=>raw(m,q,sid)}),close:()=>s.close()});});}
(async()=>{
 const prof='/tmp/tc8-hmeasure';   /* see measure.js: unique profile per round, orphaned trees lock the old ones */
 const ch=spawn(CHROME,['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${PORT}`,`--user-data-dir=${prof}`,'--allow-file-access-from-files','about:blank'],{stdio:'ignore'});
 let ws; try{
  let u; for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/version`);u=(await r.json()).webSocketDebuggerUrl;if(u)break;}catch(_){} await sleep(100);}
  ws=await connect(u);
  const {targetId}=await ws.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await ws.send('Target.attachToTarget',{targetId,flatten:true});
  const page=ws.session(sessionId); await page.send('Page.enable');
  const SC=['before','leave','board','change','final','arrive','done','tight','cxl','wide','back','moved','nofix','ask','many','add','save'];
  const JOBS=[]; for(const s of SC) JOBS.push([s,390,844]);
  JOBS.push(['change',412,732],['before',412,732],['many',412,732],['add',412,732],['change',360,780],['before',360,780],['back',360,780]);
  for(const [s,w,h] of JOBS){
   await page.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:true});
   await page.send('Page.navigate',{url:`file://${DIR}/${FILE}.html?s=${s}`}); await sleep(240);
   const r=await page.send('Runtime.evaluate',{expression:`(()=>{const q=x=>document.querySelector(x);
     const clip=[],spill=[];
     document.querySelectorAll('body *').forEach(e=>{ if(e.children.length) return;
       if(e.scrollWidth - e.clientWidth > 1){ const cs=getComputedStyle(e);
         const t=(e.className||e.tagName)+':'+e.textContent.trim().slice(0,18)+'+'+(e.scrollWidth-e.clientWidth);
         (cs.textOverflow==='ellipsis'&&cs.overflow!=='visible'?clip:spill).push(t); }});
     const track=x=>{const e=q(x);return e?Math.round(e.getBoundingClientRect().width):null;};
     const H=x=>{const e=q(x);return e?Math.round(e.getBoundingClientRect().height):null;};
     const inset=x=>{const e=q(x);if(!e)return null;const r=e.getBoundingClientRect();
       return Math.round(r.left)+'|'+Math.round(document.documentElement.clientWidth-r.right);};
     /* widest lockup, through the REAL cascade: clone the whole header so the
        .wide guard on the ROOT applies, then measure the numeral's own ink
        against its own track. */
     const lock=(txt,wide)=>{const src=q('.hm-hd'); if(!src) return null;
       const c=src.cloneNode(true); wide?c.classList.add('wide'):c.classList.remove('wide');
       c.style.position='absolute'; c.style.top='-4000px';
       c.style.width=Math.round(src.getBoundingClientRect().width)+'px';
       src.parentElement.appendChild(c);
       const n=c.querySelector('.hm-n'), u=n.querySelector('.hm-u');
       n.childNodes[0].nodeValue=txt; if(u&&!/^[0-9]+$/.test(txt)) u.remove();
       const g=document.createRange(); g.selectNodeContents(n);
       const wpx=Math.ceil(g.getBoundingClientRect().width);
       const t=Math.round(c.querySelector('.hm-fig').getBoundingClientRect().width);
       c.remove(); return wpx+'/'+t+(wpx>t?' *** INVADES':'');};
     /* the ends line: the two station names must both set whole. The worst pair
        the saved-trip vocabulary can make is the longest name at BOTH ends. */
     const ends=(a,b)=>{const src=q('.hm-hd'); if(!src) return null;
       const c=src.cloneNode(true); c.style.position='absolute'; c.style.top='-4000px';
       c.style.width=Math.round(src.getBoundingClientRect().width)+'px';
       src.parentElement.appendChild(c);
       const st=c.querySelectorAll('.hm-stn'); st[0].textContent=a; st[1].textContent=b;
       const bad=[...st].map(e=>e.scrollWidth-e.clientWidth>1?'CLIPPED':'ok');
       const box=Math.round(c.querySelector('.hm-ends').getBoundingClientRect().width);
       const need=[...st].reduce((n,e)=>n+e.scrollWidth,0)+12;
       c.remove(); return need+'/'+box+' '+bad.join(',')+(need>box?' *** ELLIPSIS':'');};
     /* a nowrap string measured against the box it must fit */
     const M=(t,cls)=>{const e=q(cls); if(!e) return null; const c=e.cloneNode(false);
       c.textContent=t; c.style.position='absolute'; c.style.width='auto';
       c.style.whiteSpace='nowrap'; c.style.visibility='hidden';
       e.parentElement.appendChild(c); const wpx=Math.ceil(c.getBoundingClientRect().width);
       c.remove(); return wpx;};
     const fit=x=>{const e=q(x);if(!e)return null;const p=Math.round(e.parentElement.getBoundingClientRect().width);
       const g=document.createRange();g.selectNodeContents(e);
       return Math.round(g.getBoundingClientRect().width)+'/'+p;};
     /* THE BAR IS A TIME AXIS (round 5 correction 2) and THE MARKER RIDES IT.
        Both are geometry claims, so both get measured against the arithmetic
        rather than looked at: every segment's drawn px against W*mins/total, the
        two numerals' pinned edges against the leg boundaries they claim, the
        visible gap, the marker's own position — and the one thing the brief made
        a hard constraint, whether the marker's wedge ever overlaps a platform
        numeral it passes. Absolutely positioned elements are invisible to
        shoot.js's overflow probe, so nothing else in the workshop can see any of
        this. */
     const BAR=(sel)=>{const b=q(sel); if(!b) return null;
       const sp=b.querySelector('.sy-spec'); if(!sp) return null;
       const bb=b.getBoundingClientRect(); const W=bb.width;
       const mins=sp.getAttribute('data-mins').split('/').map(Number);
       const T=mins.reduce((x,y)=>x+y,0);
       const px=e=>e?Math.round(e.getBoundingClientRect().width*10)/10:null;
       const drawn=[px(b.querySelector('.sy-r.a')),px(b.querySelector('.sy-g0')),px(b.querySelector('.sy-r.b'))].filter(v=>v!==null);
       const want=mins.map(m=>Math.round(W*m/T*10)/10);
       const pa=b.querySelector('.sy-p.a'), pb=b.querySelector('.sy-p.b');
       let tail=null,head=null,vis=null,clamp=0;
       if(pa&&pb){const ra=pa.getBoundingClientRect(),rb=pb.getBoundingClientRect();
         tail=Math.round((ra.right-bb.left)*10)/10+'/'+want[0];
         head=Math.round((rb.left-bb.left)*10)/10+'/'+Math.round((want[0]+want[1])*10)/10;
         vis=Math.round((rb.left-ra.right)*10)/10;
         clamp=(pa.hasAttribute('data-clamped')?1:0)+(pb.hasAttribute('data-clamped')?2:0);}
       const dev=drawn.map((v,i)=>Math.round(Math.abs(v-want[i])*10)/10);
       const mk=b.querySelector('.sy-mk'); let mkTxt='';
       if(mk){const w=mk.querySelector('i').getBoundingClientRect();
         const cut=mk.getBoundingClientRect();
         let hit='';
         [pa,pb].forEach((p,i)=>{if(!p)return;const r=p.getBoundingClientRect();
           if(w.right>r.left&&w.left<r.right&&w.bottom>r.top+0.5&&w.top<r.bottom-0.5) hit+=' *** WEDGE OVER NUMERAL '+(i?'b':'a');});
         mkTxt=' mk '+Math.round((cut.left+cut.width/2-bb.left)*10)/10+'/'+W
           +' cls '+mk.className.replace('sy-mk ','')
           +' wedgeBottom '+Math.round(w.bottom-bb.top)+'px into bar'+hit;}
       return 'W'+Math.round(W)+' mins '+mins.join(':')+' drawn '+drawn.join('/')
         +' want '+want.join('/')+' dev '+dev.join('/')
         +(tail?' tailRight '+tail+' headLeft '+head+' visGap '+vis:'')
         +mkTxt+(clamp?' *** CLAMPED '+clamp:'')
         +(Math.max.apply(null,dev)>1?' *** OFF SCALE':'');};
     const stress=q('.hm-hd')?{
       BAR:BAR('.hm-hd .sy-bar'),
       figTrack:track('.hm-fig'),
       LOCK_78min:lock('78',false), LOCK_12H:lock('12H',true), LOCK_Now:lock('Now',true),
       LOCK_999min:lock('999',true),
       endsBox:track('.hm-ends'),
       ENDS_worst:ends('Bondi Junction','Bondi Junction'),
       ENDS_now:ends(q('.hm-e.from .hm-stn').textContent,q('.hm-e.to .hm-stn').textContent),
       capW:track('.hm-hd .sy-cap'), padW:track('.hm-hd .sy-p'),
       barW:track('.hm-hd .sy-bar'),
       SPLIT:(()=>{const b=q('.hm-hd .sy-bar');return b?[...b.children].map(e=>Math.round(e.getBoundingClientRect().width)).join('/'):null;})(),
       signTrack:track('.hm-sign'), sign_long:M('Mount Victoria via Parramatta','.hm-sign'),
       rec:fit('.hm-rec'), trk:fit('.hm-track .t'),
       signTrackW:track('.hm-sign'), sign_cxl:M('09:24 CANCELLED \\u00b7 NEXT TRAIN','.hm-sign'),
       sign_tight:M('Tight change \\u00b7 2 min \\u00b7 Platform 13','.hm-sign'),
       track_worst:M('Tracking \\u00b7 Bondi Jn \\u2192 Bondi Jn','.hm-track .t'), trackBox:track('.hm-track .t')
     }:null;
     const sub=q('.tripr .hm-sub');
     const list=sub?{
       subBox:track('.tripr .hm-sub'),
       sub_worst:M('Reversed above \\u00b7 Rode it this morning','.tripr .hm-sub'),
       nmBox:track('.tripr .hm-nm'), nm_worst:M('Bondi Junction \\u2192 Bondi Junction','.tripr .hm-nm'),
       rows:[...document.querySelectorAll('.tripr')].map(e=>Math.round(e.getBoundingClientRect().height))
     }:null;
     const heights={top:H('.hm-top'),hd:H('.hm-hd'),offer:H('.hm-offer'),ix:H('.hm-ix'),
       bar:H('.hm-bar'),ask:H('.hm-ask'),sheet:H('.hm-sheet')};
     const ixe=q('.hm-ix');
     const scroll=ixe?Math.round(ixe.scrollTop)+'/'+Math.round(ixe.scrollHeight-ixe.clientHeight):null;
     const rules={anchor:inset('.hm-anchor .r'),hd:inset('.hm-hd'),tripr:inset('.tripr'),
       bar:inset('.hm-bar'),end:inset('.hm-end'),mast:inset('.hm-mast .r')};
     /* a hole nothing else fires on: unclaimed space at the foot of the frame */
     const last=[...document.querySelectorAll('#app > *')].pop();
     const gap=last?Math.round(document.documentElement.clientHeight-last.getBoundingClientRect().bottom):null;
     return JSON.stringify({heights,scroll,GAP_AT_FOOT:gap,rules,stress,list,clip,SPILL:spill});})()`,returnByValue:true});
   console.log(FILE,s,w+'x'+h,r.result.value);
  }
 } finally { if(ws)try{ws.close();}catch(_){}; ch.kill('SIGKILL'); }
})();
