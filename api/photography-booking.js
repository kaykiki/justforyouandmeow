'use strict';
const HOSTS = new Set(['justforyouandmeow.com', 'www.justforyouandmeow.com', 'justforyouandmeow.vercel.app']);
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Photography-API-Version', '2026-10-05.3');
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({success:false,error:'METHOD_NOT_ALLOWED'}); }
  try {
    const endpoint = (process.env.PHOTOGRAPHY_APPS_SCRIPT_URL || '').trim();
    const secret = (process.env.BOOKING_API_SECRET || '').trim();
    const turnstileSecret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
    const missing = [];
    if (!endpoint) missing.push('PHOTOGRAPHY_APPS_SCRIPT_URL');
    if (!secret) missing.push('BOOKING_API_SECRET');
    // Reading public slots does not need a Turnstile token; every booking still does.
    if (req.method === 'POST' && !turnstileSecret) missing.push('TURNSTILE_SECRET_KEY');
    if (missing.length) return res.status(503).json({success:false,error:'NOT_CONFIGURED',missing});
    let parsed;
    try { parsed = new URL(endpoint); }
    catch (_) { return res.status(503).json({success:false,error:'INVALID_APPS_SCRIPT_URL'}); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com' || parsed.port || parsed.username || parsed.password || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(parsed.pathname)) return res.status(503).json({success:false,error:'INVALID_APPS_SCRIPT_URL'});
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    parsed.search = ''; parsed.hash = '';
    let payload = {type:'availability'};
    if (req.method === 'POST') {
      if (Number(req.headers['content-length'] || 0) > 12000) return res.status(413).json({success:false,error:'INVALID_REQUEST'});
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!b || Buffer.byteLength(JSON.stringify(b),'utf8') > 12000 || typeof b.turnstileToken !== 'string' || !b.turnstileToken || b.turnstileToken.length > 2048) return res.status(400).json({success:false,error:'INVALID_REQUEST'});
      if (!Number.isInteger(b.people) || b.people < 0 || b.people > 2 || !Number.isInteger(b.pets) || b.pets < 0 || b.pets > 2 || b.people + b.pets < 1 || typeof b.instagram !== 'string' || !/^@?[A-Za-z0-9._]{1,30}$/.test(b.instagram.trim()) || typeof b.phone !== 'string' || !b.phone.trim() || b.phone.trim().length > 40) return res.status(400).json({success:false,error:'INVALID_DETAILS'});
      const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method:'POST', body:new URLSearchParams({secret:turnstileSecret,response:b.turnstileToken}), signal:AbortSignal.timeout(10000)
      });
      const verified = await check.json();
      if (verified.success !== true || verified.action !== 'photography_booking' || !HOSTS.has(verified.hostname)) return res.status(403).json({success:false,error:'BOT_CHECK_FAILED'});
      payload = {type:'booking',requestId:b.requestId,slotId:b.slotId,name:b.name,email:b.email,phone:b.phone,instagram:b.instagram.trim(),people:b.people,pets:b.pets,notes:'',consent:b.consent};
    }
    const upstream = await fetch(parsed.href, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,apiSecret:secret}),signal:AbortSignal.timeout(45000)});
    if (!upstream.ok) return res.status(503).json({success:false,error:upstream.status === 401 || upstream.status === 403 ? 'APPS_SCRIPT_ACCESS_DENIED' : 'APPS_SCRIPT_HTTP_ERROR'});
    let result;
    try { result = await upstream.json(); }
    catch (_) { return res.status(503).json({success:false,error:'APPS_SCRIPT_INVALID_RESPONSE'}); }
    if (!result || typeof result !== 'object') return res.status(503).json({success:false,error:'APPS_SCRIPT_INVALID_RESPONSE'});
    if (result.success !== true) {
      if (result.error === 'UNAUTHORIZED') return res.status(503).json({success:false,error:'BOOKING_SECRET_MISMATCH'});
      if (result.error === 'NOT_CONFIGURED') return res.status(503).json({success:false,error:'BOOKING_SHEET_NOT_CONFIGURED'});
      const error = ['SLOT_UNAVAILABLE','INVALID_DETAILS','REQUEST_ID_CONFLICT','BUSY'].includes(result.error) ? result.error : 'UPSTREAM_FAILED';
      return res.status(error === 'SLOT_UNAVAILABLE' ? 409 : error === 'INVALID_DETAILS' || error === 'REQUEST_ID_CONFLICT' ? 400 : 503).json({success:false,error});
    }
    // Only allow public availability or the submitting customer's receipt through.
    if (req.method === 'GET') {
      if (!Array.isArray(result.slots)) throw new Error('UPSTREAM_FAILED');
      return res.status(200).json({success:true,slots:result.slots.map(s=>({id:s.id,date:s.date,start:s.start,end:s.end,available:s.available===true}))});
    }
    if (typeof result.bookingId !== 'string' || !['Pending','Confirmed','Cancelled'].includes(result.status)) throw new Error('UPSTREAM_FAILED');
    return res.status(200).json({success:true,bookingId:result.bookingId,status:result.status,date:result.date,start:result.start,end:result.end});
  } catch (error) { return res.status(503).json({success:false,error:error && ['TimeoutError','AbortError'].includes(error.name) ? 'SERVICE_TIMEOUT' : 'SERVICE_UNAVAILABLE'}); }
};

