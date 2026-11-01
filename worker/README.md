# NearU Push Notification Worker

Budget-friendly, server-side push notification backend for NearU running on **Cloudflare Workers Free** + **Expo Push Notification Service** + **Firebase Spark Plan**.

## Architecture & Free-Tier Limits

| Service | Free Tier Allowance | NearU Usage / Cost |
| :--- | :--- | :--- |
| **Cloudflare Workers** | 100,000 requests / day, 10ms CPU time | ~1 request per NearU sent (**$0.00**) |
| **Expo Push Service** | Unlimited push notifications | Handles Android notification delivery (**$0.00**) |
| **Firebase Cloud Firestore (Spark)** | 50k reads / day, 20k writes / day | Verified via service account REST API (**$0.00**) |
| **Firebase Auth (Spark)** | Unlimited anonymous authentication | Cryptographically verified ID tokens (**$0.00**) |

No credit card, Cloudflare paid plan, or Firebase Blaze billing upgrade is required.

---

## Security Model

1. **Server-Side Authentication**: The mobile app passes the sender's Firebase ID token in the `Authorization: Bearer <idToken>` header. The Cloudflare Worker verifies the token's RSA256 signature using Google's public JWKS certificates (`auth/certificates`). The token's issuer (`https://securetoken.google.com/<projectId>`), audience (`<projectId>`), expiry (`exp`), and subject (`sub`) are strictly checked. The sender's UID is taken directly from the verified token; client-supplied sender UIDs are never trusted.
2. **Mutual Friend Verification**: Before delivering any notification, the Worker queries Firestore REST API to ensure the sender and recipient are accepted mutual friends (`users/{recipientUid}/friends/{senderUid}` or `friend_requests` with status `accepted`). Unpaired users cannot send messages or notifications.
3. **Private Push Tokens**: Recipients' Expo push tokens are stored in private user subcollections (`users/{uid}/expo_push_tokens` and `users/{uid}/fcm_tokens`) protected by `isOwner(userId)` security rules in `firestore.rules`. Other clients cannot read them. Only the Worker accesses them via service account credentials.
4. **Input Hardening & Path Safety**:
   - `toUid`, `senderUid`, and `eventId` are validated against a strict regex: `/^[a-zA-Z0-9_-]{1,128}$/`. Any request containing path traversal characters (`..`, `/`), control characters, query characters, or oversized strings is rejected with `400 Bad Request`.
   - All document IDs and subcollection names interpolated into Firestore REST API URLs are encoded using `encodeURIComponent` to prevent path traversal and URL breakouts.
   - `fromName` is sanitized by stripping ASCII control characters and limited to 30 characters.
   - Message text is validated to a 120-character maximum and trimmed of whitespace.
5. **Distributed Rate Limiting & Cooldown**: Max 1 send per 5 seconds per friend pair.
6. **Concurrent Duplicate Suppression**: Dual-layer deduplication (Edge Cache API + Firestore atomic document creation).
7. **No Secrets in Client**: The Google Service Account private key is stored exclusively as an encrypted Cloudflare Worker secret (`FIREBASE_SERVICE_ACCOUNT`). It is never bundled into the APK or committed to Git.

---

## Distributed Rate Limiting & Deduplication Architecture

### Evaluation of Cloudflare Free-Tier Storage Options

| Storage Mechanism | Consistency | Free-Tier Limits | Suitability for NearU |
| :--- | :--- | :--- | :--- |
| **Cloudflare Workers KV** | Eventually consistent (~60s propagation) | **1,000 writes/day** | **Not suitable:** Every push ping would perform a KV write. A single active chat day would exhaust the 1,000 write quota and fail with HTTP 429 errors. |
| **Cloudflare Durable Objects** | Strongly consistent in-memory coordination | Requires **Workers Paid Plan ($5/month)** | **Not suitable for Free Tier:** Violates NearU's $0 budget and Firebase Spark compatibility requirement. |
| **Cloudflare Cache API (`caches.default`)** | Edge data-center scoped | **Unlimited operations** on Free Tier | **Recommended for Edge Cooldown:** Allows sharing rate limit cooldowns and deduplication state across all Worker isolates running within the same edge data center with zero latency penalty and zero cost. |
| **Firestore REST Atomic Creation (`ALREADY_EXISTS` 409)** | Globally consistent transactional ACID | Included in Firebase Spark free tier (20k writes/day) | **Recommended for Global Duplicate Guarantee:** Provides absolute atomic deduplication across different geographic edge data centers. |

### How NearU Implements Distributed Protection

1. **Edge-Level Coordination (Cloudflare Cache API + In-Memory Fast Path)**:
   - When a request arrives, `worker/src/rate-limiter.ts` first checks local isolate memory (sub-millisecond fast path).
   - If not in local isolate memory, it queries Cloudflare's Cache API (`caches.default`) for the friend pair key (`https://rate-limit.nearu.internal/cooldown/<senderUid>_<toUid>`).
   - If a cooldown record is found, the worker rejects the request with HTTP `429 Too Many Requests` and reports the remaining cooldown seconds.
   - If allowed, a 5-second cooldown record is written to `caches.default` (and local memory) so other Worker isolates in the same Point of Presence (PoP) enforce the cooldown immediately.
2. **Global Atomic Deduplication (Firestore REST API 409 Conflict)**:
   - What happens if two identical requests arrive at two *different* edge data centers simultaneously? Because the Cache API is edge-scoped, they could both pass the initial cache check.
   - NearU solves this by writing the event document via Firestore REST API: `POST /users/{recipientUid}/nearu_events?documentId={eventId}`.
   - Firestore's database engine guarantees atomic document creation: if the document with `documentId={eventId}` already exists, Firestore returns **HTTP 409 Conflict (`ALREADY_EXISTS`)**.
   - When the Worker receives HTTP 409 from Firestore, it recognizes that another instance already processed the event, skips the Expo Push Notification delivery entirely, and returns `{ success: true, message: 'Event already processed', eventId, duplicate: true }`.
   - This provides **100% reliable duplicate suppression** globally without paying for Cloudflare Durable Objects.

---

## Least-Privilege Google Cloud Service Account Setup

> [!CAUTION]
> **Do NOT use the default `firebase-adminsdk` service account.**
> By default, Firebase generates an Admin SDK service account with full administrative privileges (Project Editor / Firebase Admin) across all services including Authentication, Storage, Functions, and Cloud IAM. If that key were ever leaked, your entire GCP project would be compromised.

Follow these step-by-step instructions to create a dedicated service account that has only the bare minimum permissions needed by `worker/src/firestore.ts`.

### Minimum Permissions Required

Reviewing the actual REST operations in `worker/src/firestore.ts`:
1. `GET /users/{toUid}/friends/{fromUid}` and `GET /friend_requests/...` &rarr; requires `datastore.entities.get`
2. `POST /users/{toUid}/nearu_events?documentId={eventId}` &rarr; requires `datastore.entities.create`
3. `GET /users/{toUid}/expo_push_tokens` and `GET /users/{toUid}/fcm_tokens` &rarr; requires `datastore.entities.list`
4. `DELETE /users/{toUid}/{collection}/{docId}` (cleaning unregistered tokens) &rarr; requires `datastore.entities.delete`

---

### Option A: Custom IAM Role (Strict Least Privilege — Recommended)

This grants **only** the 4 exact permissions needed by the worker.

#### Via Google Cloud Console:
1. Go to **Google Cloud Console** > **IAM & Admin** > **Roles** ([console.cloud.google.com/iam-admin/roles](https://console.cloud.google.com/iam-admin/roles)).
2. Ensure project **`nearu-962eb`** is selected at the top.
3. Click **+ Create Role**.
4. Set:
   - **Title**: `NearU Worker Firestore Minimal`
   - **Role ID**: `nearu_worker_firestore`
   - **Role launch stage**: `General Availability`
5. Click **+ Add Permissions** and search/select:
   - `datastore.entities.get`
   - `datastore.entities.list`
   - `datastore.entities.create`
   - `datastore.entities.delete`
6. Click **Create**.
7. Go to **IAM & Admin** > **Service Accounts** ([console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts)).
8. Click **+ Create Service Account**:
   - **Service account name**: `nearu-push-worker`
   - **Service account ID**: `nearu-push-worker`
   - Click **Create and Continue**.
9. In **Grant this service account access to project**, select your newly created custom role:
   - Role: `NearU Worker Firestore Minimal`
   - Click **Done**.
10. Click on the newly created service account (`nearu-push-worker@nearu-962eb.iam.gserviceaccount.com`).
11. Navigate to the **Keys** tab > **Add Key** > **Create new key**.
12. Select **JSON** and click **Create**. A JSON key file will download.

#### Via `gcloud` CLI:
```bash
# 1. Create the custom IAM role
gcloud iam roles create nearu_worker_firestore \
  --project=nearu-962eb \
  --title="NearU Worker Firestore Minimal" \
  --description="Minimum permissions for NearU Cloudflare push worker" \
  --permissions=datastore.entities.get,datastore.entities.list,datastore.entities.create,datastore.entities.delete \
  --stage=GA

# 2. Create the dedicated service account
gcloud iam service-accounts create nearu-push-worker \
  --project=nearu-962eb \
  --display-name="NearU Push Notification Worker"

# 3. Bind the custom role to the service account
gcloud projects add-iam-policy-binding nearu-962eb \
  --member="serviceAccount:nearu-push-worker@nearu-962eb.iam.gserviceaccount.com" \
  --role="projects/nearu-962eb/roles/nearu_worker_firestore"

# 4. Generate the private key JSON file
gcloud iam service-accounts keys create ./nearu-worker-key.json \
  --project=nearu-962eb \
  --iam-account=nearu-push-worker@nearu-962eb.iam.gserviceaccount.com
```

---

### Option B: Predefined Role (`roles/datastore.user`)

If you prefer not to manage a custom IAM role, you can use the predefined Google role **`Cloud Datastore User`** (`roles/datastore.user`).

- **What it grants**: Entity CRUD operations (`datastore.entities.get`, `datastore.entities.list`, `datastore.entities.create`, `datastore.entities.delete`, `datastore.entities.update`, `datastore.entities.allocateIds`).
- **What it prevents**: Does **not** grant project owner, editor, Firebase Admin, IAM, billing, or security rule modification permissions.
- **Why it is safe**: It confines the service account to data operations only, preventing project compromise.

#### Steps for Option B:
1. Go to **Google Cloud Console** > **IAM & Admin** > **Service Accounts**.
2. Click **+ Create Service Account**:
   - **Service account name**: `nearu-push-worker`
   - Click **Create and Continue**.
3. Under **Role**, search for and select **Cloud Datastore User** (`roles/datastore.user`).
4. Click **Done**.
5. Go to the **Keys** tab > **Add Key** > **Create new key** > **JSON**.

---

## Deployment & Configuration Walkthrough

### Step 1: Install Wrangler CLI (if not already installed)
```bash
npx wrangler --version
```

### Step 2: Log in to Cloudflare
```bash
npx wrangler login
```

### Step 3: Configure Cloudflare Worker Secret
Store the dedicated service account JSON as an encrypted secret in Cloudflare:
```bash
cd worker
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```
When prompted:
- Open your downloaded service account key JSON file (`nearu-worker-key.json`).
- Copy the entire text content (including `{` and `}`).
- Paste it into the terminal and press Enter.

### Step 4: Deploy the Worker
```bash
npx wrangler deploy
```
Wrangler will output your live worker URL:
```
https://nearu-push-worker.<your-subdomain>.workers.dev
```

### Step 5: Test the Worker Health Check
Open your browser or run:
```bash
curl https://nearu-push-worker.<your-subdomain>.workers.dev/health
```
You should see:
```json
{
  "status": "ok",
  "service": "NearU Push Worker",
  "projectId": "nearu-962eb",
  "serviceAccountConfigured": true
}
```

### Step 6: Link Worker URL to NearU Mobile App
Open `src/constants/config.ts` in the NearU project and set `WORKER_URL`:
```ts
export const BACKEND_CONFIG = {
  WORKER_URL: 'https://nearu-push-worker.<your-subdomain>.workers.dev',
  FIREBASE_PROJECT_ID: 'nearu-962eb',
};
```

When `WORKER_URL` is set, NearU will route push notifications through your secure Cloudflare Worker. If left blank or if network connectivity fails, the app falls back automatically to direct Firestore event delivery.
