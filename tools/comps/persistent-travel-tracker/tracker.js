'use strict';
(function(){
 const {key,state:s}=trackerScenario();
 const esc=v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
 const ride=s.stage==='ride',change=s.stage==='transfer';
 const headline=ride?esc(s.interchange)+' in <b>'+s.timer+' min.</b>':change?'M1 leaves in <b>'+s.timer+' min.</b>':esc(s.destination)+' in <b>'+s.timer+' min.</b>';
 const directions=ride?'Get off on Platform <b>'+s.offPlatform+'</b>, then take M1 from Platform <b>'+s.onPlatform+'</b>.':change?'Go to <b>Platform '+s.onPlatform+'</b> for Tallawong.':s.finalPlatform?'Get off on <b>Platform '+s.finalPlatform+'</b>.':'Get off at '+esc(s.destination)+'. Platform not supplied.';
 const window=ride?'7 min to change':change?(s.warning?'Tight change · ':'')+'Departs '+s.onwardDeparture:'';
 const provenance=s.degraded?'<span class="provenance">Offline · Last updated 04:42</span>':'';
 const trace='<div class="trip-trace" data-axis="'+s.segments.join('/')+'" style="--progress:'+s.progress/s.segments.reduce((a,b)=>a+b,0)*100+'%">'+s.segments.map((n,i)=>'<i data-seg class="trace-'+i+'" style="flex:'+n+'"></i>').join('')+'<b class="trace-now"></b></div>';
 const body='<div class="sentence-top"><h1>'+headline+'</h1><p>'+directions+'</p><div class="connection"><span>'+window+'</span>'+provenance+'</div></div><div class="arrival"><span>'+esc(s.destination)+'</span><span>about '+s.arrive+'</span></div>'+trace;
 document.getElementById('app').innerHTML='<main class="lock-screen stage-'+s.stage+(s.degraded?' degraded':'')+(s.warning?' warning':'')+'"><div class="status-bar"><span>'+s.now+'</span><span>▰</span></div><div class="lock-clock"><span>Tuesday, 8 September</span><strong>'+s.now+'</strong></div><article class="tracker-card c1-sentence" data-tap data-svc>'+body+'</article><div class="home-indicator"></div></main>';
})();
