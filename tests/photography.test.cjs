const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handler = require('../api/photography');
const booking = {type:'booking',slotId:'slot-1',requestId:'00000000-0000-4000-8000-000000000001',name:'Test',phone:'+852 91234567',instagram:'',people:2,pets:1,petDetails:'Cat',notes:'',consent:true,turnstileToken:'x'.repeat(30)};
async function request(body,method='POST') {let status=200,data;const res={setHeader(){},status(n){status=n;return this;},json(d){data=d;return this;}};await handler({method,headers:{},body},res);return {status,data};}
(async()=>{
  assert.equal((await request({},'GET')).status,405);
  assert.equal((await request('{bad')).status,400);
  assert.equal((await request({type:'availability'})).data.error,'NOT_CONFIGURED');
  Object.assign(process.env,{PHOTOGRAPHY_APPS_SCRIPT_URL:'https://example.test/exec',PHOTOGRAPHY_SHARED_SECRET:'test-secret',TURNSTILE_SECRET_KEY:'test-turnstile',ALLOWED_HOSTNAME:'justforyouandmeow.com'});
  assert.equal((await request({...booking,people:0})).status,400);
  assert.equal((await request({...booking,notes:'x'.repeat(13000)})).status,413);
  global.fetch=async()=>({ok:true,json:async()=>({success:true,action:'order',hostname:'justforyouandmeow.com'})});
  assert.equal((await request(booking)).status,403);
  global.fetch=async(url)=>({ok:true,json:async()=>String(url).includes('cloudflare')?{success:true,action:'photography',hostname:'justforyouandmeow.com'}:{success:false,error:'SLOT_UNAVAILABLE'}});
  assert.equal((await request(booking)).status,409);
  global.fetch=async()=>({ok:true,json:async()=>({success:true,slots:[{id:'a',start:'2030-01-01T05:00:00Z',date:'2030-01-01',available:true,name:'private'}],secret:'private'})});
  const availability=await request({type:'availability'}); assert.equal(availability.data.secret,undefined);assert.equal(availability.data.slots[0].name,undefined);
  const start='2030-01-01T13:00:00+08:00';
  const tables={Slots:[['Slot ID','Start','Enabled'],['slot-1',start,true],['overlap','2030-01-01T13:15:00+08:00',true]],Bookings:[Array(13).fill('header')],Settings:[['Key','Value'],['priceLabel','Test price']]};
  function sheet(name){return {getLastRow:()=>tables[name].length,getLastColumn:()=>tables[name][0].length,getRange:(r,c,n)=>({getValues:()=>tables[name].slice(r-1,r-1+n),setNumberFormat(){return this;},setValues(rows){tables[name].splice(r-1,rows.length,...rows);return this;}})};}
  let locked=false;
  const context={PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='PHOTOGRAPHY_SHARED_SECRET'?'test-secret':'sheet'})},SpreadsheetApp:{openById:()=>({getSheetByName:sheet}),flush(){}},LockService:{getScriptLock:()=>({tryLock(){locked=true;return true;},hasLock:()=>locked,releaseLock(){locked=false;}})},ContentService:{createTextOutput:txt=>({setMimeType:()=>JSON.parse(txt)}),MimeType:{JSON:'json'}},Utilities:{formatDate:()=> '2030-01-01',getUuid:()=> '12345678-abcd-4000-8000-123456789abc'}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('apps-script/photography.gs','utf8'),context);
  const post=body=>context.doPost({postData:{contents:JSON.stringify({...body,apiSecret:'test-secret'})}});
  assert.equal(post({type:'availability'}).slots[0].available,true);
  assert.equal(post(booking).success,true);assert.equal(locked,false);assert.equal(tables.Bookings.length,2);
  assert.equal(post(booking).success,true);assert.equal(tables.Bookings.length,2);
  assert.equal(post({...booking,requestId:'00000000-0000-4000-8000-000000000002'}).error,'SLOT_UNAVAILABLE');
  assert.equal(post({type:'availability'}).slots[1].available,false);
  tables.Bookings[1][4]='cancelled';assert.equal(post({type:'availability'}).slots[0].available,true);
  assert.equal(context.safeCell_('=IMPORTDATA("x")')[0],"'");
  console.log('PASS: API validation, bot action, privacy, reservation, duplicate retry, overlapping slots, cancellation, formula protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
