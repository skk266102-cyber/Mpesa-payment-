# Standalone M-PESA STK Push Payment Page

A small Node.js + Express website that sends an M-PESA STK Push through the Safaricom Daraja sandbox.

## Files

- `server.js` — backend, Daraja OAuth, STK Push request and callback handling.
- `public/index.html` — payment form.
- `public/style.css` — styling.
- `.env.example` — names of the secrets/configuration required.
- `.gitignore` — prevents `.env` and `node_modules` from being committed.

## Required environment variables

Set these in your hosting provider:

- `CONSUMER_KEY`
- `CONSUMER_SECRET`
- `BUSINESS_SHORT_CODE`
- `MPESA_PASSKEY`
- `TRANSACTION_TYPE`
- `PUBLIC_BASE_URL`
- `BUSINESS_NAME`
- `ACCOUNT_REFERENCE`
- `TRANSACTION_DESC`

Do NOT put real credentials in `index.html`, `server.js`, or a public GitHub repository.

## Run locally

1. Install Node.js 20+.
2. Run `npm install`.
3. Set the environment variables.
4. Run `npm start`.
5. Open `http://localhost:10000`.

For a real Daraja callback, the callback URL must be publicly reachable over HTTPS. A deployed Render web service provides a public `onrender.com` URL.

## Important sandbox note

This project is configured for the Daraja sandbox endpoint:

`https://sandbox.safaricom.co.ke`

It is for testing. It is not a production payment system.

Before collecting real customer money, move to the appropriate Safaricom Daraja production/Go Live setup and use the production credentials, shortcode/till details, passkey, and production endpoint supplied for your approved business setup.

## Data/storage note

The sample keeps transaction status in memory so it is easy to test. It is NOT permanent accounting storage. A free web service can restart and lose local/in-memory state. For a real business, add a persistent database and proper authentication/admin controls before relying on the dashboard for records.

## Security

- Keep Consumer Key and Consumer Secret private.
- Do not commit `.env`.
- Do not expose the Daraja secret to browser JavaScript.
- Add authentication/rate limiting and persistent storage before production use.
