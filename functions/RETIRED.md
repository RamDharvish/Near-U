# Retired: Firebase Cloud Functions

Firebase Cloud Functions has been retired in favor of the **Cloudflare Workers Free Tier** backend located in `/worker`.

### Why was this retired?
- Firebase Cloud Functions requires the paid **Blaze** plan (credit card registration required by Google).
- Deploying Cloud Functions would violate the budget constraint to remain strictly on the free **Spark** tier.
- The new architecture in `/worker` uses **Cloudflare Workers Free** (100,000 requests/day, 10ms CPU) + **Expo Push Notification Service** (100% free), requiring $0 and no paid billing accounts.
