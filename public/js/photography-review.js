'use strict';
function setupPhotographyReview(notify) {
const el = id => document.getElementById(id);
let language = 'en', locked = false, showHighlights = false, sections = [];
const view={
zh:{title:"預約前請留意",cancel:"取消及退款",reschedule:"預約確認後不設改期。取消日數以香港日期計算。",refunds:[["提前 10 日或以上","全額退款"],["提前 4 至 9 日","退回 50%"],["提前 3 日或以內，或缺席","不設退款"]],exception:"如有其他客人以原價補位並完成付款，或由我們取消整個預約，均會全額退款。",other:[["遲到安排","只可使用餘下時間，拍攝會按原定時間結束。"],["相片交付","15 張數碼相於拍攝後 25 至 30 個工作天交付，下載連結有效 30 日。"]],expand:"閱讀完整預約條款（10 項）",send:"提交預約申請"},
en:{title:"Before you book",cancel:"Cancellations & refunds",reschedule:"Confirmed bookings cannot be rescheduled. We count days using Hong Kong dates.",refunds:[["10 or more days before","Full refund"],["4–9 days before","50% refund"],["3 days or less, or a no-show","No refund"]],exception:"You will receive a full refund if another customer pays the full original price for your slot, or if we cancel your entire booking.",other:[["Late arrival","We will use the time remaining and finish at the original end time."],["Photo delivery","Your 15 digital photos arrive in 25–30 working days. The download link is valid for 30 days."]],expand:"Read all 10 booking terms",send:"Submit booking request"}};
const pad = el("signature-pad");
const typedName = el("signature-name");
const strokes = [];
let typing = false;
let activePointer = null;
let currentStroke = [];

function hasSignature() {
  return typing ? typedName.value.trim().length > 0 : strokes.length > 0;
}
function renderSignature() {
  const zh = language === "zh";
  el("signature-label").textContent = zh ? "預約人簽名" : "Your signature";
  const drawHint = zh ? "請用手指或滑鼠簽名。" : "Sign below with your finger or mouse.";
  const typeHint = zh ? "請輸入姓名作為簽名。" : "Type your name as your signature.";
  el("signature-help").textContent = typing ? typeHint : drawHint;
  el("signature-mode").textContent = typing ? (zh ? "改用手寫簽名" : "Draw instead") : (zh ? "改用輸入姓名" : "Type instead");
  el("signature-clear").textContent = zh ? "清除簽名" : "Clear signature";
  pad.hidden = typing;
  typedName.hidden = !typing;
}
function redraw() {
  if (typing) return;
  const rect = pad.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (pad.width !== width || pad.height !== height) {
    pad.width = width;
    pad.height = height;
  }
  const ctx = pad.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111";
  for (const stroke of [...strokes, currentStroke]) {
    if (!stroke.length) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x * rect.width, stroke[0].y * rect.height);
    for (const point of stroke.slice(1)) ctx.lineTo(point.x * rect.width, point.y * rect.height);
    ctx.stroke();
  }
}
function point(event) {
  const rect = pad.getBoundingClientRect();
  return {x:(event.clientX - rect.left) / rect.width, y:(event.clientY - rect.top) / rect.height};
}
function changed() { notify(); }
pad.addEventListener("pointerdown", event => {
  if (locked || activePointer !== null || event.button !== 0) return;
  pad.setPointerCapture(event.pointerId);
  activePointer = event.pointerId;
  currentStroke = [point(event)];
  changed();
});
pad.addEventListener("pointermove", event => {
  if (event.pointerId !== activePointer) return;
  currentStroke.push(point(event));
  redraw();
});
pad.addEventListener("pointerup", event => {
  if (event.pointerId !== activePointer) return;
  currentStroke.push(point(event));
  if (currentStroke.some(p => p.x !== currentStroke[0].x || p.y !== currentStroke[0].y)) strokes.push(currentStroke);
  finishStroke();
});
function finishStroke() {
  currentStroke = [];
  activePointer = null;
  redraw();
  changed();
}
pad.addEventListener("lostpointercapture", event => {
  if (event.pointerId === activePointer) finishStroke();
});
new ResizeObserver(redraw).observe(pad);
typedName.addEventListener("input", changed);
el("signature-clear").onclick = () => {
  strokes.length = 0;
  typedName.value = "";
  finishStroke();
};
el("signature-mode").onclick = () => {
  typing = !typing;
  renderSignature();
  redraw();
  changed();
  if (typing) typedName.focus();
};

function node(tag,text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function render() {
  const zh = language === 'zh', t = view[language];
  const topic = zh ? 'topicZh' : 'topicEn', body = zh ? 'textZh' : 'textEn';
  el('ms-review').lang = zh ? 'zh-HK' : 'en';
  el('review-package').lang = el('ms-review').lang;
  el('ms-review-title').textContent = t.title;
  el('lang').textContent = zh ? 'English' : '繁中';
  el('lang').lang = zh ? 'en' : 'zh-HK';
  for (const id of ['cancel','reschedule','exception','expand']) el(id).textContent=t[id];
  el('refunds').replaceChildren(...t.refunds.map(entry=>{
    const row=document.createElement('tr');
    row.append(...entry.map(value=>node('td',value)));
    return row;
  }));
  el('other').replaceChildren(...t.other.map(([title, text])=>{
    const block=document.createElement('div'); block.className='ms-policy-block';
    block.append(node('h3',title),node('p',text)); return block;
  }));
  const confirmation=sections.find(s=>s.topicEn==='Booking terms');
  const policies=sections.filter(s=>s!==confirmation);
  el('cancel').closest('section').hidden = !showHighlights;
  el('other').hidden = !showHighlights;
  el('expand').textContent=zh?'完整預約條款':'Full booking terms';
  el('sections').replaceChildren(...policies.map(s=>{
    const article=document.createElement('article');
    article.append(node('h2',s[topic]),node('p',s[body])); return article;
  }));
  el('consent').textContent=confirmation?.[body] || (zh?'我已閱讀並同意預約條款，包括取消、遲到、退款及照片使用安排。':'I have read and agree to the booking terms, including the arrangements for cancellations, late arrivals, refunds and use of photos.');
  const pack=sections.find(s=>s.topicEn==='Pet & family photography package');
  el('package-label').textContent=zh?'套餐內容':'Your package';
  el('package-title').textContent=pack?.[topic] || '';
  el('package-content').textContent=pack?.[body] || '';
  el('people-label').textContent=zh?'參與人數':'People & pets';
  el('people-content').textContent=zh?'每節最多 2 位家長及 2 隻毛孩。':'Up to 2 people and 2 pets per session.';
  el('confirm-label').textContent=zh?'預約確認':'Confirmation';
  el('confirm-content').textContent=zh?'收到我們發出的確認通知後，預約才算完成。':'Your booking is confirmed once you receive our confirmation notice.';
  el('ms-review-back').textContent=zh?'返回':'Back';
  renderSignature();
  notify();
}
function reset() {
  el('agree').checked=false;
  typedName.value='';
  strokes.length=0;
  finishStroke();
}
function value() {
  if (!hasSignature()) return null;
  if (typing) return {type:'typed',name:typedName.value.trim()};
  const small=document.createElement('canvas');
  small.width=320; small.height=80;
  const ctx=small.getContext('2d');
  ctx.lineWidth=1.6; ctx.lineCap='round'; ctx.lineJoin='round';
  for (const stroke of strokes) {
    ctx.beginPath();
    ctx.moveTo(stroke[0].x*320,stroke[0].y*80);
    for (const point of stroke.slice(1)) ctx.lineTo(point.x*320,point.y*80);
    ctx.stroke();
  }
  const pixels=ctx.getImageData(0,0,320,80).data, mask=new Uint8Array(3200);
  for (let i=0;i<320*80;i++) if(pixels[i*4+3]>=32) mask[i>>3] |= 128>>(i%8);
  return {type:'drawn',ink:btoa(String.fromCharCode(...mask))};
}
el('agree').addEventListener('change',notify);
el('lang').onclick=()=>{ language=language==='en'?'zh':'en'; render(); };
return {
  render,reset,value,hasSignature,
  setTerms(data){
    sections=data?.sections || [];
    showHighlights=data?.showHighlights === true;
    el('expand').closest('details').open = true;
    reset();render();
  },
  submitLabel(retry,sending) {
    if(sending)return language==='en'?'Sending…':'提交中…';
    if(retry)return language==='en'?'Retry booking request':'重新提交預約';
    return view[language].send;
  },
  lock(state) {
    locked=state; el('signature-mode').disabled=locked;
    el('signature-clear').disabled=locked || !hasSignature();
  }
};
}
