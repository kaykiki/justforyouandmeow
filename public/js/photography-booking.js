'use strict';
(() => {
  const root = document.getElementById('meow-studio-preview');
  const $ = id => root.querySelector('#' + id);
  const form = $('ms-details');
  const times = $('ms-times');
  let slots = [], selected = null, loaded = false, loading = false, submitting = false, done = false;
  let attempt = null, token = '', widgetId = null;
  const calendar = $('ms-calendar');
  let selectedDate = null, visibleMonth = null;
  function dateLabel(date, weekday=false) {
    return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',...(weekday?{weekday:'long'}:{}),timeZone:'Asia/Hong_Kong'}).format(new Date(date+'T12:00:00+08:00'));
  }
  function bookingDates() { return [...new Set(slots.map(s=>s.date))].sort(); }
  function renderCalendar() {
    const dates=bookingDates(), months=[...new Set(dates.map(d=>d.slice(0,7)))];
    if(!visibleMonth || !months.includes(visibleMonth))visibleMonth=selectedDate?selectedDate.slice(0,7):months[0]||null;
    const index=months.indexOf(visibleMonth);
    $('ms-prev-month').disabled=!loaded || submitting || index<=0;
    $('ms-next-month').disabled=!loaded || submitting || index<0 || index>=months.length-1;
    calendar.replaceChildren();
    for(const label of ['M','T','W','T','F','S','S']){const el=document.createElement('span');el.className='ms-weekday';el.textContent=label;calendar.append(el);}
    if(!visibleMonth){$('ms-month-title').textContent=loaded?'No dates available':'Choose a date';return;}
    const [year,month]=visibleMonth.split('-').map(Number);
    $('ms-month-title').textContent=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,month-1,1)));
    calendar.setAttribute('aria-label',$('ms-month-title').textContent+' booking calendar');
    const leading=(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7;
    for(let n=0;n<leading;n++){const gap=document.createElement('span');gap.setAttribute('aria-hidden','true');calendar.append(gap);}
    const count=new Date(Date.UTC(year,month,0)).getUTCDate();
    for(let day=1;day<=count;day++){
      const date=visibleMonth+'-'+String(day).padStart(2,'0'), bookable=dates.includes(date);
      const el=document.createElement(bookable?'button':'span');el.className='ms-day';el.textContent=day;
      if(bookable){
        el.type='button';el.classList.add('ms-day-bookable');el.disabled=!loaded || submitting;
        el.setAttribute('aria-pressed',String(date===selectedDate));el.setAttribute('aria-label',dateLabel(date,true));
        if(date===selectedDate)el.classList.add('ms-day-selected');
        el.addEventListener('click',()=>{selectedDate=date;selected=null;$('ms-summary-value').textContent=dateLabel(date)+' · Select a time';renderCalendar();renderSlots();controls();});
      } else el.setAttribute('aria-label',dateLabel(date)+', not bookable');
      calendar.append(el);
    }
  }
  function moveMonth(offset){
    const months=[...new Set(bookingDates().map(d=>d.slice(0,7)))], next=months[months.indexOf(visibleMonth)+offset];
    if(next){visibleMonth=next;renderCalendar();}
  }
  $('ms-prev-month').addEventListener('click',()=>moveMonth(-1));
  $('ms-next-month').addEventListener('click',()=>moveMonth(1));
  function message(text) { $('ms-form-message').hidden=false; $('ms-form-message').textContent=text; }
  function controls() {
    $('ms-continue').disabled=!loaded || !selected || !selected.available || submitting;
    $('ms-submit-booking').disabled=submitting || !token || (!attempt && (!selected || !loaded || !selected.available));
    $('ms-back').disabled=submitting || !!attempt;
    $('ms-change-time').disabled=submitting || !!attempt;
    form.querySelectorAll('input,textarea').forEach(el=>el.disabled=submitting || !!attempt);
  }
  function renderSlots() {
    times.replaceChildren();
    const daily=slots.filter(s=>s.date===selectedDate);
    $('ms-time-date').textContent=selectedDate?dateLabel(selectedDate,true):'Select a date';
    $('ms-time-range').textContent=daily.length?daily[0].start+'–'+daily[daily.length-1].end:'';
    daily.forEach(slot=>{
      const button=document.createElement('button');button.type='button';button.className='ms-time';button.textContent=slot.start;
      button.disabled=!loaded || !slot.available || submitting;
      button.setAttribute('aria-pressed',String(selected && selected.id===slot.id || false));
      button.setAttribute('aria-label',`${slot.start} to ${slot.end}, ${slot.available?'available':'unavailable'}`);
      button.addEventListener('click',()=>{
        selected=slot;$('ms-summary-value').textContent=`${dateLabel(slot.date)} · ${slot.start}–${slot.end}`;
        renderSlots();controls();
      });
      times.append(button);
    });
  }
  async function availability() {
    if(loading || submitting || done || attempt) return;
    loading=true;
    try {
      const response=await fetch('/api/photography-booking',{cache:'no-store',signal:AbortSignal.timeout(50000)});
      const data=await response.json();
      if(!response.ok || data.success!==true || !Array.isArray(data.slots)) throw new Error('UNAVAILABLE');
      const valid=data.slots.filter(s=>typeof s.id==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.start) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.end) && s.end>s.start && new Date(`${s.date}T${s.end}:00+08:00`).getTime()>Date.now()).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
      slots=valid.map(s=>({...s,available:s.available && new Date(`${s.date}T${s.start}:00+08:00`).getTime()>Date.now()}));
      loaded=true;
      const dates=bookingDates();
      if(!selectedDate || !dates.includes(selectedDate)){
        selectedDate=dates[0]||null;
        $('ms-summary-value').textContent=selectedDate?dateLabel(selectedDate)+' · Select a time':'No sessions available';
      }
      if(selected){selected=slots.find(s=>s.id===selected.id)||null;
        if(!selected || !selected.available){$('ms-summary-value').textContent=selectedDate?dateLabel(selectedDate)+' · Select another time':'No sessions available';if(!form.hidden && !attempt)message('This time is no longer available. Change time to choose another slot.');}}
      $('ms-live-status').hidden=dates.length>0;
      $('ms-live-status').textContent=dates.length?'':'No sessions are currently available. Please check back later.';
    } catch (_) {
      loaded=false;
      $('ms-live-status').hidden=false;
      $('ms-live-status').textContent='Available times could not be loaded. Please try again shortly.';
    } finally { loading=false;renderCalendar();renderSlots();controls(); }
  }
  function resetSecurity(){token='';if(window.turnstile && widgetId!==null)window.turnstile.reset(widgetId);controls();}
  function renderSecurity(){
    if(!window.turnstile || widgetId!==null || form.hidden)return;
    widgetId=window.turnstile.render($('ms-security'),{sitekey:'0x4AAAAAADvn28RYsBENDB8b',action:'photography_booking',theme:'light',size:'normal',
      callback:value=>{token=value;controls();},'expired-callback':()=>{token='';controls();},'error-callback':()=>{token='';message('Security check could not load. Please refresh this page.');controls();}});
  }
  const securityScript=document.createElement('script');securityScript.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';securityScript.async=true;securityScript.defer=true;securityScript.onload=renderSecurity;securityScript.onerror=()=>message('Security check could not load. Please refresh this page.');document.head.append(securityScript);
  function showStep(step){
    $('ms-layout').classList.toggle('ms-selection-only',step===1);
    $('ms-layout').classList.toggle('ms-pay-only',step===3);
    $('ms-policies').hidden=step!==2;
    ['ms-step-one','ms-step-two','ms-step-three'].forEach((id,index)=>{
      if(index+1===step)$(id).setAttribute('aria-current','step');else $(id).removeAttribute('aria-current');
    });
  }
  const legalDialog=$('ms-legal-dialog');
  root.querySelectorAll('[data-ms-legal]').forEach(link=>link.addEventListener('click',event=>{
    event.preventDefault();legalDialog.showModal();
    const section=$(link.dataset.msLegal);section.scrollIntoView({block:'start'});section.focus({preventScroll:true});
  }));
  $('ms-legal-close').addEventListener('click',()=>legalDialog.close());
  legalDialog.addEventListener('click',event=>{if(event.target===legalDialog){const r=legalDialog.getBoundingClientRect();if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)legalDialog.close();}});
  $('ms-continue').addEventListener('click',()=>{
    if(!loaded || !selected || !selected.available)return;
    $('ms-selection').hidden=true;form.hidden=false;
    $('ms-detail-time').textContent=`${dateLabel(selected.date,true)} · ${selected.start}–${selected.end}`;
    showStep(2);
    renderSecurity();controls();form.elements.guestName.focus({preventScroll:true});
  });
  function changeTime(){
    if(attempt || submitting)return;
    form.hidden=true;$('ms-selection').hidden=false;showStep(1);
    availability();$('ms-continue').focus({preventScroll:true});
  }
  $('ms-back').addEventListener('click',changeTime);
  $('ms-change-time').addEventListener('click',changeTime);
  form.addEventListener('submit',e=>{e.preventDefault();submit();});
  $('ms-submit-booking').addEventListener('click',submit);
  form.elements.guestName.addEventListener('input',()=>form.elements.guestName.setCustomValidity(''));
  async function submit() {
    if(submitting || !token || (!attempt && (!selected || !loaded || !selected.available)))return;
    if(!attempt){
      form.elements.guestName.setCustomValidity(form.elements.guestName.value.trim()?'':'Please enter your name.');
      const people=Number(form.elements.people.value),pets=Number(form.elements.pets.value);
      if(!form.reportValidity())return;
      if(!form.elements.consent.checked){message('Please read and agree to the Terms & Conditions and Privacy Notice.');return;}
      if(!Number.isInteger(people) || people<0 || people>2 || !Number.isInteger(pets) || pets<0 || pets>2){message('Each session allows a maximum of 2 people and 2 pets.');return;}
      if(people+pets<1){message('Please include at least one person or pet.');return;}
      if(!form.elements.instagram.value.trim() || !form.elements.phone.value.trim()){message('Please enter your Instagram and phone number.');return;}
      attempt={requestId:crypto.randomUUID(),slotId:selected.id,name:form.elements.guestName.value.trim(),email:form.elements.email.value.trim().toLowerCase(),phone:form.elements.phone.value.trim(),instagram:form.elements.instagram.value.trim(),people,pets,consent:form.elements.consent.checked};
    }
    submitting=true;controls();message('Sending your booking request…');
    $('ms-submit-booking').textContent='Sending…';
    try {
      const response=await fetch('/api/photography-booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...attempt,turnstileToken:token}),signal:AbortSignal.timeout(60000)});
      const data=await response.json();
      if(response.ok && data.success===true){
        done=true;form.hidden=true;$('ms-live-status').hidden=true;$('ms-receipt').hidden=false;
        showStep(3);
        $('ms-receipt-id').textContent=data.bookingId;
        $('ms-receipt-guests').textContent=`${attempt.people} people / ${attempt.pets} pets`;
        $('ms-receipt-time').textContent=`${dateLabel(data.date)} · ${data.start}–${data.end}`;
        $('ms-receipt-status').textContent=data.status==='Confirmed'?'Status: Confirmed':data.status==='Cancelled'?'Status: Cancelled. This reference has been cancelled.':'Status: Pending — your time is held while we confirm the details. Payment has not been collected.';
        $('ms-fps-section').hidden=data.status==='Cancelled';
        $('ms-pay-intro').textContent=data.status==='Cancelled'?'This booking has been cancelled. Please contact us if you need help.':data.status==='Confirmed'?'Your booking is confirmed. Pay only the amount we have confirmed with you.':'Your booking request has been received. Please wait for us to confirm the price and photo inclusions before paying.';
        $('ms-receipt-title').textContent=data.status==='Cancelled'?'Booking cancelled':'Pay';
        $('ms-receipt-title').focus();
        return;
      }
      if(['SLOT_UNAVAILABLE','INVALID_DETAILS','BOT_CHECK_FAILED','REQUEST_ID_CONFLICT'].includes(data.error)) {
        attempt=null;
        message(data.error==='SLOT_UNAVAILABLE'?'This time was just booked or blocked. Change time to choose another slot.':data.error==='BOT_CHECK_FAILED'?'Please complete the security check again.':'Please check your booking details and try again.');
      } else {message('The result could not be confirmed. Please retry below with the same details; a retry will not create a duplicate request.');}
    } catch (_) {message('The result could not be confirmed. Please retry below with the same details; a retry will not create a duplicate request.');}
    finally {submitting=false;$('ms-submit-booking').textContent=attempt?'Retry booking request':'Submit booking request';resetSecurity();if(!done)await availability();}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)availability();});
  setInterval(()=>{if(!document.hidden && !attempt)availability();},30000);
  availability();
})();


