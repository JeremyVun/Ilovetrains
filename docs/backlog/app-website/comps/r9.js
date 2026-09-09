
const originalAction=document.querySelector('[data-device-action]');
for(const a of [...document.querySelectorAll('[data-device-action]')].slice(1)) {
 a.textContent=originalAction.textContent;
 if(document.documentElement.dataset.device && document.documentElement.dataset.device!=='web') {
  a.addEventListener('click',event=>{const d=document.querySelector('[data-store-dialog]');try{d.showModal();event.preventDefault();d.addEventListener('close',()=>a.focus(),{once:true});}catch{}});
  const alt=document.createElement('a');alt.href='https://ilovetrains.jeremyvun.com';alt.className='web-alternative';alt.textContent='Use the web app';a.after(alt);
 }
}
