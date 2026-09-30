# Photography booking setup

The new `/photography` page has no incoming link from the homepage, order page or sitemap. It has `noindex` meta and response headers. Anyone with its URL can open it; this is an unlisted page, not password protection.

Each session lasts 30 minutes and accepts one group. A successful submission reserves the slot with status `pending`; the owner confirms it manually. No payment is collected. Price, venue and open dates have intentionally not been invented. Without its backend configuration, the page displays “攝影預約即將開放” and cannot take bookings.

## One-time setup

1. Create a private Google spreadsheet for photography bookings. Create a **separate** Apps Script project using `apps-script/photography.gs`; do not replace the current rug-order script.
2. In Apps Script → Project Settings → Script properties, set `SPREADSHEET_ID` to that spreadsheet's ID and `PHOTOGRAPHY_SHARED_SECRET` to a newly generated long random secret. Never put the secret into browser code or commit it to GitHub.
3. Run `setupPhotography` once and grant spreadsheet access. It creates `Slots`, `Bookings`, and `Settings` tabs. Set `priceLabel`, `location` and `description` in Settings to the confirmed customer-facing details.
4. Add confirmed dates to the `dates` array in `addPhotographySlots`, set opening/closing hours, and run it. It creates 30-minute sessions with one group per slot. Alternatively fill Slots directly with a unique ID, ISO start time with `+08:00`, and `TRUE` in Enabled. **Keep the Slots tab empty until ready to accept bookings.** Do not create overlapping sessions. Existing start times/IDs must not be changed once booked.
5. Deploy Apps Script as a Web App, running as you, access Anyone. The shared secret guards all requests before sheet access. Copy the deployed `/exec` URL.
6. In the existing Vercel project, add `PHOTOGRAPHY_APPS_SCRIPT_URL` and the matching `PHOTOGRAPHY_SHARED_SECRET`. Reuse existing `TURNSTILE_SECRET_KEY` and comma-separated `ALLOWED_HOSTNAME` values. The current Turnstile site key is used with action `photography`. Add any preview hostname to both Cloudflare's widget hostname list and the server allowlist only if testing bookings there.
7. Redeploy Vercel. Open `/photography` directly and verify the published schedule. Test a booking on a dedicated test slot, confirm its row exists, verify a second booking is refused, and mark the test row `cancelled` afterwards. No real booking was submitted during code verification.

## Daily operation

- `pending` and `confirmed` bookings occupy a slot. Contact the customer yourself and change `Status` to `confirmed` when agreed. This integration does not automatically send email or Instagram messages.
- Set `Status` to `cancelled` to release the slot. Every status other than `cancelled` continues to block it, so typos do not accidentally reopen it.
- Set Slots → Enabled to FALSE to close a session. Past sessions are hidden automatically.
- Pending reservations **do not expire automatically**. Review the sheet regularly and cancel abandoned reservations manually.
- LockService serializes writes and checks availability inside the lock. A request ID makes identical retries safe after network timeouts. Customer data is not returned by the public availability API or saved in browser storage.

## Validation

Passed: JavaScript syntax, API method/size/field validation, bot action verification, public-response privacy, backend reservation/idempotency/overlap/cancellation behavior using isolated mocks, and git whitespace checks. Browser visual/interaction tests were prepared but could not run because the browser binary was unavailable and its download failed in this environment. Live Google Apps Script/Vercel configuration and an end-to-end booking still require the steps above.
