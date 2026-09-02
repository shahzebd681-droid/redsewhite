# RedseWhite — Supabase backend

This version stores payment settings and transactions in Supabase and payment images in Supabase Storage. No payment gateway or automatic payment verification is used.

## Required Render environment variables

- ADMIN_USER
- ADMIN_PASSWORD
- SESSION_SECRET
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

The Supabase service-role key must remain server-side and must never be placed in frontend JavaScript.

## Supabase schema

Run the RedseWhite SQL schema supplied in the project before deploying. The required tables are `public.settings` and `public.transactions` with the fields used by `server.js`.

## Storage

The server automatically attempts to create:
- `payment-qr` (public)
- `payment-screenshots` (private)

The service-role key is required for this server-side setup.
