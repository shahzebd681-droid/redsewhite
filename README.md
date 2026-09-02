# RedseWhite

A manual payment submission and transaction status portal with an admin dashboard.

## Features
- Customer-facing payment page
- UPI, bank details and QR code managed from admin
- Minimum/maximum payment limits
- UTR + payment screenshot submission
- Unique PAY-XXXXXXXX reference code
- Public status lookup by reference code
- Manual Pending / Confirmed / Rejected workflow
- Rejection reason
- Telegram + WhatsApp contact management
- SQLite database
- Server-side admin authentication

## Run
1. Install Node.js 18+.
2. Run `npm install`.
3. Set environment variables before production:
   - `ADMIN_USER`
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
4. Run `npm start`.
5. Open `/` for customer site and `/admin` for admin.

For production, use HTTPS and a strong admin password. This project does not automatically verify bank/UPI payments; all payment status changes are manual.
