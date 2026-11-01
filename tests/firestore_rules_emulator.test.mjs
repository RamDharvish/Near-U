import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

// Read the actual firestore.rules file directly from disk
const RULES_FILE_PATH = path.resolve('firestore.rules');
const currentFirestoreRules = fs.readFileSync(RULES_FILE_PATH, 'utf8');

const PROJECT_ID = 'nearu-rules-emulator-test';
let testEnv;

const emuHost = process.env.FIRESTORE_EMULATOR_HOST;
const hasEmulator = Boolean(emuHost);

// Run emulator suite if FIRESTORE_EMULATOR_HOST is available
if (hasEmulator) {
  const [host, portStr] = emuHost.split(':');
  const port = parseInt(portStr, 10) || 8080;

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host,
        port,
        rules: currentFirestoreRules,
      },
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  // -------------------------------------------------------------------------
  // 1. Authenticated user reading their own request
  // -------------------------------------------------------------------------
  test('Emulator: Authenticated user CAN read their own friend request (as sender or recipient)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'friend_requests', 'user_alice_user_bob'), {
        fromUid: 'user_alice',
        toUid: 'user_bob',
        fromNearuId: 'NEARU-ALICE',
        toNearuId: 'NEARU-BOB01',
        fromName: 'Alice',
        toName: 'Bob',
        status: 'pending',
        createdAt: Timestamp.now(),
      });
    });

    const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
    const bobDb = testEnv.authenticatedContext('user_bob').firestore();

    // Alice is sender
    const aliceSnap = await assertSucceeds(getDoc(doc(aliceDb, 'friend_requests', 'user_alice_user_bob')));
    assert.equal(aliceSnap.exists(), true);
    assert.equal(aliceSnap.data().fromUid, 'user_alice');

    // Bob is recipient
    const bobSnap = await assertSucceeds(getDoc(doc(bobDb, 'friend_requests', 'user_alice_user_bob')));
    assert.equal(bobSnap.exists(), true);
  });

  // -------------------------------------------------------------------------
  // 2. Unrelated user being denied access to an existing request
  // -------------------------------------------------------------------------
  test('Emulator: Unrelated user is DENIED access to an existing friend request', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'friend_requests', 'user_alice_user_bob'), {
        fromUid: 'user_alice',
        toUid: 'user_bob',
        fromNearuId: 'NEARU-ALICE',
        toNearuId: 'NEARU-BOB01',
        fromName: 'Alice',
        toName: 'Bob',
        status: 'pending',
        createdAt: Timestamp.now(),
      });
    });

    const eveDb = testEnv.authenticatedContext('user_eve').firestore();
    await assertFails(getDoc(doc(eveDb, 'friend_requests', 'user_alice_user_bob')));
  });

  // -------------------------------------------------------------------------
  // 3. Checking a nonexistent request without granting access to arbitrary IDs
  // -------------------------------------------------------------------------
  test('Emulator: Checking nonexistent request allowed ONLY if caller UID is in the ID, denied for arbitrary IDs', async () => {
    const aliceDb = testEnv.authenticatedContext('user_alice').firestore();

    // Alice checking a nonexistent request where she is sender: allowed (doc does not exist, returns exists() == false)
    const ownNonexistent = await assertSucceeds(getDoc(doc(aliceDb, 'friend_requests', 'user_alice_user_someone')));
    assert.equal(ownNonexistent.exists(), false);

    // Alice checking a nonexistent request where she is receiver: allowed
    const incomingNonexistent = await assertSucceeds(getDoc(doc(aliceDb, 'friend_requests', 'user_someone_user_alice')));
    assert.equal(incomingNonexistent.exists(), false);

    // Alice checking an arbitrary nonexistent request ID not involving her: DENIED
    await assertFails(getDoc(doc(aliceDb, 'friend_requests', 'user_bob_user_charlie')));
  });

  // -------------------------------------------------------------------------
  // 4. A user removing their own friend record
  // -------------------------------------------------------------------------
  test('Emulator: User CAN remove their own friend record from /users/{userId}/friends/{friendUid}', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'user_alice', 'friends', 'user_bob'), {
        uid: 'user_bob',
        nearuId: 'NEARU-BOB01',
        displayName: 'Bob',
        pairedAt: Timestamp.now(),
      });
    });

    const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
    await assertSucceeds(deleteDoc(doc(aliceDb, 'users', 'user_alice', 'friends', 'user_bob')));
  });

  // -------------------------------------------------------------------------
  // 5. A user removing their reciprocal friend record
  // -------------------------------------------------------------------------
  test('Emulator: User CAN remove their reciprocal friend record from /users/{friendUid}/friends/{userUid}', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'user_bob', 'friends', 'user_alice'), {
        uid: 'user_alice',
        nearuId: 'NEARU-ALICE',
        displayName: 'Alice',
        pairedAt: Timestamp.now(),
      });
    });

    // Alice deleting her record in Bob's friends subcollection
    const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
    await assertSucceeds(deleteDoc(doc(aliceDb, 'users', 'user_bob', 'friends', 'user_alice')));
  });

  // -------------------------------------------------------------------------
  // 6. A user being denied permission to delete an unrelated friend record
  // -------------------------------------------------------------------------
  test('Emulator: User is DENIED permission to delete an unrelated person friend record', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'user_bob', 'friends', 'user_charlie'), {
        uid: 'user_charlie',
        nearuId: 'NEARU-CHAR01',
        displayName: 'Charlie',
        pairedAt: Timestamp.now(),
      });
    });

    // Alice trying to delete Charlie from Bob's friends list
    const aliceDb = testEnv.authenticatedContext('user_alice').firestore();
    await assertFails(deleteDoc(doc(aliceDb, 'users', 'user_bob', 'friends', 'user_charlie')));
  });

  // -------------------------------------------------------------------------
  // 7. A user deleting their own NearU ID mapping and profile
  // -------------------------------------------------------------------------
  test('Emulator: User CAN delete their own NearU ID mapping and profile document', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'nearu_ids', 'NEARU-ALICE'), {
        uid: 'user_alice',
        createdAt: Timestamp.now(),
      });
      await setDoc(doc(db, 'users', 'user_alice'), {
        uid: 'user_alice',
        nearuId: 'NEARU-ALICE',
        displayName: 'Alice',
        createdAt: Timestamp.now(),
      });
    });

    const aliceDb = testEnv.authenticatedContext('user_alice').firestore();

    // Alice deleting her nearu_ids document
    await assertSucceeds(deleteDoc(doc(aliceDb, 'nearu_ids', 'NEARU-ALICE')));

    // Alice deleting her users document
    await assertSucceeds(deleteDoc(doc(aliceDb, 'users', 'user_alice')));
  });

  // -------------------------------------------------------------------------
  // 8. A user being denied permission to delete another user's profile or ID mapping
  // -------------------------------------------------------------------------
  test('Emulator: User is DENIED permission to delete another user profile or NearU ID mapping', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'nearu_ids', 'NEARU-BOB01'), {
        uid: 'user_bob',
        createdAt: Timestamp.now(),
      });
      await setDoc(doc(db, 'users', 'user_bob'), {
        uid: 'user_bob',
        nearuId: 'NEARU-BOB01',
        displayName: 'Bob',
        createdAt: Timestamp.now(),
      });
    });

    const aliceDb = testEnv.authenticatedContext('user_alice').firestore();

    // Alice trying to delete Bob's nearu_ids document: DENIED
    await assertFails(deleteDoc(doc(aliceDb, 'nearu_ids', 'NEARU-BOB01')));

    // Alice trying to delete Bob's users document: DENIED
    await assertFails(deleteDoc(doc(aliceDb, 'users', 'user_bob')));
  });

  // -------------------------------------------------------------------------
  // 9. Recipient-specific nicknames security rules
  // -------------------------------------------------------------------------
  test('Emulator: User CAN read, create, update, and delete their own nickname records', async () => {
    const bobDb = testEnv.authenticatedContext('user_bob').firestore();

    // Bob creates a nickname for friend Alice
    await assertSucceeds(
      setDoc(doc(bobDb, 'users', 'user_bob', 'nicknames', 'user_alice'), {
        nickname: 'AAA',
        updatedAt: serverTimestamp(),
      })
    );

    // Bob reads the nickname
    const snap = await assertSucceeds(getDoc(doc(bobDb, 'users', 'user_bob', 'nicknames', 'user_alice')));
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().nickname, 'AAA');

    // Bob updates the nickname
    await assertSucceeds(
      setDoc(doc(bobDb, 'users', 'user_bob', 'nicknames', 'user_alice'), {
        nickname: 'My Bestie',
        updatedAt: serverTimestamp(),
      })
    );

    // Bob deletes the nickname
    await assertSucceeds(deleteDoc(doc(bobDb, 'users', 'user_bob', 'nicknames', 'user_alice')));
  });

  // -------------------------------------------------------------------------
  // 10. Another user is DENIED access to read, modify, or delete another user\'s nicknames
  // -------------------------------------------------------------------------
  test('Emulator: Another user is DENIED access to read, modify, or delete someone else nicknames', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'user_bob', 'nicknames', 'user_alice'), {
        nickname: 'AAA',
        updatedAt: Timestamp.now(),
      });
    });

    const eveDb = testEnv.authenticatedContext('user_eve').firestore();

    // Eve trying to read Bob\'s nickname for Alice: DENIED
    await assertFails(getDoc(doc(eveDb, 'users', 'user_bob', 'nicknames', 'user_alice')));

    // Eve trying to overwrite Bob\'s nickname for Alice: DENIED
    await assertFails(
      setDoc(doc(eveDb, 'users', 'user_bob', 'nicknames', 'user_alice'), {
        nickname: 'Hacked',
        updatedAt: serverTimestamp(),
      })
    );

    // Eve trying to delete Bob\'s nickname for Alice: DENIED
    await assertFails(deleteDoc(doc(eveDb, 'users', 'user_bob', 'nicknames', 'user_alice')));
  });
} else {
  test('Emulator tests skipped: FIRESTORE_EMULATOR_HOST environment variable not set', () => {
    assert.ok(true, 'Skipped because not launched inside emulators:exec');
  });
}

