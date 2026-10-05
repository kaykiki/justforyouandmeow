'use strict';
(() => {
  const root = document.getElementById('meow-studio-preview');
  const $ = id => root.querySelector('#' + id);
  const form = $('ms-details');
  const times = $('ms-times');
  let slots = [], selected = null, loaded = false, loading = false, submitting = false, done = false;
  let attempt = null, token = '', widgetId = null;
  const calendar = $('ms-calendar');
  const gap = document.createElement('span'); gap.setAttribute('aria-hidden','true'); calendar.append(gap);
  for (let day=1; day<=31; day++) {
    const el=document.createElement(day===19?'button':'span'); el.className='ms-day'; el.textContent=day;
    if(day===19){el.type='button';el.classList.add('ms-day-selected');el.setAttribute('aria-pressed','true');el.setAttribute('aria-label','Saturday 19 December 2026, selected');}
    else el.setAttribute('aria-label',`${day} December, not bookable`);
    calendar.append(el);
  }
  function message(text) { $('ms-form-message').hidden=false; $('ms-form-message').textContent=text; }
  function controls() {
    $('ms-continue').disabled=!loaded || !selected || !selected.available || submitting;
    $('ms-submit-booking').disabled=submitting || !token || (!attempt && (!selected || !loaded || !selected.available));
    $('ms-back').disabled=submitting || !!attempt;
    form.querySelectorAll('input,textarea').forEach(el=>el.disabled=submitting || !!attempt);
  }
  function renderSlots() {
    times.replaceChildren();
    slots.forEach(slot=>{
      const button=document.createElement('button');button.type='button';button.className='ms-time';button.textContent=slot.start;
      button.disabled=!loaded || !slot.available || submitting;
      button.setAttribute('aria-pressed',String(selected && selected.id===slot.id || false));
      button.setAttribute('aria-label',`${slot.start} to ${slot.end}, ${slot.available?'available':'unavailable'}`);
      button.addEventListener('click',()=>{
        selected=slot;$('ms-summary-value').textContent=`19 December 2026 · ${slot.start}–${slot.end}`;
        renderSlots();controls();
      });
      times.append(button);
    });
  }
  async function availability() {
    if(loading || submitting || done || attempt) return;
    loading=true;
    try {
      const response=await fetch('/api/photography-booking',{cache:'no-store',signal:AbortSignal.timeout(30000)});
      const data=await response.json();
      if(!response.ok || data.success!==true || !Array.isArray(data.slots)) throw new Error('UNAVAILABLE');
      const valid=data.slots.filter(s=>s.date==='2026-12-19' && /^\d{2}:\d{2}$/.test(s.start) && /^\d{2}:\d{2}$/.test(s.end));
      slots=valid.map(s=>({...s,available:s.available && new Date(`${s.date}T${s.start}:00+08:00`).getTime()>Date.now()}));
      loaded=true;
      if(selected){selected=slots.find(s=>s.id===selected.id)||null;
        if(!selected || !selected.available){$('ms-summary-value').textContent='19 December 2026 · Select another time';if(!form.hidden && !attempt)message('This time is no longer available. Change time to choose another slot.');}}
      $('ms-live-status').textContent='Availability updated. Each session is 30 minutes.';
    } catch (_) {
      loaded=false;
      $('ms-live-status').textContent='Availability could not be loaded. Please refresh availability or try again later.';
    } finally { loading=false;renderSlots();controls(); }
  }
  function resetSecurity(){token='';if(window.turnstile && widgetId!==null)window.turnstile.reset(widgetId);controls();}
  function renderSecurity(){
    if(!window.turnstile || widgetId!==null || form.hidden)return;
    widgetId=window.turnstile.render($('ms-security'),{sitekey:'0x4AAAAAADvn28RYsBENDB8b',action:'photography_booking',theme:'light',size:'compact',
      callback:value=>{token=value;controls();},'expired-callback':()=>{token='';controls();},'error-callback':()=>{token='';message('Security check could not load. Please refresh this page.');controls();}});
  }
  const securityScript=document.createElement('script');securityScript.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';securityScript.async=true;securityScript.defer=true;securityScript.onload=renderSecurity;securityScript.onerror=()=>message('Security check could not load. Please refresh this page.');document.head.append(securityScript);
  $('ms-continue').addEventListener('click',()=>{
    if(!loaded || !selected || !selected.available)return;
    $('ms-selection').hidden=true;form.hidden=false;
    $('ms-detail-time').textContent=`Saturday, 19 December · ${selected.start}–${selected.end}`;
    $('ms-step-one').removeAttribute('aria-current');$('ms-step-two').setAttribute('aria-current','step');
    renderSecurity();controls();form.elements.guestName.focus({preventScroll:true});
  });
  $('ms-back').addEventListener('click',()=>{
    if(attempt || submitting)return;
    form.hidden=true;$('ms-selection').hidden=false;$('ms-step-two').removeAttribute('aria-current');$('ms-step-one').setAttribute('aria-current','step');
    availability();$('ms-continue').focus({preventScroll:true});
  });
  form.addEventListener('submit',e=>{e.preventDefault();submit();});
  $('ms-submit-booking').addEventListener('click',submit);
  form.elements.guestName.addEventListener('input',()=>form.elements.guestName.setCustomValidity(''));
  async function submit() {
    if(submitting || !token || (!attempt && (!selected || !loaded || !selected.available)))return;
    if(!attempt){
      form.elements.guestName.setCustomValidity(form.elements.guestName.value.trim()?'':'Please enter your name.');
      const people=Number(form.elements.people.value),pets=Number(form.elements.pets.value);
      if(!form.reportValidity())return;
      if(people+pets<1){message('Please include at least one person or pet.');return;}
      attempt={requestId:crypto.randomUUID(),slotId:selected.id,name:form.elements.guestName.value.trim(),email:form.elements.email.value.trim().toLowerCase(),phone:form.elements.phone.value.trim(),instagram:form.elements.instagram.value.trim(),people,pets,notes:form.elements.notes.value.trim(),consent:form.elements.consent.checked};
    }
    submitting=true;controls();message('Sending your booking request…');
    $('ms-submit-booking').textContent='Sending…';
    try {
      const response=await fetch('/api/photography-booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...attempt,turnstileToken:token}),signal:AbortSignal.timeout(35000)});
      const data=await response.json();
      if(response.ok && data.success===true){
        done=true;form.hidden=true;$('ms-live-status').hidden=true;$('ms-refresh').hidden=true;$('ms-receipt').hidden=false;
        $('ms-receipt-id').textContent=`Reference: ${data.bookingId}`;
        $('ms-receipt-time').textContent=`19 December 2026 · ${data.start}–${data.end}`;
        $('ms-receipt-status').textContent=data.status==='Confirmed'?'Status: Confirmed':data.status==='Cancelled'?'Status: Cancelled. This reference has been cancelled.':'Status: Pending — your time is held while we confirm the details. Payment has not been collected.';
        $('ms-receipt-title').textContent=data.status==='Cancelled'?'Booking cancelled':'Booking request received';
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
  $('ms-refresh').addEventListener('click',availability);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)availability();});
  setInterval(()=>{if(!document.hidden && !attempt)availability();},30000);
  availability();
})();
