import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  Unsubscribe,
  Timestamp,
  addDoc,
  deleteDoc,
} from 'firebase/firestore';
import { auth, db, initializeAnonymousSession } from './firebase';
import { Friend, FriendRequest, UserProfile, NearuEvent } from '../types';
import {
  generateNearuId,
  normalizeNearuId,
  validateNearuIdFormat,
  saveUserProfile,
  getUserProfile,
  getDefaultFriendId,
  setDefaultFriendId as storageSetDefaultFriendId,
  clearAllLocalData,
} from './storage';
import { BACKEND_CONFIG } from '../constants/config';

export { normalizeNearuId, validateNearuIdFormat };

const AVATAR_PALETTE = ['#7958CF', '#4C3B78', '#6C5CE7', '#845EC2', '#A17FE0', '#E774A3'];

function getAvatarColor(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

/**
 * Ensures user is authenticated and has an atomic, collision-free Nearu ID registered in Firestore.
 * Preserves existing Nearu IDs without unintended regenerations.
 */
export async function syncUserIdentityWithCloud(
  displayName: string,
  preferredNearuId?: string
): Promise<UserProfile> {
  // 1. Ensure authenticated anonymous user
  let user = auth.currentUser;
  if (!user) {
    user = await initializeAnonymousSession();
  }
  if (!user) {
    throw new Error('Authentication unavailable. Please check your internet connection.');
  }

  const uid = user.uid;
  const sanitizedName = displayName?.trim().slice(0, 30) || 'Friend';

  // 2. Check if user profile already exists in Cloud Firestore under this UID
  try {
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      const nameChanged = Boolean(sanitizedName && sanitizedName !== data.displayName);

      if (nameChanged) {
        try {
          await updateDoc(userDocRef, {
            displayName: sanitizedName,
            updatedAt: serverTimestamp(),
          });
        } catch (updateErr) {
          console.warn('[Nearu Pairing] Could not update displayName in cloud:', updateErr);
        }
      }

      const existingProfile: UserProfile = {
        id: data.nearuId,
        uid: uid,
        name: nameChanged ? sanitizedName : (data.displayName || sanitizedName),
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now(),
      };
      await saveUserProfile(existingProfile);
      return existingProfile;
    }
  } catch (err) {
    console.info('[Nearu Pairing] Profile lookup before claim note:', err);
  }

  // 3. Check existing local profile
  const localProfile = await getUserProfile();
  let candidateId = (preferredNearuId || localProfile?.id || generateNearuId()).trim().toUpperCase();

  // 4. Atomically claim Nearu ID and create user profile
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const nearuIdDocRef = doc(db, 'nearu_ids', candidateId);
      const userDocRef = doc(db, 'users', uid);

      // Check if candidateId is already claimed by this user (repair partial write)
      try {
        const nearuSnap = await getDoc(nearuIdDocRef);
        if (nearuSnap.exists()) {
          const ownerUid = nearuSnap.data()?.uid;
          if (ownerUid === uid) {
            // Already owned by this user; write user doc to complete registration
            await setDoc(userDocRef, {
              uid: uid,
              nearuId: candidateId,
              displayName: sanitizedName,
              createdAt: serverTimestamp(),
            });

            const registeredProfile: UserProfile = {
              id: candidateId,
              uid: uid,
              name: sanitizedName,
              createdAt: Date.now(),
            };
            await saveUserProfile(registeredProfile);
            return registeredProfile;
          }
          // Owned by another user -> generate fresh ID
          candidateId = generateNearuId();
          continue;
        }
      } catch {
        // Continue to batch claim if getDoc check fails
      }

      const batch = writeBatch(db);
      batch.set(nearuIdDocRef, {
        uid: uid,
        createdAt: serverTimestamp(),
      });
      batch.set(userDocRef, {
        uid: uid,
        nearuId: candidateId,
        displayName: sanitizedName,
        createdAt: serverTimestamp(),
      });

      await batch.commit();

      const registeredProfile: UserProfile = {
        id: candidateId,
        uid: uid,
        name: sanitizedName,
        createdAt: Date.now(),
      };
      await saveUserProfile(registeredProfile);
      return registeredProfile;
    } catch (err) {
      console.warn(`[Nearu Pairing] Nearu ID ${candidateId} claim attempt ${attempts} error:`, err);
      candidateId = generateNearuId();
    }
  }

  throw new Error('Could not reserve a unique Nearu ID after multiple attempts. Please try again.');
}

// ===============================================================
// Timeout & Cache Helpers
// ===============================================================

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err: any = new Error(`${operationName} timed out after ${timeoutMs / 1000}s. Please check your internet connection.`);
      err.code = 'deadline-exceeded';
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

interface LookupCacheEntry {
  data: { uid: string; nearuId: string; displayName: string } | null;
  expiresAt: number;
}
const lookupCache = new Map<string, LookupCacheEntry>();
const CACHE_TTL_MS = 60_000;
const CACHE_NULL_TTL_MS = 10_000; // Shorter cache for not-found in case friend just registered

/**
 * Resolves a shareable Nearu ID to a registered user profile.
 * Normalizes input, applies caching, and guarantees caller authentication.
 */
export async function lookupUserByNearuId(
  nearuId: string
): Promise<{ uid: string; nearuId: string; displayName: string } | null> {
  const cleanId = normalizeNearuId(nearuId);
  if (!validateNearuIdFormat(cleanId)) {
    return null;
  }

  const cached = lookupCache.get(cleanId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Ensure caller is authenticated (rules require isAuthenticated() for nearu_ids get)
  if (!auth.currentUser) {
    await withTimeout(initializeAnonymousSession(), 10_000, 'Authentication session');
  }

  try {
    const nearuDocSnap = await withTimeout(
      getDoc(doc(db, 'nearu_ids', cleanId)),
      10_000,
      'NearU ID lookup'
    );
    if (!nearuDocSnap.exists()) {
      lookupCache.set(cleanId, { data: null, expiresAt: Date.now() + CACHE_NULL_TTL_MS });
      return null;
    }

    const targetUid = nearuDocSnap.data()?.uid;
    if (!targetUid) {
      lookupCache.set(cleanId, { data: null, expiresAt: Date.now() + CACHE_NULL_TTL_MS });
      return null;
    }

    const userDocSnap = await withTimeout(
      getDoc(doc(db, 'users', targetUid)),
      10_000,
      'User profile lookup'
    );
    let result: { uid: string; nearuId: string; displayName: string };
    if (!userDocSnap.exists()) {
      // Nearu ID mapping exists but user doc missing: return safe default
      result = {
        uid: targetUid,
        nearuId: cleanId,
        displayName: 'Friend',
      };
    } else {
      const userData = userDocSnap.data();
      result = {
        uid: targetUid,
        nearuId: cleanId,
        displayName: userData?.displayName || 'Friend',
      };
    }

    lookupCache.set(cleanId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.warn('[Nearu Pairing] Error looking up Nearu ID:', err);
    throw err;
  }
}

export interface SendRequestResult {
  success: boolean;
  message: string;
  targetName?: string;
}

/**
 * Sends a real friend request to a friend's Nearu ID.
 * Features:
 * - Full canonical normalization and validation
 * - Parallelized status checks to eliminate sequential network latency
 * - Bounded 10s timeouts protecting against hanging connections
 * - Deletes prior declined request document so Firestore rules evaluate as authorized create
 * - Distinguishes auth, offline, timeout, permission-denied, and nonexistent user errors
 */
export async function sendFriendRequest(
  toNearuId: string,
  fromProfile: UserProfile
): Promise<SendRequestResult> {
  // 1. Ensure caller authentication
  let currentUser = auth.currentUser;
  if (!currentUser) {
    try {
      currentUser = await withTimeout(initializeAnonymousSession(), 10_000, 'Authentication initialization');
    } catch {
      return {
        success: false,
        message: 'Authentication unavailable. Please check your internet connection.',
      };
    }
  }
  const currentUid = currentUser?.uid || fromProfile.uid;
  if (!currentUid) {
    return {
      success: false,
      message: 'Authentication is not ready. Please check your internet connection and try again.',
    };
  }

  const cleanTargetId = normalizeNearuId(toNearuId);
  if (!validateNearuIdFormat(cleanTargetId)) {
    return { success: false, message: 'Invalid ID format. Example: NEARU-7K29M4X2' };
  }

  const cleanFromId = normalizeNearuId(fromProfile.id);
  if (cleanTargetId === cleanFromId) {
    return { success: false, message: 'You cannot add yourself as a friend.' };
  }

  // 2. Look up recipient in Firestore
  let targetUser: { uid: string; nearuId: string; displayName: string } | null = null;
  try {
    targetUser = await lookupUserByNearuId(cleanTargetId);
  } catch (err: any) {
    const code = err?.code || '';
    const message = err?.message || '';
    if (code === 'permission-denied') {
      return {
        success: false,
        message: 'Permission denied while searching for user. Please verify your connection.',
      };
    }
    if (code === 'deadline-exceeded' || message.includes('timed out')) {
      return {
        success: false,
        message: 'User lookup timed out. Please check your internet connection.',
      };
    }
    if (code === 'unavailable' || message.toLowerCase().includes('offline')) {
      return {
        success: false,
        message: 'Network offline. Please check your internet connection.',
      };
    }
    return {
      success: false,
      message: `Error looking up user: ${message || 'Server error'}`,
    };
  }

  if (!targetUser) {
    return {
      success: false,
      message: `No user found with ID ${cleanTargetId}. Double-check the code with your friend.`,
    };
  }

  if (targetUser.uid === currentUid) {
    return { success: false, message: 'You cannot add yourself as a friend.' };
  }

  const targetUid = targetUser.uid;
  const outgoingId = `${currentUid}_${targetUid}`;
  const incomingId = `${targetUid}_${currentUid}`;

  // 3. Parallelize relationship checks: friends, outgoing request, incoming request
  const friendDocRef = doc(db, 'users', currentUid, 'friends', targetUid);
  const outDocRef = doc(db, 'friend_requests', outgoingId);
  const inDocRef = doc(db, 'friend_requests', incomingId);

  let friendDocSnap: any = null;
  let outSnap: any = null;
  let inSnap: any = null;

  try {
    [friendDocSnap, outSnap, inSnap] = await withTimeout(
      Promise.all([
        getDoc(friendDocRef),
        getDoc(outDocRef),
        getDoc(inDocRef),
      ]),
      10_000,
      'Friendship status check'
    );
  } catch (err: any) {
    const code = err?.code || '';
    const message = err?.message || '';
    if (code === 'deadline-exceeded' || message.includes('timed out')) {
      return {
        success: false,
        message: 'Status check timed out. Please check your internet connection.',
      };
    }
    if (code === 'permission-denied') {
      return {
        success: false,
        message: 'Permission denied checking friendship status. Please verify your connection.',
      };
    }
    console.info('[Nearu Pairing] Parallel friendship status check note:', err);
  }

  // 4. Evaluate friendship status
  if (friendDocSnap?.exists()) {
    return {
      success: false,
      message: `You and ${targetUser.displayName} are already friends!`,
      targetName: targetUser.displayName,
    };
  }

  let hadDeclinedOutgoing = false;
  if (outSnap?.exists()) {
    const data = outSnap.data();
    if (data.status === 'pending') {
      return {
        success: false,
        message: `Friend request already sent to ${targetUser.displayName}. Waiting for them to accept.`,
        targetName: targetUser.displayName,
      };
    }
    if (data.status === 'accepted') {
      return {
        success: false,
        message: `You and ${targetUser.displayName} are already friends!`,
        targetName: targetUser.displayName,
      };
    }
    if (data.status === 'declined') {
      hadDeclinedOutgoing = true;
    }
  }

  if (inSnap?.exists()) {
    const inData = inSnap.data();
    if (inData.status === 'pending') {
      return {
        success: false,
        message: `${targetUser.displayName} already sent you a request! Look under Incoming Requests to accept.`,
        targetName: targetUser.displayName,
      };
    }
  }

  // 5. Clean up previous declined outgoing request if present
  // In Firestore, if a document exists with status 'declined', calling setDoc triggers
  // allow update (isValidFriendRequestUpdate), which rejects status 'pending' (permission-denied).
  // Security rules explicitly allow participants to delete non-accepted requests.
  if (hadDeclinedOutgoing) {
    try {
      await withTimeout(
        deleteDoc(outDocRef),
        5_000,
        'Cleaning previous declined request'
      );
    } catch (delErr) {
      console.warn('[Nearu Pairing] Could not delete previous declined request:', delErr);
    }
  }

  // 6. Create deterministic friend request
  try {
    const sanitizedFromName = (fromProfile.name || 'Friend').trim().slice(0, 30) || 'Friend';
    const sanitizedToName = (targetUser.displayName || 'Friend').trim().slice(0, 30) || 'Friend';

    await withTimeout(
      setDoc(outDocRef, {
        fromUid: currentUid,
        toUid: targetUid,
        fromNearuId: cleanFromId,
        toNearuId: cleanTargetId,
        fromName: sanitizedFromName,
        toName: sanitizedToName,
        status: 'pending',
        createdAt: serverTimestamp(),
      }),
      10_000,
      'Sending friend request'
    );

    return {
      success: true,
      message: `Friend request sent to ${sanitizedToName}!`,
      targetName: sanitizedToName,
    };
  } catch (err: any) {
    console.error('[Nearu Pairing] Failed to send friend request:', err);
    const code = err?.code || '';
    const message = err?.message || '';
    if (code === 'permission-denied') {
      return {
        success: false,
        message: 'Permission denied creating friend request. Please verify your connection and account session.',
      };
    }
    if (code === 'deadline-exceeded' || message.includes('timed out')) {
      return {
        success: false,
        message: 'Friend request timed out. Please verify whether the request was sent before trying again.',
      };
    }
    if (code === 'unavailable' || message.toLowerCase().includes('offline')) {
      return {
        success: false,
        message: 'Network offline. Please check your internet connection.',
      };
    }
    return {
      success: false,
      message: `Could not send friend request: ${message || 'Server error'}`,
    };
  }
}


/**
 * Accepts an incoming friend request and atomically establishes mutual friendship.
 * Idempotent: safely handles duplicate taps, network retries, and normalizes identity fields.
 */
export async function acceptFriendRequest(
  request: FriendRequest
): Promise<void> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid || currentUid !== request.toUid) {
    throw new Error('Unauthorized to accept this request.');
  }

  const requestRef = doc(db, 'friend_requests', request.id);

  // 1. Idempotency check: if already accepted, return cleanly without throwing permission errors
  try {
    const snap = await getDoc(requestRef);
    if (snap.exists() && snap.data()?.status === 'accepted') {
      return;
    }
  } catch (checkErr) {
    console.info('[Nearu Pairing] Pre-acceptance status check note:', checkErr);
  }

  const cleanFromNearuId = normalizeNearuId(request.fromNearuId);
  const cleanToNearuId = normalizeNearuId(request.toNearuId);
  const sanitizedFromName = (request.fromName || 'Friend').trim().slice(0, 30) || 'Friend';
  const sanitizedToName = (request.toName || 'Friend').trim().slice(0, 30) || 'Friend';

  const recipientFriendRef = doc(db, 'users', request.toUid, 'friends', request.fromUid);
  const senderFriendRef = doc(db, 'users', request.fromUid, 'friends', request.toUid);

  // 2. Clear any stale reciprocal friend doc to guarantee batch.set is evaluated as 'create' by security rules
  try {
    await deleteDoc(senderFriendRef);
  } catch {
    // Non-fatal if document does not exist
  }

  const batch = writeBatch(db);

  // 3. Mark request as accepted
  batch.update(requestRef, {
    status: 'accepted',
    updatedAt: serverTimestamp(),
  });

  // 4. Add to recipient's friends collection
  batch.set(recipientFriendRef, {
    uid: request.fromUid,
    nearuId: cleanFromNearuId,
    displayName: sanitizedFromName,
    pairedAt: serverTimestamp(),
  });

  // 5. Add to sender's friends collection atomically
  batch.set(senderFriendRef, {
    uid: request.toUid,
    nearuId: cleanToNearuId,
    displayName: sanitizedToName,
    pairedAt: serverTimestamp(),
  });

  await withTimeout(
    batch.commit(),
    10_000,
    'Accepting friend request'
  );
}

/**
 * Declines an incoming friend request.
 */
export async function declineFriendRequest(
  request: FriendRequest
): Promise<void> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid || currentUid !== request.toUid) {
    throw new Error('Unauthorized to decline this request.');
  }

  await updateDoc(doc(db, 'friend_requests', request.id), {
    status: 'declined',
    updatedAt: serverTimestamp(),
  });
}

/**
 * Cancels a pending outgoing request.
 */
export async function cancelOutgoingRequest(
  requestId: string
): Promise<void> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return;

  const requestRef = doc(db, 'friend_requests', requestId);
  const snap = await getDoc(requestRef);
  if (snap.exists() && snap.data().fromUid === currentUid) {
    await updateDoc(requestRef, {
      status: 'declined',
      updatedAt: serverTimestamp(),
    });
  }
}

export interface RemoveFriendResult {
  success: boolean;
  message: string;
}

/**
 * Removes an individual friend relationship.
 * Deletes from the user's friend subcollection and attempts reciprocal deletion.
 * Clears default-friend selection if the removed friend was default.
 */
export async function removeFriend(friendUid: string): Promise<RemoveFriendResult> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) {
    return { success: false, message: 'Authentication required. Check connection.' };
  }
  if (!friendUid) {
    return { success: false, message: 'Invalid friend identifier.' };
  }

  try {
    // 1. Delete from current user's friends collection: users/{currentUid}/friends/{friendUid}
    await deleteDoc(doc(db, 'users', currentUid, 'friends', friendUid));

    // 2. Attempt reciprocal delete from friend's collection: users/{friendUid}/friends/{currentUid}
    try {
      await deleteDoc(doc(db, 'users', friendUid, 'friends', currentUid));
    } catch (recipErr: any) {
      console.info(`[Nearu Pairing] Reciprocal delete note for ${friendUid}:`, recipErr?.code || recipErr?.message);
    }

    // 3. Clear default friend if it was this friend
    const currentDefault = await getDefaultFriendId();
    if (currentDefault === friendUid) {
      await storageSetDefaultFriendId(null);
    }

    return {
      success: true,
      message: 'Friend removed successfully.',
    };
  } catch (err: any) {
    console.error('[Nearu Pairing] Failed to remove friend:', err);
    const code = err?.code || '';
    if (code === 'permission-denied') {
      return { success: false, message: 'Permission denied while removing friend.' };
    }
    if (code === 'unavailable') {
      return { success: false, message: 'Network offline. Please check connection.' };
    }
    return { success: false, message: `Could not remove friend: ${err?.message || 'Server error'}` };
  }
}

export interface ClearFriendsResult {
  success: boolean;
  clearedCount: number;
  message: string;
}

/**
 * Removes all accepted friendships for the current user from Cloud Firestore.
 * Handles both sides of friendship records consistently with the schema.
 * Preserves user profile, Nearu ID, settings, and pending requests.
 */
export async function clearAllFriends(): Promise<ClearFriendsResult> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) {
    return { success: false, clearedCount: 0, message: 'Authentication required. Check connection.' };
  }

  try {
    const friendsRef = collection(db, 'users', currentUid, 'friends');
    const snap = await getDocs(friendsRef);

    if (snap.empty) {
      await storageSetDefaultFriendId(null);
      return { success: true, clearedCount: 0, message: 'No friends in list to clear.' };
    }

    let clearedCount = 0;
    const errors: string[] = [];

    for (const docSnap of snap.docs) {
      const friendUid = docSnap.id;
      try {
        // Delete own friend document
        await deleteDoc(doc(db, 'users', currentUid, 'friends', friendUid));
        clearedCount++;

        // Attempt reciprocal delete from friend's subcollection
        try {
          await deleteDoc(doc(db, 'users', friendUid, 'friends', currentUid));
        } catch (recipErr: any) {
          console.info(`[Nearu Pairing] Reciprocal clear note for ${friendUid}:`, recipErr?.code || recipErr?.message);
        }
      } catch (err: any) {
        errors.push(`Friend ${friendUid}: ${err?.message || 'failed'}`);
      }
    }

    // Reset default friend
    await storageSetDefaultFriendId(null);

    if (errors.length > 0) {
      return {
        success: clearedCount > 0,
        clearedCount,
        message: `Removed ${clearedCount} friend(s) with partial errors: ${errors.join(', ')}`,
      };
    }

    return {
      success: true,
      clearedCount,
      message: `Cleared all ${clearedCount} friend(s) successfully.`,
    };
  } catch (err: any) {
    console.error('[Nearu Pairing] Failed to clear all friends:', err);
    return {
      success: false,
      clearedCount: 0,
      message: `Error clearing friends: ${err?.message || 'Server error'}`,
    };
  }
}

export interface DeleteAccountResult {
  success: boolean;
  status: 'complete' | 'partial_auth_failed' | 'partial_subcollections_failed' | 'failed';
  message: string;
  error?: string;
}

/**
 * Permanently deletes user account and associated personal data across Firestore and Auth.
 * Cleans up subcollections, mappings, and local storage.
 * Strictly guarantees that failures in any step are truthfully reported and never masked as success.
 */
export async function deleteUserAccount(): Promise<DeleteAccountResult> {
  const user = auth.currentUser;
  if (!user) {
    return {
      success: false,
      status: 'failed',
      message: 'Authentication required. Check connection.',
    };
  }
  const currentUid = user.uid;

  try {
    // 1. Fetch user document to discover claimed Nearu ID
    const userDocRef = doc(db, 'users', currentUid);
    let nearuId: string | null = null;
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      nearuId = userSnap.data()?.nearuId || null;
    }
    if (!nearuId) {
      const localProfile = await getUserProfile();
      nearuId = localProfile?.id || null;
    }

    let failedSubcollections = 0;

    // 2. Remove all friends (own subcollection and reciprocal)
    try {
      const friendsRef = collection(db, 'users', currentUid, 'friends');
      const friendsSnap = await getDocs(friendsRef);
      for (const fDoc of friendsSnap.docs) {
        const friendUid = fDoc.id;
        try {
          await deleteDoc(doc(db, 'users', currentUid, 'friends', friendUid));
        } catch {
          failedSubcollections++;
        }
        try {
          await deleteDoc(doc(db, 'users', friendUid, 'friends', currentUid));
        } catch {
          // If reciprocal delete is blocked or offline, note failure
          failedSubcollections++;
        }
      }
    } catch {
      failedSubcollections++;
    }

    // 3. Remove device push tokens
    try {
      const expoRef = collection(db, 'users', currentUid, 'expo_push_tokens');
      const expoSnap = await getDocs(expoRef);
      for (const tDoc of expoSnap.docs) {
        try {
          await deleteDoc(tDoc.ref);
        } catch {
          failedSubcollections++;
        }
      }
      const fcmRef = collection(db, 'users', currentUid, 'fcm_tokens');
      const fcmSnap = await getDocs(fcmRef);
      for (const tDoc of fcmSnap.docs) {
        try {
          await deleteDoc(tDoc.ref);
        } catch {
          failedSubcollections++;
        }
      }
    } catch {
      failedSubcollections++;
    }

    // 4. Remove nearu_events
    try {
      const eventsRef = collection(db, 'users', currentUid, 'nearu_events');
      const eventsSnap = await getDocs(eventsRef);
      for (const eDoc of eventsSnap.docs) {
        try {
          await deleteDoc(eDoc.ref);
        } catch {
          failedSubcollections++;
        }
      }
    } catch {
      failedSubcollections++;
    }

    // 5. Clean up non-accepted friend requests involving this user
    try {
      const outgoingQ = query(collection(db, 'friend_requests'), where('fromUid', '==', currentUid));
      const outSnap = await getDocs(outgoingQ);
      for (const rDoc of outSnap.docs) {
        if (rDoc.data()?.status !== 'accepted') {
          try {
            await deleteDoc(rDoc.ref);
          } catch {
            failedSubcollections++;
          }
        }
      }
      const incomingQ = query(collection(db, 'friend_requests'), where('toUid', '==', currentUid));
      const inSnap = await getDocs(incomingQ);
      for (const rDoc of inSnap.docs) {
        if (rDoc.data()?.status !== 'accepted') {
          try {
            await deleteDoc(rDoc.ref);
          } catch {
            failedSubcollections++;
          }
        }
      }
    } catch {
      failedSubcollections++;
    }

    // If subcollection cleanup had failures, DO NOT proceed to irreversible root document deletion
    if (failedSubcollections > 0) {
      return {
        success: false,
        status: 'partial_subcollections_failed',
        message: 'Could not delete all friend or notification records. Account deletion stopped before removing profile. Please check your connection and retry.',
      };
    }

    // 6. Delete Nearu ID mapping (CRITICAL: Do not swallow failure)
    if (nearuId) {
      await deleteDoc(doc(db, 'nearu_ids', nearuId));
    }

    // 7. Delete user root document (CRITICAL: Do not swallow failure)
    await deleteDoc(userDocRef);

    // 8. Delete Firebase Auth user
    try {
      await user.delete();
    } catch (authErr: any) {
      const authCode = authErr?.code || '';
      const authMessage = authErr?.message || String(authErr);
      console.warn('[Nearu Pairing] Firebase Auth user delete note:', authCode, authMessage);

      // CRITICAL: Do NOT report complete deletion if Firebase Auth user deletion failed.
      // Firestore data and NearU ID have already been deleted, but the Auth user still exists.
      return {
        success: false,
        status: 'partial_auth_failed',
        message: authCode.includes('requires-recent-login')
          ? 'Cloud data and NearU ID deleted, but your authentication session requires re-authentication to finalize deletion. Please restart the app and retry.'
          : `Cloud data deleted, but authentication account deletion failed (${authCode || 'network error'}). Please retry to finalize account deletion.`,
        error: authCode || authMessage,
      };
    }

    // 9. Wipe all local data ONLY when all cloud deletions (Firestore + Auth) have succeeded
    await clearAllLocalData();

    return {
      success: true,
      status: 'complete',
      message: 'Account and associated data deleted successfully.',
    };
  } catch (err: any) {
    console.error('[Nearu Pairing] Error deleting user account:', err);
    const code = err?.code || '';
    const message = err?.message || String(err);
    if (code.includes('permission-denied') || message.includes('permission')) {
      return {
        success: false,
        status: 'failed',
        message: 'Permission denied: Cannot delete account documents until updated security rules are deployed.',
      };
    }
    if (code.includes('unavailable') || code.includes('offline') || message.includes('network') || message.includes('offline')) {
      return {
        success: false,
        status: 'failed',
        message: 'Network unavailable. Please check your internet connection to delete your account.',
      };
    }
    return {
      success: false,
      status: 'failed',
      message: `Failed to delete account completely: ${message || 'Server error'}`,
    };
  }
}

/**
 * Subscribes to incoming friend requests in real-time.
 */
export function subscribeToIncomingRequests(
  uid: string,
  onUpdate: (requests: FriendRequest[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'friend_requests'),
    where('toUid', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const requests: FriendRequest[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.status === 'pending') {
          requests.push({
            id: docSnap.id,
            fromUid: d.fromUid,
            toUid: d.toUid,
            fromNearuId: d.fromNearuId,
            toNearuId: d.toNearuId,
            fromName: d.fromName,
            toName: d.toName,
            status: d.status,
            createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now(),
            updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : undefined,
          });
        }
      });
      onUpdate(requests);
    },
    (error) => {
      console.warn('[Nearu Pairing] Error in incoming requests subscription:', error);
    }
  );
}

/**
 * Subscribes to outgoing pending requests in real-time.
 */
export function subscribeToOutgoingRequests(
  uid: string,
  onUpdate: (requests: FriendRequest[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'friend_requests'),
    where('fromUid', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const requests: FriendRequest[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.status === 'pending') {
          requests.push({
            id: docSnap.id,
            fromUid: d.fromUid,
            toUid: d.toUid,
            fromNearuId: d.fromNearuId,
            toNearuId: d.toNearuId,
            fromName: d.fromName,
            toName: d.toName,
            status: d.status,
            createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now(),
            updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : undefined,
          });
        }
      });
      onUpdate(requests);
    },
    (error) => {
      console.warn('[Nearu Pairing] Error in outgoing requests subscription:', error);
    }
  );
}

/**
 * Subscribes to synchronized Cloud Firestore friends.
 */
export function subscribeToCloudFriends(
  uid: string,
  onUpdate: (friends: Friend[]) => void
): Unsubscribe {
  const friendsRef = collection(db, 'users', uid, 'friends');

  return onSnapshot(
    friendsRef,
    (snapshot) => {
      const friends: Friend[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        friends.push({
          id: d.nearuId || docSnap.id,
          uid: d.uid || docSnap.id,
          nearuId: d.nearuId || docSnap.id,
          name: d.displayName || 'Friend',
          avatarColor: getAvatarColor(d.displayName || docSnap.id),
          relationshipTag: 'Friend',
          lastNearuSentAt: d.lastNearuSentAt || undefined,
          pairedAt: d.pairedAt instanceof Timestamp ? d.pairedAt.toMillis() : Date.now(),
          isSample: false,
        });
      });
      onUpdate(friends);
    },
    (error) => {
      console.warn('[Nearu Pairing] Error in cloud friends subscription:', error);
    }
  );
}

// ========== Real Device-to-Device NearU Event Delivery ==========

// In-memory rate limiting: friendUid -> timestamp of last NearU sent
const recentSends = new Map<string, number>();
const SEND_COOLDOWN_MS = 5000; // 5 seconds cooldown per friend

export interface SendNearuResult {
  success: boolean;
  message: string;
  cooldownRemaining?: number;
}

/**
 * Sends a real NearU message to an accepted friend's device.
 * If BACKEND_CONFIG.WORKER_URL is set, delivers through the secure Cloudflare Worker
 * backend (which verifies ID token, verifies mutual friendship, writes event doc, and
 * sends high-priority Expo push notification to the recipient).
 *
 * If WORKER_URL is not configured (or during offline development), falls back to direct
 * Firestore document creation so in-app real-time reception works seamlessly.
 */
export async function sendRealNearuEvent(
  toFriendUid: string,
  fromProfile: UserProfile,
  eventType: 'standard' | 'long_press' = 'standard',
  messageText: string = 'Thinking of you 💙'
): Promise<SendNearuResult> {
  const currentUid = auth.currentUser?.uid || fromProfile.uid;
  if (!currentUid) {
    return { success: false, message: 'Authentication required. Check connection.' };
  }

  // Defensively resolve if caller passed a Nearu ID instead of Auth UID
  let resolvedTargetUid = toFriendUid;
  if (toFriendUid.startsWith('NEARU-')) {
    try {
      const resolved = await lookupUserByNearuId(toFriendUid);
      if (resolved?.uid) {
        resolvedTargetUid = resolved.uid;
      }
    } catch {
      // proceed with toFriendUid if lookup fails
    }
  }

  // 1. Rate limiting check
  const now = Date.now();
  const lastSent = recentSends.get(resolvedTargetUid) || 0;
  const elapsed = now - lastSent;
  if (elapsed < SEND_COOLDOWN_MS) {
    const remaining = Math.ceil((SEND_COOLDOWN_MS - elapsed) / 1000);
    return {
      success: false,
      message: `Please wait ${remaining}s before sending another NearU.`,
      cooldownRemaining: remaining,
    };
  }

  const cleanMessage = (messageText || 'Thinking of you 💙').trim().slice(0, 120);
  const eventId = `event_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // 2. If Cloudflare Worker URL is configured, use the push notification backend
  if (BACKEND_CONFIG.WORKER_URL) {
    try {
      const user = auth.currentUser;
      const idToken = user ? await user.getIdToken() : null;

      if (idToken) {
        const workerResponse = await fetch(`${BACKEND_CONFIG.WORKER_URL.replace(/\/+$/, '')}/api/send-nearu`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            toUid: resolvedTargetUid,
            message: cleanMessage,
            type: eventType,
            eventId,
            fromName: fromProfile.name,
          }),
        });

        if (workerResponse.ok) {
          recentSends.set(resolvedTargetUid, now);
          return {
            success: true,
            message: 'NearU delivered.',
          };
        }

        // Server returned an error status
        const errorData = await workerResponse.json().catch(() => ({}));
        if (workerResponse.status === 429) {
          const waitSecs = errorData.cooldownRemaining || 5;
          return {
            success: false,
            message: `Please wait ${waitSecs}s before sending another NearU.`,
            cooldownRemaining: waitSecs,
          };
        }
        if (workerResponse.status === 403) {
          return {
            success: false,
            message: errorData.error || 'Unauthorized: sender and recipient must be accepted friends.',
          };
        }

        console.warn('[Nearu Pairing] Worker responded with error, falling back to direct Firestore:', errorData);
      }
    } catch (workerErr) {
      console.warn('[Nearu Pairing] Could not reach Cloudflare Worker, falling back to direct Firestore:', workerErr);
    }
  }

  // 3. Fallback: Direct Firestore event document creation
  try {
    const eventsRef = collection(db, 'users', resolvedTargetUid, 'nearu_events');
    await addDoc(eventsRef, {
      fromUid: currentUid,
      fromName: fromProfile.name,
      fromNearuId: fromProfile.id,
      toUid: resolvedTargetUid,
      timestamp: serverTimestamp(),
      type: eventType,
      message: cleanMessage,
    });

    recentSends.set(resolvedTargetUid, now);

    return {
      success: true,
      message: 'NearU delivered to delivery service.',
    };
  } catch (err: unknown) {
    console.error('[Nearu Pairing] Failed to send Nearu event:', err);
    const errorMsg = err instanceof Error ? err.message : 'Could not send NearU. Make sure you are mutual friends.';
    return {
      success: false,
      message: errorMsg,
    };
  }
}

export type EventHandlingResult = 'handled' | 'retry';

/**
 * Subscribes to incoming NearU message events in real time.
 * Coordinates with the UI handler before deleting the Firestore document.
 *
 * Retry & Deletion Semantics:
 * - Handled events: If onEvent() returns 'handled', the event ID is added to handledEventIds
 *   and deleteDoc() is executed.
 * - Failed deletion: If deleteDoc() fails, the document remains in Firestore. Because
 *   handledEventIds is local to this subscription instance, it does not survive reattachment;
 *   the event will be delivered again in the initial snapshot when the listener reconnects
 *   or is reattached. Within the active subscription, handledEventIds guards against duplicate
 *   onEvent() invocation if the same document change is redelivered.
 * - Retained events: If onEvent() throws or returns 'retry', the document is NOT deleted.
 *   It remains in Firestore and is processed again when the listener reconnects or is reattached.
 */
export function subscribeToNearuEvents(
  uid: string,
  onEvent: (
    event: NearuEvent,
    options: { isInitialSnapshot: boolean }
  ) => Promise<EventHandlingResult> | EventHandlingResult
): Unsubscribe {
  const eventsRef = collection(db, 'users', uid, 'nearu_events');
  let isInitialSnapshot = true;

  // Each subscription instance owns its own in-flight and handled tracking
  const inFlightEventIds = new Set<string>();
  const handledEventIds = new Set<string>();

  return onSnapshot(
    eventsRef,
    (snapshot) => {
      const isInitial = isInitialSnapshot;
      isInitialSnapshot = false;

      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== 'added') return;

        const docId = change.doc.id;

        // 1. Guard against concurrent in-flight execution on overlapping callbacks
        if (inFlightEventIds.has(docId)) {
          return;
        }

        // 2. If already handled in this subscription instance (guards against redelivery within same listener):
        // Skip invoking onEvent() again to prevent duplicate vibration/toast and attempt deletion cleanup
        if (handledEventIds.has(docId)) {
          try {
            await deleteDoc(change.doc.ref);
          } catch (retryErr) {
            console.warn('[Nearu Pairing] deleteDoc retry warning:', retryErr);
          }
          return;
        }

        // 3. Mark in-flight before awaiting handler
        inFlightEventIds.add(docId);

        const d = change.doc.data();
        const eventTime =
          d.timestamp instanceof Timestamp
            ? d.timestamp.toMillis()
            : Date.now();

        let result: EventHandlingResult = 'retry';
        try {
          result = await onEvent(
            {
              id: docId,
              fromUid: d.fromUid,
              fromNearuId: d.fromNearuId || '',
              fromName: d.fromName || 'Friend',
              toUid: d.toUid,
              timestamp: eventTime,
              type: d.type || 'standard',
              message: d.message || undefined,
            },
            { isInitialSnapshot: isInitial }
          );

          if (result === 'handled') {
            handledEventIds.add(docId);
          }
        } catch (handlerErr) {
          console.warn('[Nearu Pairing] Event handler error, retaining document in Firestore for reconnect/reattach:', handlerErr);
          result = 'retry';
        } finally {
          inFlightEventIds.delete(docId);
        }

        // 4. Delete from Firestore ONLY if handling returned 'handled'
        if (result === 'handled') {
          try {
            await deleteDoc(change.doc.ref);
          } catch (deleteErr) {
            console.warn('[Nearu Pairing] Error cleaning up processed event:', deleteErr);
          }
        }
      });
    },
    (err) => {
      console.warn('[Nearu Pairing] Error subscribing to Nearu events:', err);
    }
  );
}


