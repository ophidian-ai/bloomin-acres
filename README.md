# Bloomin' Acres Market

Website for Bloomin' Acres Farm, an Indiana-based small farm and local market featuring online ordering, a membership club, and event scheduling.

**Live site**: https://bloominacresmarket.com
**Repository**: https://github.com/ophidian-ai/bloomin-acres

## Tech Stack

- **Frontend**: Static HTML, Tailwind CSS (CDN + build step), vanilla JavaScript
- **Backend**: Supabase (PostgreSQL, Auth)
- **Payments**: Stripe (checkout, subscriptions, customer portal, webhooks)
- **Hosting**: Vercel (static site + serverless API routes)
- **Calendar**: Google Calendar API integration

## Getting Started

```bash
git clone https://github.com/ophidian-ai/bloomin-acres.git
cd bloomin-acres
npm install
```

Copy `.env.example` to `.env` and fill in your keys (see Environment Variables below).

Start the dev server:

```bash
node serve.mjs
```

The site will be available at http://localhost:3000.

To rebuild Tailwind CSS:

```bash
npm run build
```

## Project Structure

```
index.html              Home page
menu.html               Product menu / shop
product.html            Individual product page
club.html               Membership club signup
account.html            Customer account dashboard
admin.html              Admin panel

css/                    Stylesheets (including Tailwind source and output)
js/                     Client-side JavaScript
  account.js            Account page logic
  admin.js              Admin panel logic
  cart.js               Shopping cart
  club.js               Club membership logic
  menu.js               Menu/shop page logic
  product.js            Product page logic
  shared.js             Shared utilities and Supabase client init
  utils.js              General helpers
  calendar.js           Calendar display
  schedule-calendar.js  Schedule/calendar integration
  index.js              Home page logic
  topright-icons.js     Header icon bar (cart, account)
  tailwind-config.js    Tailwind runtime config

api/                    Vercel serverless functions
  config.js             Exposes public Supabase config to the frontend
  calendar.js           Google Calendar event proxy
  stripe/
    checkout.js         Create Stripe checkout session (authenticated)
    guest-checkout.js   Create Stripe checkout session (guest)
    subscribe.js        Club membership subscription checkout
    products.js         Fetch Stripe product catalog
    portal.js           Stripe customer portal session
    webhook.js          Stripe webhook handler

brand-assets/           Logos, images, brand guide
supabase-schema.sql     Database schema
seed-data.sql           Seed data for development
```

## Environment Variables

Copy `.env.example` to `.env` for local development. On Vercel, set these in the project dashboard.

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only) |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `STRIPE_CLUB_PRICE_ID` | Yes | Stripe Price ID for the club membership subscription |
| `STRIPE_CLUB_DISCOUNT_ID` | No | Stripe Coupon ID for club member product discounts |
| `STRIPE_REFERRAL_REG_COUPON` | No | Stripe Coupon ID for referral discounts on regular checkout |
| `STRIPE_REFERRAL_CLUB_COUPON` | No | Stripe Coupon ID for referral discounts on club signup |
| `GOOGLE_CALENDAR_API_KEY` | Yes | Google Calendar API key for event display |
| `GOOGLE_CALENDAR_ID` | Yes | Google Calendar ID to fetch events from |
| `ALLOWED_ORIGIN` | No | Override CORS origin (defaults to `VERCEL_URL` or `http://localhost:3000`) |

`VERCEL_URL` is automatically set by Vercel on deployed environments.

## Deployment

The site is hosted on Vercel and deploys automatically:

1. Push changes to a feature branch.
2. Vercel generates a preview deployment for the branch.
3. Open a pull request into `main`.
4. After review, merge the PR.
5. Vercel deploys to production from `main`.

The build step runs `npx tailwindcss -i css/tailwind-src.css -o css/tailwind.css --minify`. API routes in `api/` are deployed as Vercel serverless functions automatically.

## License

Private. All rights reserved.
