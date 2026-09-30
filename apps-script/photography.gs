/** Separate Apps Script project. Do NOT replace the existing order script.
 * Script properties: SPREADSHEET_ID and PHOTOGRAPHY_SHARED_SECRET.
 * Run setupPhotography once. Publish as Web App, execute as owner, access Anyone.
 * The secret is checked before reading any spreadsheet. */
function setupPhotography() {
  var ss = photographySheet_();
  [['Slots',['Slot ID','Start (ISO +08:00)','Enabled']],
   ['Bookings',['Reference','Request ID','Slot ID','Start','Status','Created at','Name','Phone','Instagram','People','Pets','Pet details','Notes']],
   ['Settings',['Key','Value']]].forEach(function(def) {
    var sheet = ss.getSheetByName(def[0]) || ss.insertSheet(def[0]);
    if (sheet.getLastRow() === 0) { sheet.appendRow(def[1]); sheet.setFrozenRows(1); }
  });
  var settings = ss.getSheetByName('Settings');
  if (settings.getLastRow() === 1) settings.getRange(2,1,3,2).setValues([['priceLabel','待公布'],['location','待公布'],['description','選擇日期及時段，提交後先留位，再由我們聯絡你確認拍攝安排。']]);
}
/** Fill in confirmed dates, then run once. Existing slot IDs are preserved. */
function addPhotographySlots() {
  var dates = []; // e.g. ['2026-12-19']; leave empty until dates are confirmed.
  var openingHour = 13, closingHour = 19;
  var sheet = photographySheet_().getSheetByName('Slots');
  var existing = rows_(sheet).map(function(r){return String(r[0]);});
  dates.forEach(function(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use YYYY-MM-DD dates');
    for(var minute=openingHour*60; minute+30<=closingHour*60; minute+=30) {
      var time = ('0'+Math.floor(minute/60)).slice(-2)+':'+('0'+minute%60).slice(-2);
      var start = date+'T'+time+':00+08:00', id = 'PHOTO-'+date+'-'+time.replace(':','');
      if (existing.indexOf(id) === -1) { sheet.appendRow([id,start,true]); existing.push(id); }
    }
  });
}
function doPost(e) {
  var lock = null;
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('PHOTOGRAPHY_SHARED_SECRET');
    if (!secret || body.apiSecret !== secret) return json_({success:false,error:'UNAUTHORIZED'});
    if (['availability','booking'].indexOf(body.type) === -1) return json_({success:false,error:'INVALID_REQUEST'});
    if (body.type === 'booking' && !validBooking_(body)) return json_({success:false,error:'INVALID_REQUEST'});
    var ss = photographySheet_();
    if (body.type === 'booking') {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(5000)) return json_({success:false,error:'BUSY'});
    }
    var bookings = rows_(ss.getSheetByName('Bookings'));
    if (body.type === 'booking') {
      var prior = bookings.filter(function(r){return String(r[1]) === body.requestId;})[0];
      if (prior) {
        if (String(prior[4]).toLowerCase() === 'cancelled') return json_({success:false,error:'SLOT_UNAVAILABLE'});
        if (String(prior[2]) !== body.slotId) return json_({success:false,error:'INVALID_REQUEST'});
        return json_({success:true,reference:String(prior[0]),start:new Date(prior[3]).toISOString(),status:'pending'});
      }
    }
    var used = {}, occupied = [];
    bookings.forEach(function(r){ if (String(r[4]).toLowerCase() !== 'cancelled') { used[String(r[2])] = true; occupied.push(new Date(r[3]).getTime()); } });
    var seen = {};
    var slots = rows_(ss.getSheetByName('Slots')).filter(function(r){return r[2]===true || String(r[2]).toLowerCase()==='true';}).map(function(r) {
      var start = new Date(r[1]);
      if (!r[0] || seen[String(r[0])] || isNaN(start.getTime()) || start.getTime()<=Date.now()) return null;
      seen[String(r[0])] = true;
      return {id:String(r[0]),start:start.toISOString(),date:Utilities.formatDate(start,'Asia/Hong_Kong','yyyy-MM-dd'),available:!used[String(r[0])] && !occupied.some(function(t){return Math.abs(t-start.getTime()) < 30*60000;})};
    }).filter(Boolean).sort(function(a,b){return a.start.localeCompare(b.start);});
    if (body.type === 'availability') {
      var settings = {};
      rows_(ss.getSheetByName('Settings')).forEach(function(r){settings[String(r[0])] = String(r[1]);});
      return json_({success:true,slots:slots,priceLabel:settings.priceLabel || '',location:settings.location || '',description:settings.description || ''});
    }
    var slot = slots.filter(function(s){return s.id===body.slotId && s.available;})[0];
    if (!slot) return json_({success:false,error:'SLOT_UNAVAILABLE'});
    var reference = 'PHOTO-'+Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase();
    var row = [reference,body.requestId,slot.id,slot.start,'pending',new Date().toISOString(),safeCell_(body.name),safeCell_(body.phone),safeCell_(body.instagram),body.people,body.pets,safeCell_(body.petDetails),safeCell_(body.notes)];
    var sheet = ss.getSheetByName('Bookings');
    var target = sheet.getRange(sheet.getLastRow()+1,1,1,row.length);
    target.setNumberFormat('@'); target.setValues([row]); SpreadsheetApp.flush();
    return json_({success:true,reference:reference,start:slot.start,status:'pending'});
  } catch (_) { return json_({success:false,error:'SERVER_ERROR'}); }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
function photographySheet_() {return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));}
function rows_(sheet) {if (!sheet) throw new Error('Run setupPhotography'); return sheet.getLastRow()<2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();}
function json_(value) {return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function safeCell_(value) {var text=String(value || ''); return /^[=+\-@\t\r\n]/.test(text) ? "'"+text : text;}
function validBooking_(b) {
  var string = function(key,max,required){return typeof b[key]==='string' && b[key].length<=max && (!required || b[key].trim().length>0);};
  return string('slotId',100,true) && string('requestId',36,true) && /^[0-9a-f-]{36}$/i.test(b.requestId) && string('name',80,true) && string('phone',30,true) && /^\+?[0-9 ()-]{8,30}$/.test(b.phone) && string('instagram',80) && string('petDetails',1000,b.pets>0) && string('notes',1000) && Number.isInteger(b.people) && b.people>=1 && b.people<=99 && Number.isInteger(b.pets) && b.pets>=0 && b.pets<=99 && b.consent===true;
}
