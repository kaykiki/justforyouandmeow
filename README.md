# just for you and meow — website

## Files in this folder

```
index.html      ← the website
netlify.toml    ← Netlify config (do not delete)
fps-qr.png      ← ADD THIS: your FPS QR code image
```

## Before uploading

1. Open `index.html` in any text editor
2. Find the `CONFIG` block near the top and update:
   - `number`  → your FPS phone number
   - `name`    → your name as it appears on FPS
   - `qrImage` → keep as `fps-qr.png` (just add the actual image file)

3. Save your FPS QR code image as `fps-qr.png` and put it in this folder

## Deploy to Netlify (free)

1. Go to https://netlify.com and sign up / log in
2. Click **Add new site** → **Deploy manually**
3. Drag this entire folder into the upload area
4. Done — Netlify gives you a URL like `yoursite.netlify.app`

## Custom domain (optional)

1. Buy a domain at https://porkbun.com (~HK$80/yr for .com)
2. In Netlify: Site settings → Domain management → Add custom domain
3. In Porkbun: DNS → add the nameservers Netlify gives you

## Orders

All orders are collected in your Netlify dashboard under:
**Forms** → `rug-order`

You will also get an email notification for each order.
To set up email notifications: Site settings → Forms → Form notifications
