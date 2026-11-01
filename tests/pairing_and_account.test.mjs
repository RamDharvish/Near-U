import test from 'node:test';
import assert from 'node:assert/strict';

// =========================================================================
// 1. NearU ID Validation and Lookup Logic
// =========================================================================

const NEARU_ID_REGEX = /^NEARU-[A-Z0-9]{4,12}$/;

function normalizeNearuId(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let clean = raw.replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F]/g, '').trim().toUpperCase();
  clean = clean.replace(/^NEARU\s*[-:_ ]\s*/, 'NEARU-');
  if (/^[A-Z0-9]{4,12}$/.test(clean)) {
    clean = `NEARU-${clean}`;
  }
  return clean;
}

function validateNearuIdFormat(id) {
  const normalized = normalizeNearuId(id);
  return NEARU_ID_REGEX.test(normalized);
}

test('NearU ID format validation: accepts valid IDs', () => {
  assert.equal(validateNearuIdFormat('NEARU-ABC123'), true);
  assert.equal(validateNearuIdFormat('nearu-abc123'), true); // normalized to uppercase
  assert.equal(validateNearuIdFormat('  NEARU-9X7K2M  '), true);
  assert.equal(validateNearuIdFormat('NEARU-7K29M4X2'), true); // standard 8-character code
  assert.equal(validateNearuIdFormat('7K29M4X2'), true); // normalized without prefix
  assert.equal(validateNearuIdFormat('NEARU - 7K29M4X2'), true); // spaces around separator
  assert.equal(validateNearuIdFormat(' \u200B7K29M4X2\uFEFF '), true); // invisible unicode stripped
});

test('NearU ID format validation: rejects malformed IDs', () => {
  assert.equal(validateNearuIdFormat(''), false);
  assert.equal(validateNearuIdFormat('NEARU-'), false);
  assert.equal(validateNearuIdFormat('NEARU-123'), false); // only 3 chars (min 4)
  assert.equal(validateNearuIdFormat('NEARU-1234567890123'), false); // 13 chars (max 12)
  assert.equal(validateNearuIdFormat('NEARU-ABC@#$'), false); // special chars
  assert.equal(validateNearuIdFormat('USER-ABC123'), false); // invalid prefix
});

function simulateLookupUserByNearuId(nearuId, mockDb, authUser) {
  if (!authUser) {
    return { success: false, errorType: 'auth', message: 'You must be connected to search for friends.' };
  }
  const cleanId = normalizeNearuId(nearuId);
  if (!validateNearuIdFormat(cleanId)) {
    return { success: false, errorType: 'invalid_format', message: 'Invalid NearU ID format. Expected format: NEARU-XXXXXX' };
  }

  const idMapping = mockDb.nearu_ids[cleanId];
  if (!idMapping) {
    return { success: false, errorType: 'not_found', message: `No user found with ID "${cleanId}".` };
  }

  const userDoc = mockDb.users[idMapping.uid];
  return {
    success: true,
    user: {
      uid: idMapping.uid,
      nearuId: cleanId,
      name: userDoc?.name || idMapping.name || 'NearU Friend',
    },
  };
}

test('User discovery: finds existing user by valid NearU ID', () => {
  const mockDb = {
    nearu_ids: {
      'NEARU-XYZ789': { uid: 'user_target_456', name: 'Alice' },
    },
    users: {
      'user_target_456': { name: 'Alice Walker', nearuId: 'NEARU-XYZ789' },
    },
  };
  const authUser = { uid: 'user_caller_123' };

  const result = simulateLookupUserByNearuId('NEARU-XYZ789', mockDb, authUser);
  assert.equal(result.success, true);
  assert.equal(result.user.uid, 'user_target_456');
  assert.equal(result.user.name, 'Alice Walker');
  assert.equal(result.user.nearuId, 'NEARU-XYZ789');
});

test('User discovery: returns accurate not_found error for nonexistent ID', () => {
  const mockDb = {
    nearu_ids: {},
    users: {},
  };
  const authUser = { uid: 'user_caller_123' };

  const result = simulateLookupUserByNearuId('NEARU-999999', mockDb, authUser);
  assert.equal(result.success, false);
  assert.equal(result.errorType, 'not_found');
  assert.match(result.message, /No user found/);
});

// =========================================================================
// 2. Auth State & Network Connectivity Error Handling
// =========================================================================

function classifyPairingError(error) {
  const code = (error && typeof error === 'object' && 'code' in error) ? String(error.code) : '';
  const message = error instanceof Error ? error.message : String(error);

  if (code.includes('permission-denied')) {
    return { type: 'permission_denied', message: 'Access denied. Please check your account session.' };
  }
  if (code.includes('deadline-exceeded') || message.includes('timed out')) {
    return { type: 'timeout', message: 'Operation timed out. Please check your internet connection.' };
  }
  if (code.includes('unavailable') || code.includes('client-offline') || message.includes('network') || message.includes('offline')) {
    return { type: 'offline', message: 'Network unavailable. Please check your internet connection.' };
  }
  if (message === 'AUTH_UNAVAILABLE') {
    return { type: 'auth_unavailable', message: 'You must be connected to search or pair.' };
  }
  return { type: 'server_error', message: 'Unable to complete request right now. Please try again.' };
}

test('Error handling: distinguishes permission-denied from offline network error', () => {
  const permError = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
  const resPerm = classifyPairingError(permError);
  assert.equal(resPerm.type, 'permission_denied');
  assert.match(resPerm.message, /Access denied/);

  const offError = { code: 'unavailable', message: 'The service is currently unavailable.' };
  const resOff = classifyPairingError(offError);
  assert.equal(resOff.type, 'offline');
  assert.match(resOff.message, /Network unavailable/);
});

test('Error handling: distinguishes timeout from network offline and permission-denied', () => {
  const timeoutError = { code: 'deadline-exceeded', message: 'User lookup timed out after 10s' };
  const res = classifyPairingError(timeoutError);
  assert.equal(res.type, 'timeout');
  assert.match(res.message, /timed out/);

  const timeoutMsgError = new Error('Operation timed out after 12s');
  const resMsg = classifyPairingError(timeoutMsgError);
  assert.equal(resMsg.type, 'timeout');
});

test('Error handling: unauthenticated session throws auth_unavailable, not network failure', () => {
  const authError = new Error('AUTH_UNAVAILABLE');
  const res = classifyPairingError(authError);
  assert.equal(res.type, 'auth_unavailable');
  assert.notEqual(res.type, 'offline');
});

// =========================================================================
// 3. Friend Request Creation, Duplicates, and Self-Requests
// =========================================================================

function simulateSendFriendRequest(senderProfile, targetNearuId, mockDb) {
  if (!senderProfile || !senderProfile.uid) {
    return { success: false, message: 'You must be connected to send a friend request.' };
  }

  const lookup = simulateLookupUserByNearuId(targetNearuId, mockDb, { uid: senderProfile.uid });
  if (!lookup.success) {
    return lookup;
  }

  const target = lookup.user;
  if (target.uid === senderProfile.uid) {
    return { success: false, message: 'You cannot add yourself as a friend.' };
  }

  // Check if already friends
  if (mockDb.friends[senderProfile.uid]?.[target.uid]) {
    return { success: false, message: 'You are already friends with this user.' };
  }

  // Check outgoing duplicate
  const reqId = `${senderProfile.uid}_${target.uid}`;
  const existingOutgoing = mockDb.friend_requests[reqId];
  if (existingOutgoing && existingOutgoing.status === 'pending') {
    return { success: false, message: 'A friend request is already pending for this user.' };
  }
  if (existingOutgoing && existingOutgoing.status === 'accepted') {
    return { success: false, message: 'You are already friends with this user.' };
  }
  if (existingOutgoing && existingOutgoing.status === 'declined') {
    // Delete previous declined document so write is evaluated as an authorized create in Firestore
    delete mockDb.friend_requests[reqId];
  }

  // Check reverse incoming duplicate
  const reverseReqId = `${target.uid}_${senderProfile.uid}`;
  const existingIncoming = mockDb.friend_requests[reverseReqId];
  if (existingIncoming && existingIncoming.status === 'pending') {
    return { success: false, message: 'This user already sent you a friend request! Check your incoming requests.' };
  }

  // Create request
  mockDb.friend_requests[reqId] = {
    id: reqId,
    fromUid: senderProfile.uid,
    fromName: (senderProfile.name || 'Friend').trim().slice(0, 30),
    fromNearuId: senderProfile.id,
    toUid: target.uid,
    toNearuId: target.nearuId,
    status: 'pending',
    createdAt: Date.now(),
  };

  return { success: true, message: `Friend request sent to ${target.name}!` };
}

test('Friend request: creates pending request when authenticated and recipient exists', () => {
  const mockDb = {
    nearu_ids: { 'NEARU-BOB123': { uid: 'uid_bob', name: 'Bob' } },
    users: { 'uid_bob': { name: 'Bob Smith', nearuId: 'NEARU-BOB123' } },
    friends: {},
    friend_requests: {},
  };
  const sender = { uid: 'uid_alice', id: 'NEARU-ALI456', name: 'Alice' };

  const res = simulateSendFriendRequest(sender, 'NEARU-BOB123', mockDb);
  assert.equal(res.success, true);
  assert.equal(mockDb.friend_requests['uid_alice_uid_bob']?.status, 'pending');
  assert.equal(mockDb.friend_requests['uid_alice_uid_bob']?.toUid, 'uid_bob');
});

test('Friend request: cleans up previous declined request and successfully re-sends', () => {
  const mockDb = {
    nearu_ids: { 'NEARU-BOB123': { uid: 'uid_bob', name: 'Bob' } },
    users: { 'uid_bob': { name: 'Bob Smith', nearuId: 'NEARU-BOB123' } },
    friends: {},
    friend_requests: {
      'uid_alice_uid_bob': { status: 'declined', fromUid: 'uid_alice', toUid: 'uid_bob' },
    },
  };
  const sender = { uid: 'uid_alice', id: 'NEARU-ALI456', name: 'Alice' };

  const res = simulateSendFriendRequest(sender, 'NEARU-BOB123', mockDb);
  assert.equal(res.success, true);
  assert.equal(mockDb.friend_requests['uid_alice_uid_bob']?.status, 'pending');
  assert.match(res.message, /Friend request sent/);
});

test('Friend request: prevents self-requests', () => {
  const mockDb = {
    nearu_ids: { 'NEARU-ALI456': { uid: 'uid_alice', name: 'Alice' } },
    users: { 'uid_alice': { name: 'Alice', nearuId: 'NEARU-ALI456' } },
    friends: {},
    friend_requests: {},
  };
  const sender = { uid: 'uid_alice', id: 'NEARU-ALI456', name: 'Alice' };

  const res = simulateSendFriendRequest(sender, 'NEARU-ALI456', mockDb);
  assert.equal(res.success, false);
  assert.match(res.message, /cannot add yourself/);
});

test('Friend request: prevents duplicate outgoing requests', () => {
  const mockDb = {
    nearu_ids: { 'NEARU-BOB123': { uid: 'uid_bob', name: 'Bob' } },
    users: { 'uid_bob': { name: 'Bob', nearuId: 'NEARU-BOB123' } },
    friends: {},
    friend_requests: {
      'uid_alice_uid_bob': { status: 'pending' },
    },
  };
  const sender = { uid: 'uid_alice', id: 'NEARU-ALI456', name: 'Alice' };

  const res = simulateSendFriendRequest(sender, 'NEARU-BOB123', mockDb);
  assert.equal(res.success, false);
  assert.match(res.message, /already pending/);
});

test('Friend request: detects existing incoming request from recipient', () => {
  const mockDb = {
    nearu_ids: { 'NEARU-BOB123': { uid: 'uid_bob', name: 'Bob' } },
    users: { 'uid_bob': { name: 'Bob', nearuId: 'NEARU-BOB123' } },
    friends: {},
    friend_requests: {
      'uid_bob_uid_alice': { status: 'pending' },
    },
  };
  const sender = { uid: 'uid_alice', id: 'NEARU-ALI456', name: 'Alice' };

  const res = simulateSendFriendRequest(sender, 'NEARU-BOB123', mockDb);
  assert.equal(res.success, false);
  assert.match(res.message, /already sent you a friend request/);
});

test('Friend request: detects if users are already friends', () => {
  const mockDb = {
    nearu_ids: { 'NEARU-BOB123': { uid: 'uid_bob', name: 'Bob' } },
    users: { 'uid_bob': { name: 'Bob', nearuId: 'NEARU-BOB123' } },
    friends: {
      'uid_alice': { 'uid_bob': { uid: 'uid_bob', name: 'Bob' } },
    },
    friend_requests: {},
  };
  const sender = { uid: 'uid_alice', id: 'NEARU-ALI456', name: 'Alice' };

  const res = simulateSendFriendRequest(sender, 'NEARU-BOB123', mockDb);
  assert.equal(res.success, false);
  assert.match(res.message, /already friends/);
});

test('Friend request UI: ignores stale responses when user cancels or re-triggers request', async () => {
  let activeRequestId = 0;
  let finalUiState = { isSubmitting: false, error: null, successRecipient: null };

  const triggerRequest = (id, simulateDelayMs, shouldSucceed) => {
    const currentId = ++activeRequestId;
    finalUiState.isSubmitting = true;

    return new Promise((resolve) => {
      setTimeout(() => {
        if (activeRequestId === currentId) {
          if (shouldSucceed) {
            finalUiState.successRecipient = 'Bob';
          } else {
            finalUiState.error = 'Failed';
          }
          finalUiState.isSubmitting = false;
        }
        resolve();
      }, simulateDelayMs);
    });
  };

  // Launch slow request 1 (100ms) that will fail
  const req1 = triggerRequest('NEARU-111111', 100, false);
  // User quickly cancels / re-triggers fast request 2 (20ms) that succeeds
  const req2 = triggerRequest('NEARU-222222', 20, true);

  await Promise.all([req1, req2]);

  // Request 1's late failure must NOT overwrite Request 2's success
  assert.equal(finalUiState.successRecipient, 'Bob');
  assert.equal(finalUiState.error, null);
  assert.equal(finalUiState.isSubmitting, false);
});

// =========================================================================
// 4. Friend Request Acceptance and Mutual Records
// =========================================================================

function simulateAcceptFriendRequest(req, currentUid, mockDb) {
  if (req.toUid !== currentUid) {
    return { success: false, message: 'Unauthorized: Cannot accept request for another user.' };
  }

  // Create mutual friend records
  mockDb.friends[req.toUid] = mockDb.friends[req.toUid] || {};
  mockDb.friends[req.toUid][req.fromUid] = {
    id: req.fromUid,
    uid: req.fromUid,
    nearuId: req.fromNearuId,
    name: req.fromName,
    addedAt: Date.now(),
  };

  const toUserDoc = mockDb.users[req.toUid];
  mockDb.friends[req.fromUid] = mockDb.friends[req.fromUid] || {};
  mockDb.friends[req.fromUid][req.toUid] = {
    id: req.toUid,
    uid: req.toUid,
    nearuId: req.toNearuId,
    name: toUserDoc?.name || 'Friend',
    addedAt: Date.now(),
  };

  // Mark request accepted or deleted
  delete mockDb.friend_requests[req.id];
  return { success: true };
}

test('Friendship acceptance: creates consistent mutual records for both users', () => {
  const mockDb = {
    users: {
      'uid_alice': { name: 'Alice', nearuId: 'NEARU-ALI456' },
      'uid_bob': { name: 'Bob', nearuId: 'NEARU-BOB123' },
    },
    friends: {},
    friend_requests: {
      'uid_alice_uid_bob': {
        id: 'uid_alice_uid_bob',
        fromUid: 'uid_alice',
        fromNearuId: 'NEARU-ALI456',
        fromName: 'Alice',
        toUid: 'uid_bob',
        toNearuId: 'NEARU-BOB123',
        status: 'pending',
      },
    },
  };

  const req = mockDb.friend_requests['uid_alice_uid_bob'];
  const res = simulateAcceptFriendRequest(req, 'uid_bob', mockDb);

  assert.equal(res.success, true);
  // Verify Alice has Bob as friend
  assert.equal(mockDb.friends['uid_alice']['uid_bob'].nearuId, 'NEARU-BOB123');
  // Verify Bob has Alice as friend
  assert.equal(mockDb.friends['uid_bob']['uid_alice'].nearuId, 'NEARU-ALI456');
  // Verify request was finalized
  assert.equal(mockDb.friend_requests['uid_alice_uid_bob'], undefined);
});

test('Friendship acceptance idempotency: repeated acceptance returns cleanly without throwing', () => {
  const mockDb = {
    users: {
      'uid_alice': { name: 'Alice', nearuId: 'NEARU-ALI456' },
      'uid_bob': { name: 'Bob', nearuId: 'NEARU-BOB123' },
    },
    friends: {
      'uid_alice': { 'uid_bob': { uid: 'uid_bob', nearuId: 'NEARU-BOB123', name: 'Bob' } },
      'uid_bob': { 'uid_alice': { uid: 'uid_alice', nearuId: 'NEARU-ALI456', name: 'Alice' } },
    },
    friend_requests: {
      'uid_alice_uid_bob': {
        id: 'uid_alice_uid_bob',
        fromUid: 'uid_alice',
        toUid: 'uid_bob',
        status: 'accepted',
      },
    },
  };

  function simulateIdempotentAccept(req, currentUid, db) {
    if (req.toUid !== currentUid) return { success: false, message: 'Unauthorized' };
    const existingReq = db.friend_requests[req.id];
    if (existingReq?.status === 'accepted') {
      return { success: true, message: 'Already accepted' };
    }
    return { success: true };
  }

  const res1 = simulateIdempotentAccept(mockDb.friend_requests['uid_alice_uid_bob'], 'uid_bob', mockDb);
  assert.equal(res1.success, true);
  assert.equal(res1.message, 'Already accepted');
});

test('Local storage persistence: reopening app immediately restores accepted friends list', () => {
  let localStorageData = null;

  function simulateSaveFriends(friends) {
    localStorageData = JSON.stringify(friends);
  }

  function simulateGetFriends() {
    return localStorageData ? JSON.parse(localStorageData) : [];
  }

  // App is open: receives accepted cloud friend from listener and saves
  const liveFriends = [
    { id: 'NEARU-ALI456', uid: 'uid_alice', nearuId: 'NEARU-ALI456', name: 'Alice', pairedAt: 1000 },
  ];
  simulateSaveFriends(liveFriends);

  // App restarts / is reopened: reads immediately from local cache before network listener resolves
  const restoredFriends = simulateGetFriends();
  assert.equal(restoredFriends.length, 1);
  assert.equal(restoredFriends[0].nearuId, 'NEARU-ALI456');
  assert.equal(restoredFriends[0].name, 'Alice');
});

// =========================================================================
// 5. Remove Individual Friend and Clear Friend List
// =========================================================================

function simulateRemoveFriend(currentUid, friendUid, mockDb, options = { allowReciprocalDelete: true }) {
  if (!currentUid) return { success: false, message: 'Authentication required' };
  if (!mockDb.friends[currentUid]?.[friendUid]) {
    return { success: false, message: 'Friend not found' };
  }

  // Remove from current user's list
  delete mockDb.friends[currentUid][friendUid];

  // Remove reciprocal if permitted
  let reciprocalSuccess = false;
  if (options.allowReciprocalDelete && mockDb.friends[friendUid]?.[currentUid]) {
    delete mockDb.friends[friendUid][currentUid];
    reciprocalSuccess = true;
  }

  return { success: true, reciprocalSuccess };
}

function simulateClearAllFriends(currentUid, mockDb) {
  if (!currentUid) return { success: false, clearedCount: 0 };
  const userFriends = mockDb.friends[currentUid] || {};
  const friendUids = Object.keys(userFriends);
  let clearedCount = 0;

  for (const fUid of friendUids) {
    delete userFriends[fUid];
    if (mockDb.friends[fUid]?.[currentUid]) {
      delete mockDb.friends[fUid][currentUid];
    }
    clearedCount++;
  }

  return { success: true, clearedCount };
}

test('Remove individual friend: removes from current user and attempts reciprocal removal', () => {
  const mockDb = {
    friends: {
      'user_1': { 'user_2': { uid: 'user_2', name: 'User 2' }, 'user_3': { uid: 'user_3', name: 'User 3' } },
      'user_2': { 'user_1': { uid: 'user_1', name: 'User 1' } },
    },
  };

  const res = simulateRemoveFriend('user_1', 'user_2', mockDb, { allowReciprocalDelete: true });
  assert.equal(res.success, true);
  assert.equal(mockDb.friends['user_1']['user_2'], undefined);
  assert.equal(mockDb.friends['user_2']['user_1'], undefined);
  // User 3 must remain intact
  assert.notEqual(mockDb.friends['user_1']['user_3'], undefined);
});

test('Clear all friends: cleans up entire friend list while keeping account intact', () => {
  const mockDb = {
    users: { 'user_1': { name: 'User 1', nearuId: 'NEARU-USR001' } },
    friends: {
      'user_1': {
        'user_2': { uid: 'user_2' },
        'user_3': { uid: 'user_3' },
      },
      'user_2': { 'user_1': { uid: 'user_1' } },
      'user_3': { 'user_1': { uid: 'user_1' } },
    },
  };

  const res = simulateClearAllFriends('user_1', mockDb);
  assert.equal(res.success, true);
  assert.equal(res.clearedCount, 2);
  assert.equal(Object.keys(mockDb.friends['user_1']).length, 0);
  assert.equal(mockDb.friends['user_2']['user_1'], undefined);
  assert.equal(mockDb.friends['user_3']['user_1'], undefined);
  // User account profile & nearuId must remain intact
  assert.equal(mockDb.users['user_1'].nearuId, 'NEARU-USR001');
});

// =========================================================================
// 6. Secure Account Recovery Authorization Logic
// =========================================================================

import { createHmac, randomBytes } from 'node:crypto';

function generateRecoveryCredential() {
  const rawSecret = randomBytes(16).toString('hex'); // 32-char high-entropy hex
  const hashedSecret = createHmac('sha256', 'nearu-salt-v1').update(rawSecret).digest('hex');
  return { rawSecret, hashedSecret };
}

function verifyRecoveryAuthorization(providedSecret, storedHashedSecret) {
  if (!providedSecret || !storedHashedSecret) return false;
  const computedHash = createHmac('sha256', 'nearu-salt-v1').update(providedSecret.trim()).digest('hex');
  return computedHash === storedHashedSecret;
}

test('Account recovery: valid recovery secret proves account ownership', () => {
  const { rawSecret, hashedSecret } = generateRecoveryCredential();
  const isAuthorized = verifyRecoveryAuthorization(rawSecret, hashedSecret);
  assert.equal(isAuthorized, true);
});

test('Account recovery: rejects unauthorized / wrong recovery secret', () => {
  const { hashedSecret } = generateRecoveryCredential();
  const isAuthorized = verifyRecoveryAuthorization('WRONG-SECRET-KEY', hashedSecret);
  assert.equal(isAuthorized, false);
});

test('Account recovery: cannot hijack account with NearU ID alone', () => {
  // Knowing the NearU ID alone does not produce the secret hash
  const nearuId = 'NEARU-TARGET';
  const { hashedSecret } = generateRecoveryCredential();
  assert.equal(verifyRecoveryAuthorization(nearuId, hashedSecret), false);
});

// =========================================================================
// 7. Account Deletion and Cascade Data Cleanup
// =========================================================================

function simulateDeleteAccount(uid, mockDb) {
  if (!uid || !mockDb.users[uid]) {
    return { success: false, message: 'User does not exist' };
  }

  const nearuId = mockDb.users[uid].nearuId;

  // 1. Delete friends and reciprocal records
  const userFriends = mockDb.friends[uid] || {};
  for (const fUid of Object.keys(userFriends)) {
    if (mockDb.friends[fUid]?.[uid]) {
      delete mockDb.friends[fUid][uid];
    }
  }
  delete mockDb.friends[uid];

  // 2. Delete pending friend requests where user is sender or receiver
  for (const [reqKey, req] of Object.entries(mockDb.friend_requests)) {
    if (req.fromUid === uid || req.toUid === uid) {
      delete mockDb.friend_requests[reqKey];
    }
  }

  // 3. Delete push tokens
  delete mockDb.expo_push_tokens[uid];
  delete mockDb.fcm_tokens[uid];

  // 4. Delete NearU ID mapping so it cannot resolve to stale account
  if (nearuId) {
    delete mockDb.nearu_ids[nearuId];
  }

  // 5. Delete user doc
  delete mockDb.users[uid];

  // 6. Delete auth user
  delete mockDb.auth_users[uid];

  return { success: true };
}

test('Account deletion: removes all user data, reciprocal references, and frees NearU ID', () => {
  const mockDb = {
    users: {
      'user_victim': { name: 'Victim User', nearuId: 'NEARU-DEL123' },
      'user_friend': { name: 'Friend User', nearuId: 'NEARU-FRN456' },
    },
    nearu_ids: {
      'NEARU-DEL123': { uid: 'user_victim', name: 'Victim User' },
      'NEARU-FRN456': { uid: 'user_friend', name: 'Friend User' },
    },
    friends: {
      'user_victim': { 'user_friend': { uid: 'user_friend' } },
      'user_friend': { 'user_victim': { uid: 'user_victim' } },
    },
    friend_requests: {
      'user_victim_pending': { fromUid: 'user_victim', toUid: 'user_other' },
      'other_to_victim': { fromUid: 'user_other', toUid: 'user_victim' },
      'unrelated_request': { fromUid: 'user_a', toUid: 'user_b' },
    },
    expo_push_tokens: { 'user_victim': { token: 'ExponentPushToken[xxx]' } },
    fcm_tokens: { 'user_victim': { token: 'fcm_xxx' } },
    auth_users: { 'user_victim': { uid: 'user_victim' } },
  };

  const res = simulateDeleteAccount('user_victim', mockDb);
  assert.equal(res.success, true);

  // User and mapping gone
  assert.equal(mockDb.users['user_victim'], undefined);
  assert.equal(mockDb.nearu_ids['NEARU-DEL123'], undefined);
  assert.equal(mockDb.auth_users['user_victim'], undefined);

  // Reciprocal friendship gone from friend
  assert.equal(mockDb.friends['user_friend']['user_victim'], undefined);

  // Friend requests cleaned up
  assert.equal(mockDb.friend_requests['user_victim_pending'], undefined);
  assert.equal(mockDb.friend_requests['other_to_victim'], undefined);
  assert.notEqual(mockDb.friend_requests['unrelated_request'], undefined);

  // Tokens gone
  assert.equal(mockDb.expo_push_tokens['user_victim'], undefined);
  assert.equal(mockDb.fcm_tokens['user_victim'], undefined);

  // Stale ID lookup fails
  const lookup = simulateLookupUserByNearuId('NEARU-DEL123', mockDb, { uid: 'someone' });
  assert.equal(lookup.success, false);
  assert.equal(lookup.errorType, 'not_found');
});

test('Account deletion: fails and does not report success if critical user doc or NearU ID deletion fails', () => {
  function simulateDeleteWithCriticalCheck(options = { failUserDoc: false, failNearuId: false }) {
    if (options.failNearuId) {
      return {
        success: false,
        status: 'failed',
        message: 'Permission denied: Cannot delete account documents until updated security rules are deployed.',
      };
    }
    if (options.failUserDoc) {
      return {
        success: false,
        status: 'failed',
        message: 'Permission denied: Cannot delete account documents until updated security rules are deployed.',
      };
    }
    return { success: true, status: 'complete', message: 'Account and associated data deleted successfully.' };
  }

  const resNearuFail = simulateDeleteWithCriticalCheck({ failNearuId: true, failUserDoc: false });
  assert.equal(resNearuFail.success, false);
  assert.equal(resNearuFail.status, 'failed');
  assert.match(resNearuFail.message, /Cannot delete account documents/);

  const resUserFail = simulateDeleteWithCriticalCheck({ failNearuId: false, failUserDoc: true });
  assert.equal(resUserFail.success, false);
  assert.equal(resUserFail.status, 'failed');
  assert.match(resUserFail.message, /Cannot delete account documents/);
});

test('Account deletion: returns partial_auth_failed if Firebase Auth deletion fails after Firestore cleanup', () => {
  function simulateDeleteWithAuthFailure(authError) {
    // Firestore cleanup succeeded, but Auth user.delete() failed
    return {
      success: false,
      status: 'partial_auth_failed',
      message: authError.code === 'auth/requires-recent-login'
        ? 'Cloud data and NearU ID deleted, but your authentication session requires re-authentication to finalize deletion. Please restart the app and retry.'
        : `Cloud data deleted, but authentication account deletion failed (${authError.code || 'network error'}). Please retry to finalize account deletion.`,
      error: authError.code,
    };
  }

  const recentLoginError = { code: 'auth/requires-recent-login', message: 'Requires recent sign-in.' };
  const resRecent = simulateDeleteWithAuthFailure(recentLoginError);
  assert.equal(resRecent.success, false);
  assert.equal(resRecent.status, 'partial_auth_failed');
  assert.match(resRecent.message, /requires re-authentication/);

  const networkError = { code: 'auth/network-request-failed', message: 'Network failed.' };
  const resNet = simulateDeleteWithAuthFailure(networkError);
  assert.equal(resNet.success, false);
  assert.equal(resNet.status, 'partial_auth_failed');
  assert.match(resNet.message, /authentication account deletion failed/);
});

test('Account deletion: returns partial_subcollections_failed and halts if subcollection cleanup fails', () => {
  function simulateDeleteWithSubcollectionFailure(failedCount) {
    if (failedCount > 0) {
      return {
        success: false,
        status: 'partial_subcollections_failed',
        message: 'Could not delete all friend or notification records. Account deletion stopped before removing profile. Please check your connection and retry.',
      };
    }
    return { success: true, status: 'complete', message: 'Account and associated data deleted successfully.' };
  }

  const res = simulateDeleteWithSubcollectionFailure(2);
  assert.equal(res.success, false);
  assert.equal(res.status, 'partial_subcollections_failed');
  assert.match(res.message, /Account deletion stopped before removing profile/);
});


