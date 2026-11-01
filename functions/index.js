const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * Triggers when a NearU message event document is created in Firestore.
 * Verifies mutual friendship between sender and recipient, then delivers
 * a high-priority push notification via FCM to the recipient's registered devices.
 */
exports.sendNearuPushNotification = onDocumentCreated(
  'users/{recipientUid}/nearu_events/{eventId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const eventData = snap.data();
    const recipientUid = event.params.recipientUid;
    const fromUid = eventData.fromUid;
    const eventType = eventData.type || 'standard';

    if (!fromUid || !recipientUid) {
      console.warn('[NearU FCM] Missing fromUid or recipientUid', { fromUid, recipientUid });
      return;
    }

    // 1. Server-side Friendship Verification
    // Ensure sender and recipient have an accepted friendship before pushing notifications
    const db = admin.firestore();
    const friendDoc = await db
      .collection('users')
      .doc(recipientUid)
      .collection('friends')
      .doc(fromUid)
      .get();

    if (!friendDoc.exists) {
      // Check friend_requests as secondary verification
      const reqDoc = await db
        .collection('friend_requests')
        .doc(`${fromUid}_${recipientUid}`)
        .get();

      const reverseReqDoc = await db
        .collection('friend_requests')
        .doc(`${recipientUid}_${fromUid}`)
        .get();

      const hasAccepted =
        (reqDoc.exists && reqDoc.data().status === 'accepted') ||
        (reverseReqDoc.exists && reverseReqDoc.data().status === 'accepted');

      if (!hasAccepted) {
        console.warn('[NearU FCM] Unauthorized event: sender is not an accepted friend', {
          fromUid,
          recipientUid,
        });
        return;
      }
    }

    // 2. Fetch recipient's registered device FCM tokens
    const tokensSnap = await db
      .collection('users')
      .doc(recipientUid)
      .collection('fcm_tokens')
      .get();

    if (tokensSnap.empty) {
      console.info(`[NearU FCM] No FCM tokens registered for recipient: ${recipientUid}`);
      return;
    }

    const tokenDocs = tokensSnap.docs;
    const tokens = tokenDocs.map((d) => d.data().token).filter(Boolean);

    if (tokens.length === 0) return;

    // 3. Prepare Notification Content based on message type
    const isLongPress = eventType === 'long_press';
    const title = 'NearU 💙';
    const body = isLongPress
      ? 'Someone misses you so much 💙'
      : 'Someone misses you 💙';
    const channelId = isLongPress ? 'long_press_nearu' : 'standard_nearu';

    // 4. Construct FCM message payload with high priority Android delivery
    const message = {
      tokens: tokens,
      notification: {
        title,
        body,
      },
      data: {
        eventId: event.params.eventId,
        type: eventType,
        fromUid: fromUid,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: channelId,
          color: '#7958CF',
          defaultVibrateTimings: false,
        },
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[NearU FCM] Delivered ${response.successCount} of ${tokens.length} messages.`);

      // 5. Clean up expired / unregistered tokens
      const cleanupPromises = [];
      response.responses.forEach((resp, index) => {
        if (!resp.success && resp.error) {
          const errCode = resp.error.code;
          if (
            errCode === 'messaging/registration-token-not-registered' ||
            errCode === 'messaging/invalid-registration-token'
          ) {
            console.info('[NearU FCM] Cleaning up invalid token:', tokenDocs[index].id);
            cleanupPromises.push(tokenDocs[index].ref.delete());
          }
        }
      });

      if (cleanupPromises.length > 0) {
        await Promise.all(cleanupPromises);
      }
    } catch (err) {
      console.error('[NearU FCM] Error sending multicast push notification:', err);
    }
  }
);
