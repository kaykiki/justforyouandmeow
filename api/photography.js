const MAX_BYTES = 12000;
const errors = new Set(['SLOT_UNAVAILABLE', 'INVALID_REQUEST', 'BUSY']);
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({success:false,error:'METHOD_NOT_ALLOWED'}); }
  try {
    if (Number(req.headers['content-length'] || 0) > MAX_BYTES) return res.status(413).json({success:false,error:'REQUEST_TOO_LARGE'});
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch (_) { return res.status(400).json({success:false,error:'INVALID_REQUEST'}); }
    if (!body || !['availability','booking'].includes(body.type)) return res.status(400).json({success:false,error:'INVALID_REQUEST'});
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BYTES) return res.status(413).json({success:false,error:'REQUEST_TOO_LARGE'});
    const env = process.env;
    if (!env.PHOTOGRAPHY_APPS_SCRIPT_URL || !env.PHOTOGRAPHY_SHARED_SECRET) return res.status(503).json({success:false,error:'NOT_CONFIGURED'});
    let payload = {type:body.type};
    if (body.type === 'booking') {
      if (!validBooking(body)) return res.status(400).json({success:false,error:'INVALID_REQUEST'});
      if (!env.TURNSTILE_SECRET_KEY || !env.ALLOWED_HOSTNAME) return res.status(503).json({success:false,error:'NOT_CONFIGURED'});
      if (typeof body.turnstileToken !== 'string' || body.turnstileToken.length < 20 || body.turnstileToken.length > 2048) return res.status(403).json({success:false,error:'BOT_CHECK_FAILED'});
      const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:body.turnstileToken}),signal:AbortSignal.timeout(8000)});
      const result = verification.ok ? await verification.json() : {};
      if (!result.success || result.action !== 'photography' || !env.ALLOWED_HOSTNAME.split(',').map(s => s.trim()).includes(result.hostname)) return res.status(403).json({success:false,error:'BOT_CHECK_FAILED'});
      for (const key of ['slotId','requestId','name','phone','instagram','people','pets','petDetails','notes','consent']) payload[key] = body[key];
    }
    payload.apiSecret = env.PHOTOGRAPHY_SHARED_SECRET;
    const upstream = await fetch(env.PHOTOGRAPHY_APPS_SCRIPT_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),redirect:'follow',signal:AbortSignal.timeout(15000)});
    if (!upstream.ok) throw new Error('UPSTREAM');
    const data = await upstream.json();
    if (!data.success) return res.status(data.error === 'SLOT_UNAVAILABLE' ? 409 : 400).json({success:false,error:errors.has(data.error) ? data.error : 'SERVER_ERROR'});
    // Return only public schedule data or this request's receipt; never sheet rows.
    if (body.type === 'availability') return res.status(200).json({success:true,slots:(data.slots || []).map(s=>({id:s.id,start:s.start,date:s.date,available:s.available === true})),priceLabel:data.priceLabel || '',location:data.location || '',description:data.description || ''});
    if (!data.reference || !data.start) throw new Error('INVALID_RECEIPT');
    return res.status(200).json({success:true,reference:data.reference,start:data.start,status:'pending'});
  } catch (_) { return res.status(503).json({success:false,error:'SERVER_ERROR'}); }
};
function validBooking(b) {
  const str = (key,max,required=false) => typeof b[key] === 'string' && b[key].length <= max && (!required || b[key].trim().length > 0);
  return str('slotId',100,true) && str('requestId',36,true) && /^[0-9a-f-]{36}$/i.test(b.requestId) && str('name',80,true) && str('phone',30,true) && /^\+?[0-9 ()-]{8,30}$/.test(b.phone) && str('instagram',80) && str('petDetails',1000,b.pets>0) && str('notes',1000) && Number.isInteger(b.people) && b.people>=1 && b.people<=99 && Number.isInteger(b.pets) && b.pets>=0 && b.pets<=99 && b.consent===true;
}
module.exports.config = {maxDuration:30,api:{bodyParser:{sizeLimit:'12kb'}}};
