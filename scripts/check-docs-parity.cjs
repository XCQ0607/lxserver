const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const codes=s=>new Set([...s.matchAll(/`([^`]+)`/g)].map(m=>m[1]));
for(const p of ['guide/subsonic-local-library.md','api/subsonic.md']){
 const a=codes(read('docs/'+p)),b=codes(read('docs/en/'+p));
 const technical=x=>/^(?:subsonic\.|(?:get|save|create|update|delete|start|report)[A-Z]|scrobble$|star$|unstar$|stream$|download$|ping$|search[23]?$)/.test(x);
 const missing=[...a].filter(technical).filter(x=>!b.has(x));
 const extra=[...b].filter(technical).filter(x=>!a.has(x));
 if(missing.length||extra.length)throw Error(p+' mismatches: '+JSON.stringify({missing,extra}));
 console.log(p+': endpoint and configuration identifiers match');
}
const routes=s=>new Set([...s.matchAll(/`(\/api\/[^`]+)`/g)].map(m=>m[1]));
const cn=routes(read('docs/api/routes.md')),en=routes(read('docs/en/api/routes.md'));
const delta={missingEnglish:[...cn].filter(x=>!en.has(x)),missingChinese:[...en].filter(x=>!cn.has(x))};
if(delta.missingEnglish.length||delta.missingChinese.length)throw Error(JSON.stringify(delta));
console.log('Route indexes match: '+cn.size+' paths');
const source=read('src/server/server.ts');
const literals=new Set([...source.matchAll(/pathname\s*===\s*['"](\/api\/[^'"]+)['"]/g)].map(m=>m[1]));
const absent=[...literals].filter(p=>!cn.has(p));
console.log('Literal equality routes missing from index: '+JSON.stringify(absent));
if(absent.length)process.exitCode=1;
