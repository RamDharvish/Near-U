/**
 * NearU Push Notification Backend Worker
 * Runs on Cloudflare Workers Free Tier.
 * Delivers push notifications via Expo Push Notification Service.
 */

import { verifyFirebaseIdToken } from './firebase-auth';
import { FirestoreClient, type GoogleServiceAccount } from './firestore';
import { sendExpoPushNotifications, fetchExpoPushReceipts, type SendPushResult } from './expo-push';
import { checkRateLimit, isDuplicateEvent } from './rate-limiter';

export interface Env {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_SERVICE_ACCOUNT?: string; // Secret JSON string containing Google service account
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // 2. Health Check
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({
        status: 'ok',
        service: 'NearU Push Worker',
        projectId: env.FIREBASE_PROJECT_ID || 'nearu-962eb',
        serviceAccountConfigured: Boolean(env.FIREBASE_SERVICE_ACCOUNT),
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Send Nearu Event Endpoint
    if (url.pathname === '/api/send-nearu' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return jsonResponse({ error: 'Missing or malformed Authorization header' }, 401);
      }

      const idToken = authHeader.substring(7).trim();
      const firebaseProjectId = env.FIREBASE_PROJECT_ID || 'nearu-962eb';

      // Verify Firebase ID Token cryptographically
      let verifiedToken;
      try {
        verifiedToken = await verifyFirebaseIdToken(idToken, firebaseProjectId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid token';
        return jsonResponse({ error: `Authentication failed: ${msg}` }, 401);
      }

      const senderUid = verifiedToken.uid;

      // Parse and validate request body
      interface SendNearuBody {
        toUid?: string;
        message?: string;
        type?: string;
        eventId?: string;
        fromName?: string;
      }

      let body: SendNearuBody;
      try {
        body = (await request.json()) as SendNearuBody;
      } catch {
        return jsonResponse({ error: 'Invalid JSON request body' }, 400);
      }

      const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

      const toUid = typeof body.toUid === 'string' ? body.toUid.trim() : '';
      const rawMessage = typeof body.message === 'string' ? body.message.trim() : 'Thinking of you 💙';
      const eventType = body.type === 'long_press' ? 'long_press' : 'standard';
      const eventId = typeof body.eventId === 'string' && body.eventId.trim()
        ? body.eventId.trim()
        : `event_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const fromName = typeof body.fromName === 'string'
        ? body.fromName.trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 30)
        : 'Friend';

      // Validation
      if (!toUid) {
        return jsonResponse({ error: 'Missing required field: toUid' }, 400);
      }
      if (!ID_PATTERN.test(toUid)) {
        return jsonResponse(
          { error: 'Invalid toUid format. Must be 1-128 alphanumeric characters, underscores, or hyphens.' },
          400
        );
      }
      if (!ID_PATTERN.test(senderUid)) {
        return jsonResponse({ error: 'Invalid senderUid format.' }, 400);
      }
      if (!ID_PATTERN.test(eventId)) {
        return jsonResponse(
          { error: 'Invalid eventId format. Must be 1-128 alphanumeric characters, underscores, or hyphens.' },
          400
        );
      }
      if (toUid === senderUid) {
        return jsonResponse({ error: 'Cannot send a NearU to yourself' }, 400);
      }
      if (!rawMessage) {
        return jsonResponse({ error: 'Message cannot be empty' }, 400);
      }
      if (rawMessage.length > 120) {
        return jsonResponse({ error: 'Message exceeds maximum length of 120 characters' }, 400);
      }

      // Edge-level duplicate prevention (Cache API + local isolate memory)
      if (await isDuplicateEvent(eventId)) {
        return jsonResponse({ success: true, message: 'Event already processed', eventId, duplicate: true });
      }

      // Edge-level Rate Limiting (5-second cooldown per friend pair)
      const rateCheck = await checkRateLimit(senderUid, toUid);
      if (!rateCheck.allowed) {
        return jsonResponse(
          {
            error: `Please wait ${rateCheck.waitSeconds}s before sending another NearU.`,
            cooldownRemaining: rateCheck.waitSeconds,
          },
          429
        );
      }

      // Check Service Account Secret
      if (!env.FIREBASE_SERVICE_ACCOUNT) {
        return jsonResponse(
          {
            error:
              'FIREBASE_SERVICE_ACCOUNT secret is not configured on this Cloudflare Worker. Please run `npx wrangler secret put FIREBASE_SERVICE_ACCOUNT`.',
          },
          500
        );
      }

      let serviceAccount: GoogleServiceAccount;
      try {
        serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as GoogleServiceAccount;
      } catch {
        return jsonResponse(
          { error: 'FIREBASE_SERVICE_ACCOUNT secret is not valid JSON.' },
          500
        );
      }

      const firestore = new FirestoreClient(serviceAccount);

      // Verify sender and recipient are accepted mutual friends
      const isFriend = await firestore.verifyMutualFriendship(senderUid, toUid);
      if (!isFriend) {
        return jsonResponse(
          { error: 'Forbidden: sender and recipient are not accepted friends.' },
          403
        );
      }

      // 1. Retrieve recipient-assigned custom nickname for sender (if any)
      let effectiveFromName = fromName;
      try {
        const recipientNickname = await firestore.getRecipientNickname(toUid, senderUid);
        if (recipientNickname) {
          effectiveFromName = recipientNickname;
        }
      } catch (nickErr) {
        console.warn('[Worker Push] Failed to retrieve recipient nickname, falling back to fromName:', nickErr);
      }

      // 2. Deliver event to recipient's nearu_events subcollection
      // (This triggers in-app reception when app is open in foreground)
      // Uses atomic document creation: if eventId already exists in Firestore (409 Conflict),
      // we detect it and avoid duplicate push delivery across concurrent isolates.
      const createResult = await firestore.createNearuEventDoc(toUid, eventId, {
        fromUid: senderUid,
        fromName: effectiveFromName,
        message: rawMessage,
        type: eventType,
      });

      if (createResult.alreadyExists) {
        return jsonResponse({
          success: true,
          message: 'Event already processed',
          eventId,
          duplicate: true,
        });
      }

      // 3. Fetch recipient's Expo push tokens
      const tokenRecords = await firestore.getRecipientPushTokens(toUid);
      const pushTokens = tokenRecords.map((r) => r.token);

      let deliveryResult: SendPushResult = {
        totalAttempted: 0,
        totalSuccessful: 0,
        tickets: [],
        successfulTickets: [],
        unregisteredTokens: [],
        errors: [],
      };

      // 4. Send Push Notifications via Expo Push Service
      if (pushTokens.length > 0) {
        try {
          deliveryResult = await sendExpoPushNotifications(pushTokens, {
            message: rawMessage,
            type: eventType,
            eventId,
            fromUid: senderUid,
            fromName: effectiveFromName,
          });

          // 4. Save pending receipt records in Firestore for successfully queued tickets
          for (const st of deliveryResult.successfulTickets) {
            const matchingRecord = tokenRecords.find((r) => r.token === st.token);
            if (matchingRecord) {
              await firestore.savePendingReceipt({
                ticketId: st.ticketId,
                recipientUid: toUid,
                token: st.token,
                collection: matchingRecord.collection,
                docId: matchingRecord.docId,
                createdAt: Date.now(),
              });
            }
          }

          // 5. Clean up any invalid/unregistered tokens immediately
          if (deliveryResult.unregisteredTokens.length > 0) {
            for (const unregToken of deliveryResult.unregisteredTokens) {
              const matchingRecord = tokenRecords.find((r) => r.token === unregToken);
              if (matchingRecord) {
                await firestore.deletePushToken(toUid, matchingRecord);
              }
            }
          }
        } catch (pushErr) {
          console.error('[Worker Push] Error sending push notification:', pushErr);
        }
      }

      // If tokens existed but all failed at the ticket level (e.g. InvalidCredentials, DeviceNotRegistered)
      // Never report successful delivery merely because the Expo HTTP request returned 200.
      if (pushTokens.length > 0 && deliveryResult.totalSuccessful === 0 && deliveryResult.errors.length > 0) {
        return jsonResponse(
          {
            success: false,
            error: deliveryResult.errors[0]?.message || 'Push notification delivery failed at Expo.',
            eventId,
            tokensAttempted: pushTokens.length,
            tokensDelivered: 0,
            errors: deliveryResult.errors,
          },
          502
        );
      }

      return jsonResponse({
        success: true,
        message: deliveryResult.totalSuccessful > 0
          ? 'NearU delivered successfully.'
          : (pushTokens.length === 0
              ? 'NearU delivered to Firestore (recipient has no active push tokens).'
              : 'NearU delivered to Firestore.'),
        eventId,
        tokensDelivered: deliveryResult.totalSuccessful,
        tokensAttempted: pushTokens.length,
        errors: deliveryResult.errors.length > 0 ? deliveryResult.errors : undefined,
      });
    }

    return jsonResponse({ error: 'Not Found' }, 404);
  },

  /**
   * Scheduled cron handler for Cloudflare Workers Free Tier.
   * Can be configured via wrangler.toml `[triggers] crons = ["* /30 * * * *"]` without paid services.
   */
  async scheduled(event: unknown, env: Env, ctx: { waitUntil: (promise: Promise<unknown>) => void }): Promise<void> {
    if (env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as GoogleServiceAccount;
        const firestore = new FirestoreClient(serviceAccount);
        ctx.waitUntil(processPendingPushReceipts(firestore));
      } catch (err) {
        console.warn('[Worker Push] Error in scheduled receipt handler:', err);
      }
    }
  },
};

/**
 * Processes pending Expo push receipts from Firestore.
 * Queries Expo receipts only for tickets that are at least 15 minutes old (so we do not query too early).
 * Cleans up DeviceNotRegistered tokens and removes processed receipt records.
 */
export async function processPendingPushReceipts(firestore: FirestoreClient): Promise<{
  checked: number;
  confirmedDelivered: number;
  unregisteredTokensRemoved: number;
  pendingRemaining: number;
  errors: Array<{ ticketId: string; code: string; message: string }>;
}> {
  // Query pending receipts older than 15 minutes (900,000 ms)
  const MIN_RECEIPT_AGE_MS = 15 * 60 * 1000;
  const eligibleReceipts = await firestore.getPendingReceipts(MIN_RECEIPT_AGE_MS);

  if (eligibleReceipts.length === 0) {
    return {
      checked: 0,
      confirmedDelivered: 0,
      unregisteredTokensRemoved: 0,
      pendingRemaining: 0,
      errors: [],
    };
  }

  const receiptResult = await fetchExpoPushReceipts(
    eligibleReceipts.map((r) => ({ ticketId: r.ticketId, token: r.token }))
  );

  let cleanedTokensCount = 0;

  // Clean up confirmed delivered receipt records
  for (const ticketId of receiptResult.confirmedDelivered) {
    await firestore.deletePendingReceipt(ticketId);
  }

  // Handle unregistered tokens identified by receipts
  for (const unregToken of receiptResult.unregisteredTokens) {
    const matchingReceipt = eligibleReceipts.find((r) => r.token === unregToken);
    if (matchingReceipt) {
      await firestore.deletePushToken(matchingReceipt.recipientUid, {
        docId: matchingReceipt.docId,
        token: matchingReceipt.token,
        collection: matchingReceipt.collection,
      });
      await firestore.deletePendingReceipt(matchingReceipt.ticketId);
      cleanedTokensCount++;
    }
  }

  // Clean up receipts with non-transient errors
  for (const err of receiptResult.receiptErrors) {
    if (err.code !== 'MessageRateExceeded') {
      await firestore.deletePendingReceipt(err.ticketId);
    }
  }

  return {
    checked: receiptResult.checkedCount,
    confirmedDelivered: receiptResult.confirmedDelivered.length,
    unregisteredTokensRemoved: cleanedTokensCount,
    pendingRemaining: receiptResult.pendingTicketIds.length,
    errors: receiptResult.receiptErrors,
  };
}

