# MyConstituency (Next.js)

This is a starter version of **myconstituency.ca**:
- Enter a Canadian postal code (Calgary)
- Pull current representatives (municipal / provincial / federal) using Represent (Open North)
- Show current issues pulled from the internet (official feeds/pages)

## Run locally
1. Install Node.js (LTS)
2. In this folder:

```bash
npm install
npm run dev
```

Open the URL shown (usually http://localhost:3000).

## Deploy (Vercel recommended)
- Build: `npm run build`
- Output: handled by Next.js automatically

## Notes
- Postal codes are not always 100% accurate for boundaries. Represent recommends geocoding an **address** and using lat/lon for perfect accuracy.
- The City of Calgary RSS "tagfeed" URL can be picky with automated fetchers; if it fails in production, we can switch to a different official feed URL (or use the archive pages which have an RSS link).
