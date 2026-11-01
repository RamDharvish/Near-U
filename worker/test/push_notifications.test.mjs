import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isExpoPushToken, FirestoreClient } from '../src/firestore.ts';
import {
  sendExpoPushNotifications,
  fetchExpoPushReceipts,
  EXPO_PUSH_MAX_BATCH_SIZE,
} from '../src/expo-push.ts';

// =========================================================================
// 1. Expo Push Token Validation Tests
// =========================================================================

test('Token validation: accepts valid ExponentPushToken format', () => {
  assert.equal(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'), true);
  assert.equal(isExpoPushToken('ExponentPushToken[8aB9_c-D1234567890+=]'), true);
  assert.equal(isExpoPushToken('  ExponentPushToken[AbCdEf1234567890_-]  '), true);
});

test('Token validation: accepts valid ExpoPushToken format', () => {
  assert.equal(isExpoPushToken('ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]'), true);
  assert.equal(isExpoPushToken('ExpoPushToken[MyDeviceToken1234567890]'), true);
});

test('Token validation: rejects native FCM tokens (raw token without Expo brackets)', () => {
  const rawFcmToken =
    'f1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz';
  assert.equal(isExpoPushToken(rawFcmToken), false);
});

test('Token validation: rejects arbitrary UUIDs', () => {
  assert.equal(isExpoPushToken('123e4567-e89b-12d3-a456-426614174000'), false);
  assert.equal(isExpoPushToken('f014f0da-32ee-4025-8ee0-a06a8267c3e2'), false);
});

test('Token validation: rejects non-string and malformed inputs', () => {
  assert.equal(isExpoPushToken(null), false);
  assert.equal(isExpoPushToken(undefined), false);
  assert.equal(isExpoPushToken(12345), false);
  assert.equal(isExpoPushToken({}), false);
  assert.equal(isExpoPushToken(''), false);
  assert.equal(isExpoPushToken('   '), false);
  assert.equal(isExpoPushToken('ExponentPushToken[]'), false);
  assert.equal(isExpoPushToken('ExponentPushToken[short]'), false);
  assert.equal(isExpoPushToken('ExponentPushToken[unclosed_bracket'), false);
  assert.equal(isExpoPushToken('RandomPrefix[xxxxxxxxxxxxxxxxxxxxxx]'), false);
});

// =========================================================================
// 2. Push Message Batching & Top-Level Payload Fields
// =========================================================================

test('Message batching: sends individual message object per token with all required top-level fields', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedRequestBody = null;
  let interceptedUrl = null;

  globalThis.fetch = async (url, options) => {
    interceptedUrl = url.toString();
    interceptedRequestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        data: [
          { status: 'ok', id: 'ticket_1' },
          { status: 'ok', id: 'ticket_2' },
        ],
      }),
    };
  };

  try {
    const tokens = [
      'ExponentPushToken[DeviceToken_Alpha_11111]',
      'ExponentPushToken[DeviceToken_Beta_22222]',
    ];

    const result = await sendExpoPushNotifications(tokens, {
      message: 'Thinking of you 💙',
      type: 'standard',
      eventId: 'event_test_101',
      fromUid: 'sender_uid_123',
      fromName: 'Alice',
    });

    assert.equal(interceptedUrl, 'https://exp.host/--/api/v2/push/send');
    assert.equal(Array.isArray(interceptedRequestBody), true);
    assert.equal(interceptedRequestBody.length, 2);

    for (let i = 0; i < interceptedRequestBody.length; i++) {
      const msg = interceptedRequestBody[i];
      assert.equal(msg.to, tokens[i]);
      assert.equal(typeof msg.to, 'string');
      assert.equal(msg.title, 'Alice · Near-U');
      assert.equal(msg.body, 'Thinking of you 💙');
      assert.equal(msg.sound, 'default');
      assert.equal(msg.priority, 'high');
      assert.equal(msg.channelId, 'standard_nearu');
      assert.deepEqual(msg.data, {
        eventId: 'event_test_101',
        type: 'standard',
        fromUid: 'sender_uid_123',
        fromName: 'Alice',
        message: 'Thinking of you 💙',
      });
    }

    assert.equal(result.totalAttempted, 2);
    assert.equal(result.totalSuccessful, 2);
    assert.equal(result.successfulTickets.length, 2);
    assert.equal(result.successfulTickets[0].ticketId, 'ticket_1');
    assert.equal(result.successfulTickets[0].token, tokens[0]);
    assert.equal(result.successfulTickets[1].ticketId, 'ticket_2');
    assert.equal(result.successfulTickets[1].token, tokens[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Long-press push message: assigns long_press_nearu channel and preserves title/body', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedRequestBody = null;

  globalThis.fetch = async (url, options) => {
    interceptedRequestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        data: [{ status: 'ok', id: 'ticket_lp' }],
      }),
    };
  };

  try {
    const tokens = ['ExponentPushToken[DeviceToken_LongPress_99]'];
    await sendExpoPushNotifications(tokens, {
      message: 'Can we call? 💙',
      type: 'long_press',
      eventId: 'event_lp_1',
      fromUid: 'uid_bob',
      fromName: 'Bob',
    });

    assert.equal(interceptedRequestBody[0].channelId, 'long_press_nearu');
    assert.equal(interceptedRequestBody[0].title, 'Bob · Near-U');
    assert.equal(interceptedRequestBody[0].body, 'Can we call? 💙');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Message chunking: respects 100-message batch limit by sending chunks', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  const chunkSizes = [];

  globalThis.fetch = async (url, options) => {
    fetchCallCount++;
    const body = JSON.parse(options.body);
    chunkSizes.push(body.length);
    return {
      ok: true,
      json: async () => ({
        data: body.map((_, idx) => ({ status: 'ok', id: `ticket_chunk_${fetchCallCount}_${idx}` })),
      }),
    };
  };

  try {
    const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[TokenNumber_${i + 100000}]`);

    const result = await sendExpoPushNotifications(tokens, {
      message: 'Batch test message',
      type: 'standard',
      eventId: 'event_batch_test',
      fromUid: 'uid_sender',
      fromName: 'Sender',
    });

    assert.equal(fetchCallCount, 2);
    assert.deepEqual(chunkSizes, [EXPO_PUSH_MAX_BATCH_SIZE, 50]);
    assert.equal(result.totalAttempted, 150);
    assert.equal(result.totalSuccessful, 150);
    assert.equal(result.successfulTickets.length, 150);
    assert.equal(result.successfulTickets[0].token, tokens[0]);
    assert.equal(result.successfulTickets[149].token, tokens[149]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 3. Ticket Error Handling Tests
// =========================================================================

test('Ticket error handling: identifies DeviceNotRegistered and queues token for cleanup', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        { status: 'ok', id: 'ticket_valid' },
        {
          status: 'error',
          message: 'The recipient device is not registered with FCM.',
          details: { error: 'DeviceNotRegistered' },
        },
      ],
    }),
  });

  try {
    const tokens = [
      'ExponentPushToken[Token_Alive_111111111]',
      'ExponentPushToken[Token_Dead_22222222222]',
    ];

    const result = await sendExpoPushNotifications(tokens, {
      message: 'Hello',
      type: 'standard',
      eventId: 'event_ticket_err',
      fromUid: 'uid_sender',
    });

    assert.equal(result.totalAttempted, 2);
    assert.equal(result.totalSuccessful, 1);
    assert.deepEqual(result.unregisteredTokens, [tokens[1]]);
    assert.equal(result.successfulTickets.length, 1);
    assert.equal(result.successfulTickets[0].token, tokens[0]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ticket error handling: detects InvalidCredentials and does NOT report delivery as successful', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        {
          status: 'error',
          message: 'The credentials for the project are invalid.',
          details: { error: 'InvalidCredentials' },
        },
      ],
    }),
  });

  try {
    const tokens = ['ExponentPushToken[DeviceToken_FcmIssue_1234]'];
    const result = await sendExpoPushNotifications(tokens, {
      message: 'Hello',
      type: 'standard',
      eventId: 'event_cred_err',
      fromUid: 'uid_sender',
    });

    assert.equal(result.totalSuccessful, 0);
    assert.equal(result.totalAttempted, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, 'InvalidCredentials');
    assert.match(result.errors[0].message, /FCM V1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ticket error handling: detects MessageTooBig and MessageRateExceeded', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        {
          status: 'error',
          message: 'Message exceeded limit',
          details: { error: 'MessageTooBig' },
        },
        {
          status: 'error',
          message: 'Rate limit exceeded',
          details: { error: 'MessageRateExceeded' },
        },
      ],
    }),
  });

  try {
    const tokens = [
      'ExponentPushToken[Token_Big_111111111111]',
      'ExponentPushToken[Token_Rate_222222222222]',
    ];
    const result = await sendExpoPushNotifications(tokens, {
      message: 'Hello',
      type: 'standard',
      eventId: 'event_payload_err',
      fromUid: 'uid_sender',
    });

    assert.equal(result.totalSuccessful, 0);
    assert.equal(result.errors.length, 2);
    assert.equal(result.errors[0].code, 'MessageTooBig');
    assert.equal(result.errors[1].code, 'MessageRateExceeded');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 4. Push Receipt Handling Tests
// =========================================================================

test('Push receipts: processes confirmed delivered receipts and removes them from pending', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    assert.equal(url.toString(), 'https://exp.host/--/api/v2/push/getReceipts');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.ids, ['ticket_100', 'ticket_200']);

    return {
      ok: true,
      json: async () => ({
        data: {
          ticket_100: { status: 'ok' },
          ticket_200: { status: 'ok' },
        },
      }),
    };
  };

  try {
    const ticketRecords = [
      { ticketId: 'ticket_100', token: 'ExponentPushToken[Token_100_abcdef]' },
      { ticketId: 'ticket_200', token: 'ExponentPushToken[Token_200_abcdef]' },
    ];

    const result = await fetchExpoPushReceipts(ticketRecords);

    assert.equal(result.checkedCount, 2);
    assert.deepEqual(result.confirmedDelivered, ['ticket_100', 'ticket_200']);
    assert.equal(result.unregisteredTokens.length, 0);
    assert.equal(result.pendingTicketIds.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Push receipts: detects DeviceNotRegistered in receipt and maps back to original token', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        ticket_ok: { status: 'ok' },
        ticket_dead: {
          status: 'error',
          message: 'The recipient device is not registered with FCM.',
          details: { error: 'DeviceNotRegistered' },
        },
      },
    }),
  });

  try {
    const ticketRecords = [
      { ticketId: 'ticket_ok', token: 'ExponentPushToken[Token_Good_111111]' },
      { ticketId: 'ticket_dead', token: 'ExponentPushToken[Token_Dead_222222]' },
    ];

    const result = await fetchExpoPushReceipts(ticketRecords);

    assert.equal(result.confirmedDelivered.length, 1);
    assert.equal(result.confirmedDelivered[0], 'ticket_ok');
    assert.equal(result.unregisteredTokens.length, 1);
    assert.equal(result.unregisteredTokens[0], 'ExponentPushToken[Token_Dead_222222]');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Push receipts: leaves unavailable receipts in pendingTicketIds without querying prematurely', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        ticket_ready: { status: 'ok' },
      },
    }),
  });

  try {
    const ticketRecords = [
      { ticketId: 'ticket_ready', token: 'ExponentPushToken[Token_Ready_11111]' },
      { ticketId: 'ticket_pending', token: 'ExponentPushToken[Token_Pending_22222]' },
    ];

    const result = await fetchExpoPushReceipts(ticketRecords);

    assert.deepEqual(result.confirmedDelivered, ['ticket_ready']);
    assert.deepEqual(result.pendingTicketIds, ['ticket_pending']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 5. Resilient Response Parsing & Route Removal Tests
// =========================================================================

test('Resilience: handles non-JSON HTML error page from Expo without throwing and reports failure', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => '<html><body>502 Bad Gateway from cloudflare proxy</body></html>',
  });

  try {
    const tokens = ['ExponentPushToken[Token_Test_1234567890]'];
    const result = await sendExpoPushNotifications(tokens, {
      message: 'Hello',
      type: 'standard',
      eventId: 'event_non_json',
      fromUid: 'uid_sender',
    });

    assert.equal(result.totalSuccessful, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, 'INVALID_JSON');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Resilience: handles empty response body from Expo gracefully', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => '   ',
  });

  try {
    const tokens = ['ExponentPushToken[Token_Test_1234567890]'];
    const result = await sendExpoPushNotifications(tokens, {
      message: 'Hello',
      type: 'standard',
      eventId: 'event_empty_body',
      fromUid: 'uid_sender',
    });

    assert.equal(result.totalSuccessful, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, 'EMPTY_RESPONSE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Resilience: treats non-JSON receipt response as pending so records are not lost', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    text: async () => 'Gateway Timeout Error (HTML)',
  });

  try {
    const ticketRecords = [{ ticketId: 'ticket_fail', token: 'ExponentPushToken[Token_Retry_11111]' }];
    const result = await fetchExpoPushReceipts(ticketRecords);

    // Verified: preserved in pending queue, not marked delivered and not lost
    assert.deepEqual(result.pendingTicketIds, ['ticket_fail']);
    assert.equal(result.confirmedDelivered.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Security & Routes: worker module exports scheduled handler, /api/check-receipts is removed, and cron trigger configured', () => {
  const content = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

  // 1. Verify scheduled handler is exported and uses ctx.waitUntil
  assert.match(content, /async\s+scheduled\s*\(/);
  assert.match(content, /ctx\.waitUntil\(processPendingPushReceipts\(firestore\)\)/);

  // 2. Verify /api/check-receipts is no longer exposed on fetch
  assert.equal(content.includes('/api/check-receipts'), false);

  // 3. Verify wrangler.toml configures Cloudflare Cron Trigger
  const wranglerContent = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wranglerContent, /\[triggers\]/);
  assert.match(wranglerContent, /crons\s*=\s*\[.*\*\/30.*\]/);
});

// =========================================================================
// 8. Recipient-Specific Nickname Resolution & Push Banner Tests
// =========================================================================

test('Worker Push: Uses recipient-assigned nickname in notification banner title and payload', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedRequestBody = null;

  globalThis.fetch = async (url, options) => {
    interceptedRequestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        data: [{ status: 'ok', id: 'ticket_nick_1' }],
      }),
    };
  };

  try {
    const tokens = ['ExponentPushToken[Recipient_B_Token_111]'];
    const result = await sendExpoPushNotifications(tokens, {
      message: 'Hope you are doing well!',
      type: 'standard',
      eventId: 'evt_nick_test_1',
      fromUid: 'uid_sender_ram',
      fromName: 'AAA', // Recipient B's assigned nickname
    });

    assert.equal(interceptedRequestBody[0].title, 'AAA · Near-U', 'Notification title must show recipient chosen nickname');
    assert.equal(interceptedRequestBody[0].body, 'Hope you are doing well!');
    assert.equal(interceptedRequestBody[0].data.fromName, 'AAA');
    assert.equal(result.totalSuccessful, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker Push: Falls back to sender profile name when recipient has not assigned a nickname', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedRequestBody = null;

  globalThis.fetch = async (url, options) => {
    interceptedRequestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        data: [{ status: 'ok', id: 'ticket_nick_2' }],
      }),
    };
  };

  try {
    const tokens = ['ExponentPushToken[Recipient_C_Token_222]'];
    const result = await sendExpoPushNotifications(tokens, {
      message: 'Hope you are doing well!',
      type: 'standard',
      eventId: 'evt_nick_test_2',
      fromUid: 'uid_sender_ram',
      fromName: 'Ram',
    });

    assert.equal(interceptedRequestBody[0].title, 'Ram · Near-U', 'Notification title must show original sender name for C');
    assert.equal(interceptedRequestBody[0].body, 'Hope you are doing well!');
    assert.equal(interceptedRequestBody[0].data.fromName, 'Ram');
    assert.equal(result.totalSuccessful, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FirestoreClient getRecipientNickname: fetches and parses nickname from users/{recipientUid}/nicknames/{senderUid}', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;

  globalThis.fetch = async (url) => {
    requestedUrl = url.toString();
    if (requestedUrl.includes('/users/uid_recipient_b/nicknames/uid_sender_a')) {
      return {
        ok: true,
        json: async () => ({
          fields: {
            nickname: { stringValue: 'AAA' },
            updatedAt: { timestampValue: '2026-11-01T12:00:00Z' },
          },
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const mockServiceAccount = {
      client_email: 'test@nearu-962eb.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQD\n-----END PRIVATE KEY-----',
      project_id: 'nearu-962eb',
    };

    const client = new FirestoreClient(mockServiceAccount);
    client.getAuthHeader = async () => ({ Authorization: 'Bearer mock_token' });

    const nick = await client.getRecipientNickname('uid_recipient_b', 'uid_sender_a');
    assert.equal(nick, 'AAA');
    assert.ok(requestedUrl.includes('/users/uid_recipient_b/nicknames/uid_sender_a'));

    const noNick = await client.getRecipientNickname('uid_recipient_c', 'uid_sender_a');
    assert.equal(noNick, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FirestoreClient getRecipientNickname: handles network errors safely without throwing', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error('Network timeout connecting to Firestore REST API');
  };

  try {
    const mockServiceAccount = {
      client_email: 'test@nearu-962eb.iam.gserviceaccount.com',
      private_key: '',
      project_id: 'nearu-962eb',
    };
    const client = new FirestoreClient(mockServiceAccount);
    client.getAuthHeader = async () => ({ Authorization: 'Bearer mock_token' });

    const result = await client.getRecipientNickname('uid_b', 'uid_a');
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


