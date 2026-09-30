(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let slots = [], selected = null, token = '', widget = null, submitting = false;
  let attempt = null;
  const dateLabel = start => new Intl.DateTimeFormat('zh-HK', {timeZone:'Asia/Hong_Kong',month:'long',day:'numeric',weekday:'short'}).format(new Date(start));
  const timeLabel = start => new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Hong_Kong',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(start));
  const slotLabel = slot => `${timeLabel(slot.start)} – ${timeLabel(new Date(Date.parse(slot.start) + 30 * 60000))}`;
  async function api(payload) {
    const response = await fetch('/api/photography', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(25000)});
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'SERVER_ERROR');
    return data;
  }
  function error(message) { $('form-error').textContent = message; $('form-error').hidden = false; }
  function renderSlots() {
    selected = null; $('slots').replaceChildren(); $('recap').textContent = '尚未選擇拍攝時段';
    slots.filter(slot => slot.date === $('date').value).forEach(slot => {
      const label = document.createElement('label'); label.className = 'slot';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'slot'; input.value = slot.id; input.required = true; input.disabled = !slot.available;
      const text = document.createElement('span'); text.textContent = slotLabel(slot) + (slot.available ? '' : ' · 已滿');
      input.addEventListener('change', () => { selected = slot; $('recap').textContent = `${dateLabel(slot.start)} · ${slotLabel(slot)}（香港時間）`; });
      label.append(input, text); $('slots').append(label);
    });
  }
  async function loadAvailability() {
    $('reload').hidden = true; $('availability-status').hidden = false; $('availability-status').textContent = '正在讀取可預約時段…'; $('booking-form').hidden = true;
    try {
      const data = await api({type:'availability'}); slots = data.slots || [];
      $('price-label').textContent = data.priceLabel || '待公布'; $('location-label').textContent = data.location || '待公布';
      if (data.description) $('session-description').textContent = data.description;
      if (!slots.some(slot => slot.available)) { $('availability-status').textContent = '暫未有可預約時段，請稍後再查看，或透過 Instagram 聯絡我們。'; $('reload').hidden = false; return; }
      $('date').replaceChildren(new Option('請選擇日期', ''));
      [...new Set(slots.map(slot => slot.date))].forEach(date => {
        const matching = slots.filter(slot => slot.date === date), available = matching.some(slot => slot.available);
        const option = new Option(dateLabel(matching[0].start) + (available ? '' : ' · 已滿'),date); option.disabled = !available; $('date').append(option);
      });
      renderSlots(); $('availability-status').hidden = true; $('booking-form').hidden = false; loadSecurity();
    } catch (e) {
      $('availability-status').textContent = e.message === 'NOT_CONFIGURED' ? '攝影預約即將開放。開放日期及拍攝詳情會稍後公布。' : '暫時未能讀取時段，請重試，或透過 Instagram 聯絡我們。';
      $('reload').hidden = false;
    }
  }
  function loadSecurity() {
    if (window.turnstile) { renderSecurity(); return; }
    if (document.getElementById('turnstile-script')) return;
    $('security-status').textContent = '正在載入安全驗證…';
    const script = document.createElement('script'); script.id = 'turnstile-script'; script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
    script.onload = renderSecurity; script.onerror = () => { script.remove(); $('security-status').textContent = '未能載入安全驗證，請重新整理頁面。'; }; document.head.append(script);
  }
  function renderSecurity() {
    if (widget !== null) return;
    widget = window.turnstile.render('#turnstile-widget', {sitekey:'0x4AAAAAADvn28RYsBENDB8b',action:'photography',theme:'light',callback:value => {token = value; $('security-status').textContent = '';},'expired-callback':() => {token = '';},'error-callback':() => {token = ''; $('security-status').textContent = '安全驗證未能完成，請重新整理頁面。';}});
  }
  $('date').addEventListener('change', renderSlots);
  $('pets').addEventListener('input', () => { const hasPets = Number($('pets').value) > 0; $('pet-field').hidden = !hasPets; $('petDetails').required = hasPets; });
  $('reload').addEventListener('click', loadAvailability);
  $('booking-form').addEventListener('submit', async event => {
    event.preventDefault(); if (submitting) return; $('form-error').hidden = true;
    if (!selected) {error('請先選擇拍攝時段。'); return;}
    if (!token) {error('請先完成安全驗證。'); return;}
    const payload = {type:'booking',slotId:selected.id,consent:$('consent').checked};
    ['name','phone','instagram','petDetails','notes'].forEach(key => payload[key] = $(key).value.trim());
    ['people','pets'].forEach(key => payload[key] = Number($(key).value));
    if (!payload.pets) payload.petDetails = '';
    const signature = JSON.stringify(payload);
    if (!attempt || attempt.signature !== signature) attempt = {signature,id:crypto.randomUUID()};
    payload.requestId = attempt.id; payload.turnstileToken = token;
    submitting = true; $('submit').disabled = true; $('submit').textContent = '正在提交…';
    try {
      const data = await api(payload);
      $('booking-reference').textContent = data.reference;
      $('booking-time').textContent = `${dateLabel(data.start)} · ${slotLabel({start:data.start})}`;
      $('booking-form').hidden = true; $('success').hidden = false; $('success').focus();
    } catch (e) {
      if (e.message === 'SLOT_UNAVAILABLE') { attempt = null; await loadAvailability(); if ($('booking-form').hidden) { $('availability-status').textContent = '這個時段剛剛已被預約，暫未有其他可預約時段。請稍後再查看。'; } else { error('這個時段剛剛已被預約，請選擇其他時段。'); } }
      else error(e.message === 'BOT_CHECK_FAILED' ? '安全驗證已過期，請重新驗證後提交。' : '未能確認留位結果，請重試。重試相同資料不會重複留位；如持續出現問題，請透過 Instagram 聯絡我們。');
      if (window.turnstile && widget !== null) window.turnstile.reset(widget); token = '';
    } finally { submitting = false; $('submit').disabled = false; $('submit').textContent = '提交留位申請 ↗'; }
  });
  loadAvailability();
})();
