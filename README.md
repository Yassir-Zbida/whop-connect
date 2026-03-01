# Whop Admin

Express app with **admin login** and **Whop connected accounts**: enroll merchants and send funds. All admin and API routes require login.

## Setup

1. Copy env and set your values:
   ```bash
   cp .env.example .env
   ```
   Edit `.env`:
   - **ADMIN_USERNAME** – login username (default `admin`)
   - **ADMIN_PASSWORD** – set a strong password (required)
   - **SESSION_SECRET** – random string for session cookies (e.g. `openssl rand -hex 32`)
   - **WHOP_API_KEY** – Company API key from [Whop Dashboard](https://whop.com/dashboard) → Developer settings
   - **WHOP_PARENT_COMPANY_ID** – your platform company ID (e.g. `biz_xxxxxxxxxxxxx`)

2. Install and run:
   ```bash
   npm install
   npm start
   ```

3. Open **http://localhost:3001** (or your `PORT`). You’ll be redirected to login, then to the connected accounts page.

## Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /` | - | Redirect to `/connected-accounts` or `/login` |
| `GET /login` | - | Login page |
| `POST /login` | - | Submit username/password, then redirect to dashboard |
| `GET /logout` | - | Destroy session, redirect to login |
| `GET /connected-accounts` | Yes | Enroll connected accounts & send funds |
| `POST /api/companies` | Yes | Create Company (enroll) |
| `POST /api/transfers` | Yes | Create Transfer (send funds) |

## Whop

- [Enroll connected accounts](https://docs.whop.com/developer/platforms/enroll-connected-accounts)
- [Collect payments for connected accounts](https://docs.whop.com/developer/platforms/collect-payments-for-connected-accounts)

Company API key needs: `company:create_child`, `company:basic:read`, `payout:transfer_funds`.
