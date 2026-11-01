import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveFriendDisplayName, formatIncomingNearuToast } from '../src/services/displayName.ts';

// =========================================================================
// 1. Message Validation Logic Tests
// =========================================================================
const MAX_MESSAGE_LENGTH = 120;
const MAX_CUSTOM_MESSAGES = 5;

function validateMessageText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return {
      isValid: false,
      error: 'Message cannot be empty.',
      trimmed: '',
    };
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return {
      isValid: false,
      error: `Message must be ${MAX_MESSAGE_LENGTH} characters or less (${trimmed.length}/${MAX_MESSAGE_LENGTH}).`,
      trimmed,
    };
  }
  return {
    isValid: true,
    trimmed,
  };
}

test('Message validation: trims leading and trailing whitespace', () => {
  const result = validateMessageText('   Thinking of you 💙   ');
  assert.equal(result.isValid, true);
  assert.equal(result.trimmed, 'Thinking of you 💙');
});

test('Message validation: rejects empty or whitespace-only message', () => {
  assert.equal(validateMessageText('').isValid, false);
  assert.equal(validateMessageText('    ').isValid, false);
  assert.equal(validateMessageText(null).isValid, false);
  assert.equal(validateMessageText(undefined).isValid, false);
});

test('Message validation: enforces maximum 120-character limit', () => {
  const valid120 = 'a'.repeat(120);
  assert.equal(validateMessageText(valid120).isValid, true);
  assert.equal(validateMessageText(valid120).trimmed.length, 120);

  const invalid121 = 'a'.repeat(121);
  const result = validateMessageText(invalid121);
  assert.equal(result.isValid, false);
  assert.match(result.error, /120 characters or less/);
});

// =========================================================================
// 2. Custom Message Limit Tests (1 default + up to 5 custom = 6 total)
// =========================================================================
function simulateAddMessage(currentMessages, text) {
  const validation = validateMessageText(text);
  if (!validation.isValid) {
    return { success: false, error: validation.error, messages: currentMessages };
  }
  const customCount = currentMessages.filter((m) => !m.isDefault).length;
  if (customCount >= MAX_CUSTOM_MESSAGES) {
    return {
      success: false,
      error: `Limit reached: You can save up to ${MAX_CUSTOM_MESSAGES} custom messages.`,
      messages: currentMessages,
    };
  }
  const newMsg = {
    id: `msg_${Date.now()}_${Math.random()}`,
    text: validation.trimmed,
    isDefault: false,
    createdAt: Date.now(),
  };
  return { success: true, messages: [...currentMessages, newMsg] };
}

test('Five-custom-message limit: allows adding up to 5 additional custom messages', () => {
  let messages = [
    { id: 'default', text: 'Thinking of you 💙', isDefault: true, createdAt: 1000 },
  ];

  // Add 5 custom messages successfully
  for (let i = 1; i <= 5; i++) {
    const res = simulateAddMessage(messages, `Custom Message ${i}`);
    assert.equal(res.success, true, `Failed at message ${i}`);
    messages = res.messages;
  }

  assert.equal(messages.length, 6); // 1 default + 5 custom
  const customOnly = messages.filter((m) => !m.isDefault);
  assert.equal(customOnly.length, 5);

  // Attempt to add 6th custom message -> should be rejected
  const overflowRes = simulateAddMessage(messages, 'One too many!');
  assert.equal(overflowRes.success, false);
  assert.match(overflowRes.error, /Limit reached/);
  assert.equal(overflowRes.messages.length, 6);
});

// =========================================================================
// 3. Default Selection Tests
// =========================================================================
function simulateSetDefault(messages, id) {
  if (!messages.some((m) => m.id === id)) {
    return { success: false, error: 'Message not found.', messages };
  }
  const updated = messages.map((m) => ({
    ...m,
    isDefault: m.id === id,
  }));
  return { success: true, messages: updated };
}

test('Default selection: designates chosen message as default and unsets previous default', () => {
  const messages = [
    { id: 'msg1', text: 'Default one', isDefault: true, createdAt: 1 },
    { id: 'msg2', text: 'Custom two', isDefault: false, createdAt: 2 },
  ];

  const res = simulateSetDefault(messages, 'msg2');
  assert.equal(res.success, true);
  assert.equal(res.messages.find((m) => m.id === 'msg2')?.isDefault, true);
  assert.equal(res.messages.find((m) => m.id === 'msg1')?.isDefault, false);

  // Exactly one message is default
  const defaultCount = res.messages.filter((m) => m.isDefault).length;
  assert.equal(defaultCount, 1);
});

// =========================================================================
// 4. Deletion Fallback Tests
// =========================================================================
function simulateDeleteMessage(messages, id, currentSelectedId) {
  if (messages.length <= 1) {
    return { success: false, error: 'You must keep at least one saved message.', messages };
  }
  const target = messages.find((m) => m.id === id);
  if (!target) {
    return { success: false, error: 'Message not found.', messages };
  }
  const remaining = messages.filter((m) => m.id !== id);

  let fallbackSelectedId;
  if (target.isDefault && remaining.length > 0) {
    remaining[0].isDefault = true;
    fallbackSelectedId = remaining[0].id;
  } else {
    const currentDefault = remaining.find((m) => m.isDefault);
    if (currentDefault) {
      fallbackSelectedId = currentDefault.id;
    }
  }

  let newSelectedId = currentSelectedId;
  if (currentSelectedId === id && fallbackSelectedId) {
    newSelectedId = fallbackSelectedId;
  }

  return { success: true, messages: remaining, newSelectedId };
}

test('Deletion fallback: deleting the active default promotes another message and falls back selectedId', () => {
  const messages = [
    { id: 'msg1', text: 'Default message', isDefault: true, createdAt: 1 },
    { id: 'msg2', text: 'Second message', isDefault: false, createdAt: 2 },
  ];

  const res = simulateDeleteMessage(messages, 'msg1', 'msg1');
  assert.equal(res.success, true);
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].id, 'msg2');
  assert.equal(res.messages[0].isDefault, true);
  assert.equal(res.newSelectedId, 'msg2');
});

test('Deletion fallback: prevents deleting the only remaining message', () => {
  const messages = [
    { id: 'default', text: 'Thinking of you 💙', isDefault: true, createdAt: 1 },
  ];
  const res = simulateDeleteMessage(messages, 'default', 'default');
  assert.equal(res.success, false);
  assert.match(res.error, /keep at least one/);
});

// =========================================================================
// 5. Normal Tap vs Long-Press Behavior Tests
// =========================================================================
function buildNotificationPayload(type, customMessage, fromName) {
  const isLongPress = type === 'long_press';
  const title = fromName ? `${fromName} · Near-U` : 'Near-U 💙';
  return {
    title,
    body: customMessage,
    channelId: isLongPress ? 'long_press_nearu' : 'standard_nearu',
    vibrationPattern: isLongPress
      ? [0, 800, 200, 800, 200, 800, 200, 800, 200, 800] // ~5 seconds sustained
      : [0, 450, 150, 450], // double pulse
    data: {
      type,
      message: customMessage,
      fromName,
    },
  };
}

test('Normal tap notification: uses standard_nearu channel, double pulse, sender name, and selected message text', () => {
  const payload = buildNotificationPayload('standard', 'Can we talk later? 💙', 'Alice');
  assert.equal(payload.title, 'Alice · Near-U');
  assert.equal(payload.body, 'Can we talk later? 💙');
  assert.equal(payload.channelId, 'standard_nearu');
  assert.deepEqual(payload.vibrationPattern, [0, 450, 150, 450]);
  assert.equal(payload.data.type, 'standard');
  assert.equal(payload.data.fromName, 'Alice');
});

test('Long-press notification: uses long_press_nearu channel, ~5s sustained vibration, and does NOT overwrite custom text', () => {
  const payload = buildNotificationPayload('long_press', 'Miss you so much! 💙', 'Bob');
  assert.equal(payload.title, 'Bob · Near-U');
  assert.equal(payload.body, 'Miss you so much! 💙');
  assert.notEqual(payload.body, 'Someone misses you so much 💙'); // must not overwrite custom text!
  assert.equal(payload.channelId, 'long_press_nearu');
  // 5 pulses of 800ms + 4 pauses of 200ms = 4800ms (~5s)
  assert.equal(payload.vibrationPattern.length, 10);
  assert.deepEqual(payload.vibrationPattern, [0, 800, 200, 800, 200, 800, 200, 800, 200, 800]);
});

test('App display name configuration: app.json specifies Near-U', () => {
  const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'));
  assert.equal(appJson.expo.name, 'Near-U');
  assert.equal(appJson.expo.slug, 'nearu');
  assert.equal(appJson.expo.android.package, 'com.nearu.app');
});

// =========================================================================
// 6. Server-Side Duplicate Prevention & Rate Limiting Tests
// =========================================================================
test('Server-side duplicate prevention and rate limiting logic', () => {
  const processedEvents = new Set();
  const sendCooldowns = new Map();

  function processSend(senderUid, toUid, eventId, timestamp) {
    if (senderUid === toUid) {
      return { allowed: false, status: 400, error: 'Cannot send to yourself' };
    }
    if (processedEvents.has(eventId)) {
      return { allowed: true, status: 200, duplicate: true };
    }

    const key = `${senderUid}_${toUid}`;
    const lastSent = sendCooldowns.get(key) || 0;
    if (timestamp - lastSent < 5000) {
      const remaining = Math.ceil((5000 - (timestamp - lastSent)) / 1000);
      return { allowed: false, status: 429, error: 'Rate limit exceeded', remaining };
    }

    processedEvents.add(eventId);
    sendCooldowns.set(key, timestamp);
    return { allowed: true, status: 200 };
  }

  // 1. First send: allowed
  const res1 = processSend('userA', 'userB', 'event_1', 10000);
  assert.equal(res1.allowed, true);
  assert.equal(res1.status, 200);

  // 2. Duplicate eventId immediately: recognized as duplicate
  const resDup = processSend('userA', 'userB', 'event_1', 10500);
  assert.equal(resDup.duplicate, true);

  // 3. Second send before 5 seconds cooldown: rate-limited
  const res2 = processSend('userA', 'userB', 'event_2', 12000);
  assert.equal(res2.allowed, false);
  assert.equal(res2.status, 429);
  assert.equal(res2.remaining, 3);

  // 4. Send after 5 seconds: allowed
  const res3 = processSend('userA', 'userB', 'event_3', 15100);
  assert.equal(res3.allowed, true);
  assert.equal(res3.status, 200);

  // 5. Self-send: rejected
  const resSelf = processSend('userA', 'userA', 'event_4', 20000);
  assert.equal(resSelf.allowed, false);
  assert.equal(resSelf.status, 400);
});

// =========================================================================
// 7. Input Hardening & Path Safety Tests
// =========================================================================
test('Input hardening: strictly validates toUid, senderUid, and eventId against /^[a-zA-Z0-9_-]{1,128}$/', () => {
  const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

  function validateIds(senderUid, toUid, eventId) {
    if (!toUid || !ID_PATTERN.test(toUid)) {
      return { valid: false, error: 'Invalid toUid format' };
    }
    if (!senderUid || !ID_PATTERN.test(senderUid)) {
      return { valid: false, error: 'Invalid senderUid format' };
    }
    if (!eventId || !ID_PATTERN.test(eventId)) {
      return { valid: false, error: 'Invalid eventId format' };
    }
    return { valid: true };
  }

  // Valid standard Firebase UIDs and event IDs
  assert.equal(
    validateIds('ABc123_xyz-99', 'user_DEF456-789', 'event_1729000000_abc123').valid,
    true
  );

  // Path traversal attacks: MUST BE REJECTED
  assert.equal(validateIds('userA', '../otherUser', 'event1').valid, false);
  assert.equal(validateIds('userA', '../../etc/passwd', 'event1').valid, false);
  assert.equal(validateIds('userA', 'user/friends/other', 'event1').valid, false);
  assert.equal(validateIds('../attacker', 'userB', 'event1').valid, false);
  assert.equal(validateIds('userA', 'userB', '../event1').valid, false);

  // Dangerous punctuation and special characters: MUST BE REJECTED
  assert.equal(validateIds('userA', 'user*name', 'event1').valid, false);
  assert.equal(validateIds('userA', 'user?query=1', 'event1').valid, false);
  assert.equal(validateIds('userA', 'user#hash', 'event1').valid, false);
  assert.equal(validateIds('userA', 'user\nnewline', 'event1').valid, false);
  assert.equal(validateIds('userA', 'user\0nullbyte', 'event1').valid, false);

  // Length constraints
  assert.equal(validateIds('userA', '', 'event1').valid, false);
  assert.equal(validateIds('userA', 'a'.repeat(128), 'event1').valid, true);
  assert.equal(validateIds('userA', 'a'.repeat(129), 'event1').valid, false);
});

test('Firestore REST path safety: URL-encodes dynamic parameters to prevent path breakout', () => {
  const baseUrl = 'https://firestore.googleapis.com/v1/projects/nearu-962eb/databases/(default)/documents';

  function buildEventUrl(recipientUid, eventId) {
    const encodedRecipient = encodeURIComponent(recipientUid);
    const encodedEventId = encodeURIComponent(eventId);
    return `${baseUrl}/users/${encodedRecipient}/nearu_events?documentId=${encodedEventId}`;
  }

  const normalUrl = buildEventUrl('uid123', 'event456');
  assert.equal(normalUrl, `${baseUrl}/users/uid123/nearu_events?documentId=event456`);

  // Path injection attempt has slashes encoded by encodeURIComponent to prevent path breakout
  const injectionUrl = buildEventUrl('../admin_user', 'event?foo=bar#baz');
  assert.ok(injectionUrl.includes('..%2Fadmin_user'));
  assert.ok(injectionUrl.includes('event%3Ffoo%3Dbar%23baz'));
  assert.ok(!injectionUrl.includes('/admin_user/nearu_events'));
});

// =========================================================================
// 8. Distributed Rate Limiter & Atomic 409 Deduplication Tests
// =========================================================================
test('Atomic 409 Conflict duplicate suppression across concurrent workers', async () => {
  // Simulates Firestore global state across 2 concurrent edge locations
  const firestoreDb = new Map();
  let pushNotificationSendCount = 0;

  async function handleSendRequest(toUid, eventId, message) {
    // 1. Attempt atomic create in Firestore
    const docPath = `users/${toUid}/nearu_events/${eventId}`;
    if (firestoreDb.has(docPath)) {
      // HTTP 409 Conflict ALREADY_EXISTS returned by Firestore
      return { success: true, message: 'Event already processed', eventId, duplicate: true };
    }

    // Save document
    firestoreDb.set(docPath, { toUid, eventId, message, timestamp: Date.now() });

    // 2. Deliver push notification
    pushNotificationSendCount++;
    return { success: true, message: 'NearU delivered successfully.', eventId, duplicate: false };
  }

  // First request arrives at Edge PoP 1
  const req1 = await handleSendRequest('userB', 'event_atomic_test', 'Thinking of you');
  assert.equal(req1.duplicate, false);
  assert.equal(pushNotificationSendCount, 1);

  // Concurrent request with same eventId arrives at Edge PoP 2
  const req2 = await handleSendRequest('userB', 'event_atomic_test', 'Thinking of you');
  assert.equal(req2.duplicate, true);
  // Push notification was NOT sent a second time!
  assert.equal(pushNotificationSendCount, 1);
});

// =========================================================================
// 9. Recipient-Specific Nickname Resolution & In-App Toast Formatting Tests
// (Tests the ACTUAL exported implementations from src/services/displayName.ts)
// =========================================================================

test('Bug 2 fix: Recipient custom nickname takes priority over sender profile name', () => {
  // Scenario:
  // User A profile name is "Alice"
  // User B sets A's nickname to "AAA"
  // User A sends NearU to User B
  const senderFromA = {
    fromUid: 'uid_alice_123',
    fromNearuId: 'NEARU-ALICE1',
    fromName: 'Alice',
  };

  const recipientBNicknames = {
    uid_alice_123: 'AAA',
  };

  const recipientBFriends = [
    {
      id: 'uid_alice_123',
      uid: 'uid_alice_123',
      nearuId: 'NEARU-ALICE1',
      name: 'Alice',
    },
  ];

  const resolvedName = resolveFriendDisplayName(senderFromA, recipientBFriends, recipientBNicknames);
  assert.equal(resolvedName, 'AAA', 'B must see AAA because B assigned that nickname to A');
});

test('Bug 2 fix: Recipient custom nickname resolved by NearU ID key when UID not keyed', () => {
  const senderFromA = {
    fromUid: 'uid_alice_123',
    fromNearuId: 'NEARU-ALICE1',
    fromName: 'Alice',
  };

  const recipientBNicknames = {
    'NEARU-ALICE1': 'AAA-NearuId',
  };

  const resolvedName = resolveFriendDisplayName(senderFromA, [], recipientBNicknames);
  assert.equal(resolvedName, 'AAA-NearuId');
});

test('Bug 2 fix: Falls back to friend profile name when no nickname is assigned', () => {
  const senderFromA = {
    fromUid: 'uid_alice_123',
    fromNearuId: 'NEARU-ALICE1',
    fromName: 'Alice Profile',
  };

  const recipientBFriends = [
    {
      id: 'uid_alice_123',
      uid: 'uid_alice_123',
      name: 'Alice in Friends List',
    },
  ];

  // No custom nickname in storage
  const resolvedName = resolveFriendDisplayName(senderFromA, recipientBFriends, {});
  assert.equal(resolvedName, 'Alice in Friends List');
});

test('Bug 2 review: Preserves friend.nickname as a fallback before friend.name', () => {
  const senderFromA = {
    uid: 'uid_alice_123',
    name: 'Alice Profile',
  };

  const recipientBFriends = [
    {
      id: 'uid_alice_123',
      uid: 'uid_alice_123',
      name: 'Alice in Friends List',
      nickname: 'Legacy Stored Nickname',
    },
  ];

  // No custom nickname in recipient's nicknames map, but friend record has nickname
  const resolvedName = resolveFriendDisplayName(senderFromA, recipientBFriends, {});
  assert.equal(resolvedName, 'Legacy Stored Nickname', 'Must fall back to friend.nickname before friend.name');
});

test('Bug 2 review: Recipient nickname map takes priority and is NOT overridden by friend.nickname', () => {
  const senderFromA = {
    uid: 'uid_alice_123',
    name: 'Alice Profile',
  };

  const recipientBFriends = [
    {
      id: 'uid_alice_123',
      uid: 'uid_alice_123',
      name: 'Alice in Friends List',
      nickname: 'Old Stored Nickname',
    },
  ];

  const recipientBNicknames = {
    uid_alice_123: 'Active Map Nickname AAA',
  };

  const resolvedName = resolveFriendDisplayName(senderFromA, recipientBFriends, recipientBNicknames);
  assert.equal(resolvedName, 'Active Map Nickname AAA', 'Nickname map must not be overridden by friend.nickname');
});

test('Payload compatibility: Sender name resolves accurately using fromUid and fromName when fromNearuId is missing', () => {
  // Exact Cloudflare Worker push notification payload and Firestore document structure
  // Contains fromUid, fromName, message, eventId, type — intentionally omits fromNearuId
  const workerPayload = {
    fromUid: 'uid_worker_sender_456',
    fromName: 'Original Cloud Name',
    message: 'Hope you are doing well!',
    eventId: 'event_1729000000_abc123',
    type: 'standard',
  };

  const recipientNicknames = {
    uid_worker_sender_456: 'My Custom Nickname',
  };

  // Case 1: Recipient assigned custom nickname
  assert.equal(
    resolveFriendDisplayName(workerPayload, [], recipientNicknames),
    'My Custom Nickname',
    'Resolves custom nickname from fromUid alone'
  );

  // Case 2: No nickname, but sender exists in recipient friends list
  const recipientFriends = [
    {
      id: 'uid_worker_sender_456',
      uid: 'uid_worker_sender_456',
      name: 'Friend Name in Contact List',
    },
  ];
  assert.equal(
    resolveFriendDisplayName(workerPayload, recipientFriends, {}),
    'Friend Name in Contact List',
    'Resolves friend profile name from fromUid alone'
  );

  // Case 3: No nickname and not in friends list -> falls back to transmitted fromName
  assert.equal(
    resolveFriendDisplayName(workerPayload, [], {}),
    'Original Cloud Name',
    'Falls back to transmitted fromName when fromNearuId is missing'
  );
});

test('Bug 2 fix: Falls back to event fromName when sender is not in friends list and has no nickname', () => {
  const senderFromA = {
    fromUid: 'uid_unknown_999',
    fromName: 'Transmitted Name',
  };

  const resolvedName = resolveFriendDisplayName(senderFromA, [], {});
  assert.equal(resolvedName, 'Transmitted Name');
});

test('Bug 2 fix: Falls back to "Someone" when sender has no name metadata and no nickname', () => {
  assert.equal(resolveFriendDisplayName(null), 'Someone');
  assert.equal(resolveFriendDisplayName({}), 'Someone');
  assert.equal(resolveFriendDisplayName({ fromName: '   ' }), 'Someone');
});

test('Bug 2 fix: Empty or whitespace-only nicknames are ignored and safely fall back', () => {
  const sender = {
    fromUid: 'uid_1',
    fromName: 'Real Name',
  };
  const nicknames = {
    uid_1: '   ',
  };
  assert.equal(resolveFriendDisplayName(sender, [], nicknames), 'Real Name');
});

test('Bug 2 fix: Nicknames are strictly user-specific (isolation test)', () => {
  const senderA = {
    fromUid: 'uid_alice',
    fromNearuId: 'NEARU-ALICE',
    fromName: 'Alice',
  };

  // User B assigned "AAA" to Alice
  const userBNicknames = { uid_alice: 'AAA' };
  // User C assigned "My Bestie" to Alice
  const userCNicknames = { uid_alice: 'My Bestie' };
  // User D has no nickname for Alice
  const userDNicknames = {};

  assert.equal(resolveFriendDisplayName(senderA, [], userBNicknames), 'AAA');
  assert.equal(resolveFriendDisplayName(senderA, [], userCNicknames), 'My Bestie');
  assert.equal(resolveFriendDisplayName(senderA, [], userDNicknames), 'Alice');

  // Alice's own profile name remains unchanged
  assert.equal(senderA.fromName, 'Alice');
});

test('Bug 1 fix: In-app toast formats sender name, subtitle, and custom message correctly (tests exported formatIncomingNearuToast)', () => {
  // Tests the actual exported formatIncomingNearuToast from src/services/displayName.ts
  const toast = formatIncomingNearuToast('AAA', 'Hope you are doing well!');

  assert.equal(toast.senderName, 'AAA');
  assert.equal(toast.subtitle, 'Thinking of you');
  assert.equal(toast.message, '"Hope you are doing well!"');
  assert.equal(toast.icon, 'heart');
});

test('Bug 1 fix: In-app toast formats default message with sender name and "Thinking of you 💙" (tests exported formatIncomingNearuToast)', () => {
  // Tests the actual exported formatIncomingNearuToast from src/services/displayName.ts
  const toast1 = formatIncomingNearuToast('AAA', 'Thinking of you 💙');
  assert.equal(toast1.senderName, 'AAA');
  assert.equal(toast1.subtitle, undefined);
  assert.equal(toast1.message, 'Thinking of you 💙');
  assert.equal(toast1.icon, 'heart');

  const toast2 = formatIncomingNearuToast('AAA', '');
  assert.equal(toast2.senderName, 'AAA');
  assert.equal(toast2.subtitle, undefined);
  assert.equal(toast2.message, 'Thinking of you 💙');
  assert.equal(toast2.icon, 'heart');
});

test('Deduplication logic unit test: Set-based eventId tracking prevents duplicate toast and vibration on replay/catchup (deduplication logic simulation, not UI integration)', () => {
  // Verifies the Set-based eventId deduplication pattern used by handledEventIds.current in MainScreen
  const handledEventIds = new Set();
  let toastCount = 0;
  let vibrateCount = 0;

  function onEventReceived(event, isSilentCatchUp = false) {
    if (handledEventIds.has(event.id)) {
      return; // Deduplicated
    }
    handledEventIds.add(event.id);

    if (isSilentCatchUp) {
      // Catch up silently without vibrating
      toastCount++;
    } else {
      // Live foreground event
      toastCount++;
      vibrateCount++;
    }
  }

  const event = { id: 'evt_123', fromUid: 'uA', message: 'Hello' };

  // First time event arrives
  onEventReceived(event, false);
  assert.equal(toastCount, 1);
  assert.equal(vibrateCount, 1);

  // Duplicate replay of same event (e.g. catchup snapshot or re-subscription)
  onEventReceived(event, true);
  assert.equal(toastCount, 1, 'Duplicate event must not trigger a second toast');
  assert.equal(vibrateCount, 1, 'Duplicate event must not trigger vibration');
});

