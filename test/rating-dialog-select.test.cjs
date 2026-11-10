const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync('public/music/app.js','utf8');
function setup(host){
 const make=()=>({children:[],style:{},classList:{add(){},remove(){}},appendChild(x){this.children.push(x)},append(...xs){this.children.push(...xs)},offsetHeight:200});
 const body=make();const context={window:{innerHeight:800,scrollX:0,scrollY:0,addEventListener(){},removeEventListener(){}},document:{body,createElement:make,querySelectorAll:()=>[]},requestAnimationFrame:fn=>fn()};
 const start=source.indexOf('window.CustomSelectManager = {');const end=source.indexOf("document.addEventListener('click'",start);vm.runInNewContext(source.slice(start,end),context);
 const select={options:[{text:'<script>平台</script>',value:'tx',selected:true}],closest:()=>host};const wrapper=make();const trigger={getBoundingClientRect:()=>({left:120,top:150,bottom:190,width:140})};context.window.CustomSelectManager.open(select,wrapper,trigger);return{body,manager:context.window.CustomSelectManager,select};
}
test('统一下拉菜单挂载到所属dialog，坐标换算为弹窗内且文本不注入HTML',()=>{
 const host={children:[],appendChild(x){this.children.push(x)},getBoundingClientRect:()=>({left:100,top:50,bottom:650}),scrollLeft:0,scrollTop:10,clientLeft:1,clientTop:1};const{body}=setup(host);assert.equal(body.children.length,0);assert.equal(host.children.length,1);const dropdown=host.children[0];assert.equal(dropdown.style.left,'19px');assert.equal(dropdown.style.top,'153px');assert.equal(dropdown.children[0].children[0].children[0].textContent,'<script>平台</script>');
});
test('非模态页面下拉菜单继续挂载body，不改变普通页面坐标',()=>{const{body}=setup(null);assert.equal(body.children.length,1);assert.equal(body.children[0].style.left,'120px');assert.equal(body.children[0].style.top,'194px')});
test('我的评分显式初始化统一组件、映射手动补分，并在关闭时清理菜单',()=>{const text=fs.readFileSync('public/music/js/library/rating_manager.js','utf8');assert.match(text,/CustomSelectManager\?\.init\(select\)/);assert.match(text,/'manual-dislike-to-rating': '后台补分'/);assert.match(text,/collectionDialog.addEventListener\('close'.*CustomSelectManager\?\.closeAll/);assert.match(text,/评分来源是什么意思/);assert.match(text,/terms.every/)});
