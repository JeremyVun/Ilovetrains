const { spawn } = require('child_process');
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR='/tmp/trains_comps8'; const PORT=9403;
const FILE=process.argv[2]||'board';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function connect(url){return new Promise((res,rej)=>{const s=new WebSocket(url);let id=0;const p=new Map();
 s.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){const{r,j}=p.get(m.id);p.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}};
 s.onerror=rej;const raw=(me,pa,si)=>new Promise((r,j)=>{const g={id:++id,method:me,params:pa||{}};if(si)g.sessionId=si;p.set(g.id,{r,j});s.send(JSON.stringify(g));});
 s.onopen=()=>res({send:(m,q)=>raw(m,q),session:sid=>({send:(m,q)=>raw(m,q,sid)}),close:()=>s.close()});});}
(async()=>{
 const prof='/tmp/tc8-measure';   /* ROUND 7: the round-5/6 profile dirs were still LOCKED by orphaned headless Chrome trees, and a locked profile makes Chrome exit before the devtools endpoint opens — which surfaces as 'Invalid URL' from the WebSocket, not as anything about Chrome. Unique profile per round. */
 const ch=spawn(CHROME,['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${PORT}`,`--user-data-dir=${prof}`,'--allow-file-access-from-files','about:blank'],{stdio:'ignore'});
 let ws; try{
  let u; for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/version`);u=(await r.json()).webSocketDebuggerUrl;if(u)break;}catch(_){} await sleep(100);}
  ws=await connect(u);
  const {targetId}=await ws.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await ws.send('Target.attachToTarget',{targetId,flatten:true});
  const page=ws.session(sessionId); await page.send('Page.enable');
  const SC=['hero','past','deep','delayed','cancelled','tight','long','focused','riding','landing'];
  const JOBS=[]; for(const s of SC){JOBS.push([s,390,844]);} JOBS.push(['hero',412,732],['long',412,732],['long',360,780]);
  for(const [s,w,h] of JOBS){
   await page.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:true});
   await page.send('Page.navigate',{url:`file://${DIR}/${FILE}.html?s=${s}`}); await sleep(250);
   const r=await page.send('Runtime.evaluate',{expression:`(()=>{const q=x=>document.querySelector(x);
     /* TEXT OVERFLOWING A FIXED TRACK does not move the box's right edge, so
        shoot.js's right-edge probe is blind to it. Scan every leaf for
        scrollWidth > clientWidth and separate CLIPPED (ellipsis, deliberate)
        from SPILL (nowrap with no ellipsis, always a bug). */
     const clip=[],spill=[];
     document.querySelectorAll('body *').forEach(e=>{ if(e.children.length) return;
       if(e.scrollWidth - e.clientWidth > 1){ const cs=getComputedStyle(e);
         const t=(e.className||e.tagName)+':'+e.textContent.trim().slice(0,18)+'+'+(e.scrollWidth-e.clientWidth);
         (cs.textOverflow==='ellipsis'&&cs.overflow!=='visible'?clip:spill).push(t); }});
     /* TRAP (C1, relay): text-align:right does NOT overflow leftwards — Chrome
        start-aligns an over-long line box, so a right-aligned figure silently
        invades the column to its LEFT and no overflow probe fires. Measure the
        WIDEST lockup the vocabulary can produce against its track, not the
        scenario's actual value: the figure must hold "12H" (per docs/contracts/ui.md),
        "78min" and "Now"; the provenance slot "6 MIN LATE"; the cap a two-digit
        platform; the third line the cancelled-lead copy. */
     const M=(t,cls)=>{const e=q(cls); if(!e) return null; const c=e.cloneNode(false);
       c.textContent=t; c.style.position='absolute'; c.style.width='auto';
       c.style.whiteSpace='nowrap'; c.style.visibility='hidden';
       e.parentElement.appendChild(c); const w=Math.ceil(c.getBoundingClientRect().width);
       c.remove(); return w;};
     const track=x=>{const e=q(x);return e?Math.round(e.getBoundingClientRect().width):null;};
     const rows=[...document.querySelectorAll('.sy-row')].map(e=>Math.round(e.getBoundingClientRect().height));
     /* The widest-lockup check has to run through the REAL cascade, not through
        a bare clone: the guard that saves 'Now' is a class on the ROW, so a
        clone of the numeral alone measures a size the page never renders and
        reports a false 5px invasion. Clone the whole row, apply the guard the
        renderer would apply, and measure the numeral against its own track. */
     const lock=(txt,wide)=>{const src=q('.sy-row'); if(!src) return null;
       const c=src.cloneNode(true); if(wide) c.classList.add('wide'); else c.classList.remove('wide');
       c.style.position='absolute'; c.style.top='-4000px'; c.style.width=Math.round(src.getBoundingClientRect().width)+'px';
       src.parentElement.appendChild(c);
       const n=c.querySelector('.sy-n'), u=n.querySelector('.sy-u');
       n.childNodes[0].nodeValue=txt; if(u&&!/^[0-9]+$/.test(txt)) u.remove();
       const g=document.createRange(); g.selectNodeContents(n);
       const w=Math.ceil(g.getBoundingClientRect().width);
       const t=Math.round(c.querySelector('.sy-fig').getBoundingClientRect().width);
       c.remove(); return w+'/'+t+(w>t?' *** INVADES':'');};
     /* ROUND 3 AMENDMENT probe. Two questions no screenshot answers: (1) is the
        journey still drawn to scale now that leg 2 carries a cap inside its own
        share, and (2) does a TWO-DIGIT change platform fit — the fixtures only
        ever change onto platform 5, so the wide case has to be composed. */
     const split=()=>{const b=q('.sy-row .sy-bar'); if(!b) return null;
       return [...b.children].map(e=>Math.round(e.getBoundingClientRect().width)).join('/');};
     /* ROUND 4: the transfer is TWO numerals and both can be two digits. Set
        both to their widest legal value and re-read every child of the bar; the
        number that matters is the last one, leg 2's own drawn length. */
     const lock2=(txt)=>{const src=q('.sy-row'); if(!src||!src.querySelector('.sy-p')) return null;
       const c=src.cloneNode(true); c.style.position='absolute'; c.style.top='-4000px';
       c.style.width=Math.round(src.getBoundingClientRect().width)+'px';
       src.parentElement.appendChild(c);
       [...c.querySelectorAll('.sy-p')].forEach(e=>{e.textContent=txt;});
       const kids=[...c.querySelectorAll('.sy-bar > *')];
       const bar=kids.map(e=>Math.round(e.getBoundingClientRect().width)).join('/');
       const run=kids.length?Math.round(kids[kids.length-1].getBoundingClientRect().width):0;
       c.remove(); return 'bar '+bar+' leg2run '+run+(run<3?' *** RUN GONE':'');};
     /* KNOCKED-OUT INK ON A DIMMED FILL, measured (Board v2 amendment: "measured,
        not assumed", floor 3:1 at 14px/700). A past row dims its whole journey
        line with one opacity, so both the fill and the ink knocked out of it are
        composited over the page ground — a ratio nothing else in the workshop
        can see, and the reason the dim is a number rather than a taste. */
     const lum=(r,g,b)=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
       return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
     const rgb=s=>s.match(/[\\d.]+/g).map(Number).slice(0,3);
     const over=(fg,a,bg)=>[0,1,2].map(i=>fg[i]*a+bg[i]*(1-a));
     const ratio=(x,y)=>{const A=lum(x[0],x[1],x[2]),B=lum(y[0],y[1],y[2]);
       return Math.round(((Math.max(A,B)+0.05)/(Math.min(A,B)+0.05))*100)/100;};
     const capInk=(sel)=>{const e=q(sel); if(!e) return null;
       const j=e.closest('.sy-j'); const a=j?+getComputedStyle(j).opacity:1;
       const page=rgb(getComputedStyle(document.body).backgroundColor);
       const fill=over(rgb(getComputedStyle(e).backgroundColor),a,page);
       const ink=over(rgb(getComputedStyle(e).color),a,fill);
       const c=ratio(fill,ink); return c+(c<3?' *** BELOW 3:1':'');};
     /* ROUND 5 CORRECTION 2, and the only probe that can see it: the bar claims
        to be a TIME AXIS, so every mark on it has an arithmetic position and the
        picture either agrees with the arithmetic or it does not. Reports each
        segment's drawn px against W*mins/total, the two numerals' pinned edges
        against the leg boundaries they claim, the VISIBLE gap between the boxes,
        and any numeral SY_BAR_CLAMP had to pull back off the end of the bar —
        which shoot.js's overflow probe cannot see at all, because it skips
        absolutely positioned elements. */
     /* ROUND 5 CORRECTION 4. The page's PADDING was already even — every box
        reads 22|22 — so the probe that matters measures the INK: the leftmost
        mark any row actually puts on the page against the rightmost. A
        right-aligned figure begins 64px inside a page whose right edge is a hard
        22px, and it MOVES with the countdown, which is the ragged left margin
        the owner is looking at. Ranges, not boxes: a left-aligned .sy-n fills
        its whole track and its box would report 22 whatever the ink did. */
     const ink=e=>{const g=document.createRange();g.selectNodeContents(e);return g.getBoundingClientRect();};
     const EDGES=()=>{const vw=document.documentElement.clientWidth;let L=1e9,R=1e9,who='';
       document.querySelectorAll('.sy-row').forEach(row=>{
         ['.sy-n','.sy-st','.sy-dp','.sy-sign'].forEach(s=>{const e=row.querySelector(s);
           if(!e)return;const r=ink(e);if(r.width<1)return;if(r.left<L){L=r.left;who=s;}});
         const c=row.querySelector('.sy-cap');if(c){const r=c.getBoundingClientRect();if(r.left<L){L=r.left;who='.sy-cap';}}
         ['.sy-ar','.sy-sign'].forEach(s=>{const e=row.querySelector(s);
           if(!e)return;const r=ink(e);if(r.width<1)return;R=Math.min(R,vw-r.right);});
         const b=row.querySelector('.sy-bar');if(b)R=Math.min(R,vw-b.getBoundingClientRect().right);});
       if(L>1e8)return null;
       const l=Math.round(L),r=Math.round(R);
       return 'inkL '+l+' ('+who+') inkR '+r+(Math.abs(l-r)>1?' *** UNEVEN by '+Math.abs(l-r):' even');};
     const BAR=(sel)=>{const b=q(sel); if(!b) return null;
       const sp=b.querySelector('.sy-spec'); if(!sp) return null;
       const bb=b.getBoundingClientRect(); const W=bb.width;
       const mins=sp.getAttribute('data-mins').split('/').map(Number);
       const T=mins.reduce((x,y)=>x+y,0);
       const r1=b.querySelector('.sy-r.a'), g=b.querySelector('.sy-g0'), r2=b.querySelector('.sy-r.b');
       const px=e=>e?Math.round(e.getBoundingClientRect().width*10)/10:null;
       const drawn=[px(r1),px(g),px(r2)].filter(v=>v!==null);
       const want=mins.map(m=>Math.round(W*m/T*10)/10);
       const pa=b.querySelector('.sy-p.a'), pb=b.querySelector('.sy-p.b');
       let tail=null,head=null,vis=null,clamp=0;
       if(pa&&pb){const ra=pa.getBoundingClientRect(),rb=pb.getBoundingClientRect();
         tail=Math.round((ra.right-bb.left)*10)/10+'/'+want[0];
         head=Math.round((rb.left-bb.left)*10)/10+'/'+Math.round((want[0]+want[1])*10)/10;
         vis=Math.round((rb.left-ra.right)*10)/10;
         clamp=(pa.hasAttribute('data-clamped')?1:0)+(pb.hasAttribute('data-clamped')?2:0);}
       const dev=drawn.map((v,i)=>Math.round(Math.abs(v-want[i])*10)/10);
       return 'W'+Math.round(W)+' mins '+mins.join(':')+' drawn '+drawn.join('/')
         +' want '+want.join('/')+' dev '+dev.join('/')
         +(tail?' tailRight '+tail+' headLeft '+head+' visGap '+vis:'')
         +(clamp?' *** CLAMPED '+clamp:'')
         +(Math.max.apply(null,dev)>1?' *** OFF SCALE':'');};
     const stress = q('.sy-row .sy-fig') ? {
       figTrack:track('.sy-row .sy-fig'),
       LOCK_78min:lock('78',false), LOCK_999min:lock('999',true), LOCK_12H:lock('12H',true), LOCK_Now:lock('Now',true), LOCK_187:lock('187',true),
       st_late:M('6 MIN LATE','.sy-row .sy-st'), st_ago:M('AGO','.sy-row .sy-st'), st_sched:M('SCHEDULED','.sy-row .sy-st'),
       capW:track('.sy-row .sy-cap'), cap_13:M('Platform 13','.sy-row .sy-cap'),
       barW:track('.sy-row .sy-bar'),
       SPLIT:split(), padW:track('.sy-row .sy-p'),
       BAR:BAR('.sy-row .sy-bar'), BAR_strip:BAR('.sy-strip .sy-bar'),
       EDGES:EDGES(),
       XF_5:lock2('5'), XF_13:lock2('13'),
       INK_live:capInk('.sy-row:not(.past) .sy-cap'),
       INK_pastAc:capInk('.sy-row.past.ac .sy-cap'), INK_pastTt:capInk('.sy-row.past.tt .sy-cap'),
       signTrack:track('.sy-row .sy-sign'), sign_mtvic:M('Mount Victoria via Parramatta','.sy-row .sy-sign'),
       sign_note:M('09:24 cancelled \\u00b7 next train','.sy-row .sy-sign'),
       sign_tight:M('Tight change \\u00b7 2 min','.sy-row .sy-sign')
     } : null;
     /* TRAP (C1, relay): an element INSIDE the scroller pays the scroller's
        padding again. Report every full-measure rule's left/right inset against
        the viewport so a doubled 22px inset cannot hide. */
     const inset=x=>{const e=q(x);if(!e)return null;const r=e.getBoundingClientRect();
       return Math.round(r.left)+'|'+Math.round(document.documentElement.clientWidth-r.right);};
     const rules={mastRule:inset('.sy-hr'),nowRule:inset('.sy-now .r'),row:inset('.sy-row'),
       past:inset('.sy-past'),strip:inset('.sy-strip'),end:inset('.sy-end')};
     /* the two scanning groups: the arrival column must share the masthead's
        right edge, and every journey must start at one left edge. */
     const edges={h1from:inset('.sy-h1 b:first-child'),h1to:inset('.sy-h1 b:last-child'),
       dep:inset('.sy-row .sy-dp'),arr:inset('.sy-row .sy-ar'),cap:inset('.sy-row .sy-cap'),
       pastbar:inset('.sy-past .sy-bar')};
     const fit=x=>{const e=q(x);if(!e)return null;const p=Math.round(e.parentElement.getBoundingClientRect().width);
       const g=document.createRange();g.selectNodeContents(e);
       return Math.round(g.getBoundingClientRect().width)+'/'+p;};
     const tight={h1:fit('.sy-h1'),strip2:fit('.sy-s2'),end:fit('.sy-end b'),now:fit('.sy-now .l')};
     return JSON.stringify({rows,rules,edges,stress,tight,clip,SPILL:spill});})()`,returnByValue:true});
   console.log(FILE,s,w+'x'+h,r.result.value);
  }
 } finally { if(ws)try{ws.close();}catch(_){}; ch.kill('SIGKILL'); }
})();
