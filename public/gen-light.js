const fs=require('fs');let css=fs.readFileSync('style.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'');
const dark=(r,g,b)=>r<75&&g<85&&b<110;
const sem={'#fbbf24':'#b45309','#f87171':'#dc2626','#34d399':'#047857','#fda4af':'#be123c','#93c5fd':'#1d4ed8','#c084fc':'#7e22ce','#60a5fa':'#2563eb','#38bdf8':'#0369a1','#a78bfa':'#6d28d9','#818cf8':'#4338ca','#fcd34d':'#b45309','#6ee7b7':'#047857','#fca5a5':'#b91c1c','#86efac':'#15803d','#67e8f9':'#0e7490'};
const txt={'#f8fafc':'var(--text-primary)','#f1f5f9':'var(--text-primary)','#e2e8f0':'var(--text-primary)','#cbd5e1':'var(--text-secondary)','#94a3b8':'var(--text-secondary)','#64748b':'var(--text-muted)','#475569':'var(--text-muted)'};
function conv(prop,val){
 if(/var\(--/.test(val)&&!/rgba?\(/.test(val))return null;
 const isBg=/^background/.test(prop),isCol=prop==='color',isBd=/^border|^outline/.test(prop),isSh=prop==='box-shadow';
 if(!(isBg||isCol||isBd||isSh))return null;
 let out=val,ch=false;
 out=out.replace(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/g,(m,r,g,b,a)=>{r=+r;g=+g;b=+b;a=a===undefined?1:+a;
  if(r>240&&g>240&&b>240&&a<1){ch=true;
   if(isCol)return a>=.6?'var(--text-primary)':a>=.4?'var(--text-secondary)':'var(--text-muted)';
   if(isBd)return `rgba(15,23,42,${Math.max(.08,+(a*.8).toFixed(3))})`;
   if(isBg)return `rgba(15,23,42,${Math.min(.04,+(a*.5).toFixed(3))})`;
   return m;}
  if(isBg&&dark(r,g,b)&&a>=.2){ch=true;return a>=.6?'var(--surface)':'var(--surface-2)';}
  if(isBg&&r===0&&g===0&&b===0){ch=true;return 'rgba(15,23,42,.03)';}
  if(isSh&&a>=.2&&dark(r,g,b)){ch=true;return 'rgba(16,24,40,.08)';}
  return m;});
 out=out.replace(/#[0-9a-fA-F]{3,6}\b/g,h=>{const k=h.toLowerCase();
  if(isCol){if(txt[k]){ch=true;return txt[k];}if(sem[k]){ch=true;return sem[k];}}
  if(isBg&&/^#[0-2][0-9a-f]{2}([0-9a-f]{3})?$/i.test(k)&&!/gradient/.test(out.replace(/#[0-9a-f]+/gi,''))){ch=true;return 'var(--surface)';}
  return h;});
 if(isBg&&/gradient/.test(out)&&/var\(--surface/.test(out)){ch=true;out='var(--surface)';}
 return ch?out:null;}
let res=[],re=/([^{}]+)\{([^{}]*)\}/g,m;
while((m=re.exec(css))){let sel=m[1].trim().replace(/^.*\}/,'').trim();if(!sel||/^@/.test(sel)||/^(from|to|\d+%)/.test(sel))continue;
 const ds=[];m[2].split(';').forEach(d=>{const i=d.indexOf(':');if(i<0)return;const p=d.slice(0,i).trim(),v=d.slice(i+1).trim();const c=conv(p,v);if(c)ds.push(`${p}:${c}!important`);});
 if(ds.length){const ss=sel.split(',').map(x=>x.trim()).filter(x=>x&&!/^(from|to)$/.test(x)).map(x=>`[data-theme="light"] ${x}`).join(',');res.push(`${ss}{${ds.join(';')}}`);}}
fs.writeFileSync('theme-light.css','/* AUTO-GENERATED from style.css: light-mode fixes. Regenerate with gen-light.js */\n'+res.join('\n')+'\n');console.log(res.length);

