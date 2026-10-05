'use strict';
const HOSTS = new Set(['justforyouandmeow.com', 'www.justforyouandmeow.com', 'justforyouandmeow.vercel.app']);
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({success:false,error:'METHOD_NOT_ALLOWED'}); }
  try {
    const endpoint = process.env.PHOTOGRAPHY_APPS_SCRIPT_URL;
    const secret = process.env.BOOKING_API_SECRET;
    if (!endpoint || !secret || !process.env.TURNSTILE_SECRET_KEY) return res.status(503).json({success:false,error:'NOT_CONFIGURED'});
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(parsed.pathname)) return res.status(503).json({success:false,error:'NOT_CONFIGURED'});
    let payload = {type:'availability'};
    if (req.method === 'POST') {
      if (Number(req.headers['content-length'] || 0) > 12000) return res.status(413).json({success:false,error:'INVALID_REQUEST'});
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!b || Buffer.byteLength(JSON.stringify(b),'utf8') > 12000 || typeof b.turnstileToken !== 'string' || !b.turnstileToken || b.turnstileToken.length > 2048) return res.status(400).json({success:false,error:'INVALID_REQUEST'});
      const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method:'POST', body:new URLSearchParams({secret:process.env.TURNSTILE_SECRET_KEY,response:b.turnstileToken}), signal:AbortSignal.timeout(10000)
      });
      const verified = await check.json();
      if (verified.success !== true || verified.action !== 'photography_booking' || !HOSTS.has(verified.hostname)) return res.status(403).json({success:false,error:'BOT_CHECK_FAILED'});
      payload = {type:'booking',requestId:b.requestId,slotId:b.slotId,name:b.name,email:b.email,phone:b.phone,instagram:b.instagram,people:b.people,pets:b.pets,notes:b.notes,consent:b.consent};
    }
    const upstream = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,apiSecret:secret}),signal:AbortSignal.timeout(22000)});
    if (!upstream.ok) throw new Error('UPSTREAM_FAILED');
    const result = await upstream.json();
    if (result.success !== true) {
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
  } catch (_) { return res.status(503).json({success:false,error:'SERVICE_UNAVAILABLE'}); }
};
