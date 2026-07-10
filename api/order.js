const MAX_BODY_BYTES = 8_000_000;

const ALLOWED_TYPES = new Set([
  'products',
  'terms',
  'promo',
  'order',
  'manage_lookup',
  'pet_photo',
  'payment'
]);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: 'METHOD_NOT_ALLOWED'
    });
  }

  const requestStartedAt = Date.now();

  try {
    const contentLength = Number(
      req.headers['content-length'] || 0
    );

    console.log(
      '[API] Request received',
      JSON.stringify({
        method: req.method,
        contentLength: contentLength,
        timestamp: new Date().toISOString()
      })
    );

    if (contentLength > MAX_BODY_BYTES) {
      console.warn(
        '[API] Request rejected: content-length too large',
        contentLength
      );

      return res.status(413).json({
        success: false,
        error: 'REQUEST_TOO_LARGE'
      });
    }

    const body = parseBody(req.body);

    if (!body || !ALLOWED_TYPES.has(body.type)) {
      console.warn(
        '[API] Invalid request type',
        body && body.type
      );

      return res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST'
      });
    }

    assertConfiguration(body.type);

    const serializedBody = JSON.stringify(body);
    const measuredSize = Buffer.byteLength(
      serializedBody,
      'utf8'
    );

    console.log(
      '[API] Parsed request',
      JSON.stringify({
        type: body.type,
        measuredSizeBytes: measuredSize,
        measuredSizeMB:
          Math.round((measuredSize / 1024 / 1024) * 100) /
          100
      })
    );

    if (measuredSize > MAX_BODY_BYTES) {
      console.warn(
        '[API] Request rejected: measured body too large',
        measuredSize
      );

      return res.status(413).json({
        success: false,
        error: 'REQUEST_TOO_LARGE'
      });
    }

    if (body.type === 'order') {
      const turnstileStartedAt = Date.now();

      console.log('[Turnstile] Verification started');

      const turnstileOK = await verifyTurnstile(
        body.turnstileToken
      );

      console.log(
        '[Turnstile] Verification completed',
        JSON.stringify({
          success: turnstileOK,
          durationMs: Date.now() - turnstileStartedAt
        })
      );

      if (!turnstileOK) {
        return res.status(403).json({
          success: false,
          error: 'BOT_CHECK_FAILED'
        });
      }
    }

    delete body.turnstileToken;
    delete body.apiSecret;

    const upstreamPayload = {
      ...body,
      apiSecret: process.env.API_SHARED_SECRET
    };

    console.log(
      '[API] Sending request to Apps Script',
      JSON.stringify({
        type: body.type,
        orderNumber:
          body.orderNumber ||
          body.orderNo ||
          '',
        payloadSizeBytes: Buffer.byteLength(
          JSON.stringify(upstreamPayload),
          'utf8'
        )
      })
    );

    const result = await callAppsScript(
      upstreamPayload
    );

    if (!result || result.success !== true) {
      console.warn(
        '[API] Apps Script rejected request',
        JSON.stringify({
          type: body.type,
          result: result || null
        })
      );

      return res.status(400).json({
        success: false,
        error:
          result && result.error
            ? result.error
            : 'UPSTREAM_REJECTED'
      });
    }

    console.log(
      '[API] Request completed successfully',
      JSON.stringify({
        type: body.type,
        totalDurationMs:
          Date.now() - requestStartedAt
      })
    );

    return res.status(200).json(result);
  } catch (error) {
    const totalDurationMs =
      Date.now() - requestStartedAt;

    console.error(
      '[API] Request failed',
      JSON.stringify({
        name:
          error && error.name
            ? error.name
            : 'UnknownError',
        message:
          error && error.message
            ? error.message
            : String(error),
        totalDurationMs: totalDurationMs
      })
    );

    const isTimeout =
      error &&
      (
        error.name === 'TimeoutError' ||
        error.name === 'AbortError' ||
        String(error.message || '')
          .toLowerCase()
          .includes('timeout') ||
        String(error.message || '')
          .toLowerCase()
          .includes('aborted')
      );

    return res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: isTimeout
        ? 'UPSTREAM_TIMEOUT'
        : 'SERVER_ERROR',
      detail:
        process.env.NODE_ENV === 'development'
          ? String(
              error && error.message
                ? error.message
                : error
            )
          : undefined
    });
  }
};

module.exports.config = {
  maxDuration: 60,

  api: {
    bodyParser: {
      sizeLimit: '8mb'
    }
  }
};

async function callAppsScript(payload) {
  const startedAt = Date.now();
  const serializedPayload =
    JSON.stringify(payload);

  const payloadSize = Buffer.byteLength(
    serializedPayload,
    'utf8'
  );

  console.log(
    '[Apps Script] Request started',
    JSON.stringify({
      type: payload.type,
      payloadSizeBytes: payloadSize,
      payloadSizeMB:
        Math.round(
          (payloadSize / 1024 / 1024) * 100
        ) / 100
    })
  );

  const response = await fetch(
    process.env.APPS_SCRIPT_URL,
    {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type':
          'text/plain;charset=utf-8'
      },
      body: serializedPayload,
      signal: AbortSignal.timeout(55_000)
    }
  );

  const responseReceivedAt = Date.now();

  console.log(
    '[Apps Script] Response headers received',
    JSON.stringify({
      type: payload.type,
      status: response.status,
      statusText: response.statusText,
      durationMs:
        responseReceivedAt - startedAt,
      contentType:
        response.headers.get('content-type') ||
        'unknown'
    })
  );

  const text = await response.text();

  console.log(
    '[Apps Script] Response body received',
    JSON.stringify({
      type: payload.type,
      totalDurationMs:
        Date.now() - startedAt,
      responseLength: text.length
    })
  );

  if (!response.ok) {
    console.error(
      '[Apps Script] HTTP error',
      JSON.stringify({
        status: response.status,
        preview: text.slice(0, 300)
      })
    );

    throw new Error(
      `Apps Script returned HTTP ${response.status}`
    );
  }

  try {
    const parsed = JSON.parse(text);

    console.log(
      '[Apps Script] JSON parsed successfully',
      JSON.stringify({
        type: payload.type,
        success:
          parsed &&
          parsed.success === true,
        totalDurationMs:
          Date.now() - startedAt
      })
    );

    return parsed;
  } catch (error) {
    const contentType =
      response.headers.get('content-type') ||
      'unknown';

    console.error(
      '[Apps Script] Invalid JSON response',
      JSON.stringify({
        contentType: contentType,
        responseLength: text.length,
        preview: text.slice(0, 300)
      })
    );

    throw new Error(
      'Apps Script returned invalid JSON'
    );
  }
}

function parseBody(body) {
  if (
    body &&
    typeof body === 'object' &&
    !Buffer.isBuffer(body)
  ) {
    return { ...body };
  }

  if (typeof body === 'string') {
    return JSON.parse(body);
  }

  if (Buffer.isBuffer(body)) {
    return JSON.parse(
      body.toString('utf8')
    );
  }

  return null;
}

async function verifyTurnstile(token) {
  if (
    typeof token !== 'string' ||
    token.length < 20 ||
    token.length > 2048
  ) {
    console.warn(
      '[Turnstile] Invalid token format'
    );

    return false;
  }

  const form = new URLSearchParams();

  form.set(
    'secret',
    process.env.TURNSTILE_SECRET_KEY
  );

  form.set('response', token);

  const startedAt = Date.now();

  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000)
    }
  );

  console.log(
    '[Turnstile] Cloudflare response received',
    JSON.stringify({
      status: response.status,
      durationMs:
        Date.now() - startedAt
    })
  );

  if (!response.ok) {
    return false;
  }

  const result = await response.json();
  const allowedHostnames =
    getAllowedHostnames();

  const hostnameAllowed =
    allowedHostnames.includes(
      result.hostname
    );

  const actionAllowed =
    !result.action ||
    result.action === 'order';

  console.log(
    '[Turnstile] Verification result',
    JSON.stringify({
      success: result.success === true,
      hostname: result.hostname || '',
      hostnameAllowed: hostnameAllowed,
      action: result.action || '',
      actionAllowed: actionAllowed,
      errorCodes:
        result['error-codes'] || []
    })
  );

  return (
    result.success === true &&
    hostnameAllowed &&
    actionAllowed
  );
}

function getAllowedHostnames() {
  return String(
    process.env.ALLOWED_HOSTNAME || ''
  )
    .split(',')
    .map(function(host) {
      return host.trim();
    })
    .filter(Boolean);
}

function assertConfiguration(type) {
  const required = [
    'APPS_SCRIPT_URL',
    'API_SHARED_SECRET'
  ];

  if (type === 'order') {
    required.push(
      'TURNSTILE_SECRET_KEY',
      'ALLOWED_HOSTNAME'
    );
  }

  const missing = required.filter(
    function(name) {
      return !process.env[name];
    }
  );

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}`
    );
  }
}
