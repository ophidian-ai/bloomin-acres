# Bloomin' Acres Market

Client website for Bloomin' Acres Farm — an Indiana-based small farm and local market.

## Project Info

- **Client**: Bloomin' Acres Farm
- **Type**: Client project (web design + branding)
- **Managed by**: OphidianAI (Project Chimera orchestration system)
- **Repo**: https://github.com/ophidian-ai/bloomin-acres

## Tech Stack

- **Frontend**: Static HTML, Tailwind CSS (CDN), vanilla JavaScript
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions)
- **Hosting**: Vercel
- **Dev server**: `node serve.mjs` (serves at http://localhost:3000)

## Deployment Workflow

1. Work on a feature branch. Branch names follow `<department>/<agent>/<brief-description>` (e.g., `design/frontend-developer/menu-redesign`).
2. Vercel auto-generates a preview deployment for every branch push.
3. Open a PR from the feature branch into `main` with a summary and the Vercel preview URL.
4. Eric reviews the preview and merges when satisfied.
5. Vercel deploys to production on merge to `main`.

**Never push directly to `main`.** All changes go through PRs.

## Security Rules

- Do NOT read, modify, or create `.env` files. Environment variables are documented in `.env.example` and configured in the Vercel/Supabase dashboards.
- Do NOT store credentials, API keys, or secrets in code. Reference them by environment variable name only.
- Do NOT push to `main` or merge PRs. The user is the gatekeeper.
- Do NOT interact with Vercel or Supabase dashboards directly.

## Brand Assets

Check `brand-assets/` for logos, color guides, and style references. Use real assets — do not use placeholders where brand assets exist.

## Design Conventions

- Mobile-first responsive design
- Use the brand color palette from `brand-assets/` — do not invent colors
- Pair a display/serif font for headings with a clean sans for body text
- Every interactive element needs hover, focus-visible, and active states
- Use layered, color-tinted shadows — not flat `shadow-md`
- Only animate `transform` and `opacity` — never `transition-all`
- Intentional spacing tokens, not random Tailwind steps

## File Structure

- `index.html` — Home page
- `menu.html`, `product.html`, `club.html`, `account.html`, `admin.html` — Site pages
- `css/` — Stylesheets
- `js/` — Client-side JavaScript
- `api/` — API routes (Vercel serverless functions)
- `brand-assets/` — Logos, colors, brand guide
- `supabase-schema.sql`, `seed-data.sql` — Database schema and seed data

## Dependencies

- No new runtime dependencies without explicit approval from Eric
- Dev dependencies are fine if justified
