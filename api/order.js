const MAX_BODY_BYTES = 3_600_000;
const ALLOWED_TYPES = new Set(['order', 'pet_photo', 'payment']);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    assertConfiguration();

    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return res.status(413).json({ success: false, error: 'REQUEST_TOO_LARGE' });
    }

    const body = parseBody(req.body);
    if (!body || !ALLOWED_TYPES.has(body.type)) {
      return res.status(400).json({ success: false, error: 'INVALID_REQUEST' });
    }

    const measuredSize = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (measuredSize > MAX_BODY_BYTES) {
      return res.status(413).json({ success: false, error: 'REQUEST_TOO_LARGE' });
    }

    if (body.type === 'order') {
      const turnstileOK = await verifyTurnstile(body.turnstileToken);
      if (!turnstileOK) {
        return res.status(403).json({
          success: false,
          error: 'BOT_CHECK_FAILED'
        });
      }
    }

    delete body.turnstileToken;
    delete body.apiSecret;

    const upstreamResponse = await fetch(process.env.APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        ...body,
        apiSecret: process.env.API_SHARED_SECRET
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!upstreamResponse.ok) {
      throw new Error(`Apps Script returned ${upstreamResponse.status}`);
    }

    const upstreamText = await upstreamResponse.text();
    let result;
    try {
      result = JSON.parse(upstreamText);
    } catch (error) {
      throw new Error('Apps Script returned invalid JSON');
    }

    if (!result || result.success !== true) {
      return res.status(400).json({
        success: false,
        error: result && result.error ? result.error : 'UPSTREAM_REJECTED'
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Order API error:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR'
    });
  }
};

function parseBody(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    return { ...body };
  }

  if (typeof body === 'string') {
    return JSON.parse(body);
  }

  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString('utf8'));
  }

  return null;
}

async function verifyTurnstile(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 2048) {
    return false;
  }

  const form = new URLSearchParams();
  form.set('secret', process.env.TURNSTILE_SECRET_KEY);
  form.set('response', token);

  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) return false;

  const result = await response.json();
  return result.success === true &&
    result.hostname === process.env.ALLOWED_HOSTNAME &&
    (!result.action || result.action === 'order');
}

function assertConfiguration() {
  const required = [
    'APPS_SCRIPT_URL',
    'API_SHARED_SECRET',
    'TURNSTILE_SECRET_KEY',
    'ALLOWED_HOSTNAME'
  ];

  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}
