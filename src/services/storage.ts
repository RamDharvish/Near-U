import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Friend, UserProfile, NearuMessage } from '../types';

const STORAGE_KEYS = {
  USER_PROFILE: '@nearu:user_profile',
  FRIENDS: '@nearu:friends',
  HAS_COMPLETED_ONBOARDING: '@nearu:onboarding_completed',
  NICKNAMES: '@nearu:nicknames',
  DEFAULT_FRIEND_ID: '@nearu:default_friend_id',
  THEME_PREFERENCE: '@nearu:theme_preference',
  CUSTOM_MESSAGES: '@nearu:custom_messages',
  SELECTED_MESSAGE_ID: '@nearu:selected_message_id',
};

// Generates an unpredictable, human-friendly Nearu ID like "NEARU-7K29M4X2" (1.1 trillion combinations)
export function generateNearuId(): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous 0, O, 1, I
  const bytes = new Uint8Array(8);

  if (typeof Crypto?.getRandomValues === 'function') {
    Crypto.getRandomValues(bytes);
  } else if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error(
      'Cryptographically secure random number generator (CSPRNG) is unavailable in this runtime.'
    );
  }

  let code = '';
  for (let i = 0; i < 8; i++) {
    code += characters[bytes[i] % characters.length];
  }
  return `NEARU-${code}`;
}

/**
 * Normalizes a user-entered or stored NearU ID into its canonical format:
 * - Strips zero-width characters and invisible formatting marks (\u200B, \uFEFF, \u00A0, etc.)
 * - Trims leading and trailing whitespace
 * - Converts to uppercase
 * - If user typed "NEARU 7K29M4X2" or "NEARU: 7K29M4X2", standardizes to "NEARU-7K29M4X2"
 * - If user entered only the 4-12 character alphanumeric code (e.g. "7K29M4X2"), prepends "NEARU-"
 */
export function normalizeNearuId(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  // Strip zero-width, non-breaking, and directional marks
  let clean = raw.replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F]/g, '').trim().toUpperCase();
  // Standardize separator if user typed "NEARU 7K29M4X2" or "NEARU:7K29M4X2" or "NEARU - 7K29M4X2"
  clean = clean.replace(/^NEARU\s*[-:_ ]\s*/, 'NEARU-');
  // If user entered only the 4-12 character alphanumeric code without prefix, prepend NEARU-
  if (/^[A-Z0-9]{4,12}$/.test(clean)) {
    clean = `NEARU-${clean}`;
  }
  return clean;
}

/**
 * Validates whether a normalized string conforms to the official NearU ID format:
 * Matches ^NEARU-[A-Z0-9]{4,12}$ (same validation as Cloud Firestore security rules).
 */
export function validateNearuIdFormat(raw: string): boolean {
  const normalized = normalizeNearuId(raw);
  return /^NEARU-[A-Z0-9]{4,12}$/.test(normalized);
}

export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEYS.USER_PROFILE);
    return json ? JSON.parse(json) : null;
  } catch (error) {
    console.warn('[Nearu Storage] Failed to load user profile:', error);
    return null;
  }
}

export async function saveUserProfile(profile: UserProfile): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(profile));
    await AsyncStorage.setItem(STORAGE_KEYS.HAS_COMPLETED_ONBOARDING, 'true');
    return true;
  } catch (error) {
    console.error('[Nearu Storage] Failed to save user profile:', error);
    return false;
  }
}

export async function getFriends(): Promise<Friend[]> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEYS.FRIENDS);
    if (json) {
      return JSON.parse(json);
    }
    // No friends yet — return empty list (no demo seeding)
    return [];
  } catch (error) {
    console.warn('[Nearu Storage] Failed to load friends list:', error);
    return [];
  }
}

export async function saveFriends(friends: Friend[]): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.FRIENDS, JSON.stringify(friends));
    return true;
  } catch (error) {
    console.error('[Nearu Storage] Failed to save friends list:', error);
    return false;
  }
}

export async function addFriend(newFriend: Friend): Promise<Friend[]> {
  const currentFriends = await getFriends();
  const existing = currentFriends.find(
    (f) => f.id.toUpperCase() === newFriend.id.toUpperCase()
  );
  if (existing) {
    return currentFriends;
  }
  const updated = [newFriend, ...currentFriends];
  await saveFriends(updated);
  return updated;
}

export async function updateFriendLastSent(friendId: string): Promise<Friend[]> {
  const current = await getFriends();
  const updated = current.map((f) =>
    f.id === friendId ? { ...f, lastNearuSentAt: Date.now() } : f
  );
  await saveFriends(updated);
  return updated;
}

// ========== Nicknames (local-only, per-user personalization) ==========

export type NicknameMap = Record<string, string>; // friendUid -> nickname

export async function getNicknames(): Promise<NicknameMap> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEYS.NICKNAMES);
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

export async function setNickname(friendUid: string, nickname: string): Promise<NicknameMap> {
  const map = await getNicknames();
  if (nickname.trim()) {
    map[friendUid] = nickname.trim();
  } else {
    delete map[friendUid];
  }
  await AsyncStorage.setItem(STORAGE_KEYS.NICKNAMES, JSON.stringify(map));
  return map;
}

export { resolveFriendDisplayName } from './displayName';
export type { SenderIdentity } from './displayName';

// ========== Default (Favorite) Friend ==========

export async function getDefaultFriendId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.DEFAULT_FRIEND_ID);
  } catch {
    return null;
  }
}

export async function setDefaultFriendId(friendUid: string | null): Promise<void> {
  try {
    if (friendUid) {
      await AsyncStorage.setItem(STORAGE_KEYS.DEFAULT_FRIEND_ID, friendUid);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEYS.DEFAULT_FRIEND_ID);
    }
  } catch {
    // ignore
  }
}

// ========== Theme Preference ==========

export type ThemePreference = 'light' | 'dark' | 'system';

export async function getThemePreference(): Promise<ThemePreference> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEYS.THEME_PREFERENCE);
    if (value === 'light' || value === 'dark' || value === 'system') {
      return value;
    }
    return 'system';
  } catch {
    return 'system';
  }
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.THEME_PREFERENCE, pref);
  } catch {
    // ignore
  }
}

// ========== Customizable Nearu Messages ==========

export const DEFAULT_BUILTIN_MESSAGE = 'Thinking of you 💙';
export const MAX_CUSTOM_MESSAGES = 5; // Default message + up to 5 additional custom messages = 6 total
export const MAX_MESSAGE_LENGTH = 120;

export interface MessageValidationResult {
  isValid: boolean;
  error?: string;
  trimmed: string;
}

/**
 * Validates a Nearu message text: trims whitespace, rejects empty, and enforces max length.
 */
export function validateMessageText(text: string): MessageValidationResult {
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

/**
 * Loads all saved messages. Initializes with the default message if none exist.
 * Never silently resets or overwrites existing messages.
 */
export async function getCustomMessages(): Promise<NearuMessage[]> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEYS.CUSTOM_MESSAGES);
    if (json) {
      const parsed: NearuMessage[] = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Ensure at least one message is designated as default
        const hasDefault = parsed.some((m) => m.isDefault);
        if (!hasDefault) {
          parsed[0].isDefault = true;
          await saveCustomMessages(parsed);
        }
        return parsed;
      }
    }
  } catch (error) {
    console.warn('[Nearu Storage] Failed to load custom messages:', error);
  }

  // Initial setup: built-in default message
  const initialMessages: NearuMessage[] = [
    {
      id: 'default',
      text: DEFAULT_BUILTIN_MESSAGE,
      isDefault: true,
      createdAt: Date.now(),
    },
  ];
  await saveCustomMessages(initialMessages);
  return initialMessages;
}

export async function saveCustomMessages(messages: NearuMessage[]): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.CUSTOM_MESSAGES, JSON.stringify(messages));
    return true;
  } catch (error) {
    console.error('[Nearu Storage] Failed to save custom messages:', error);
    return false;
  }
}

/**
 * Adds a new custom message, enforcing the maximum of 5 additional custom messages (6 total).
 */
export async function addCustomMessage(
  text: string
): Promise<{ success: boolean; messages: NearuMessage[]; newId?: string; error?: string }> {
  const validation = validateMessageText(text);
  if (!validation.isValid) {
    return {
      success: false,
      messages: await getCustomMessages(),
      error: validation.error,
    };
  }

  const currentMessages = await getCustomMessages();
  // Count custom messages (excluding the 1 default message)
  const customCount = currentMessages.filter((m) => !m.isDefault).length;

  if (customCount >= MAX_CUSTOM_MESSAGES) {
    return {
      success: false,
      messages: currentMessages,
      error: `Limit reached: You can save up to ${MAX_CUSTOM_MESSAGES} custom messages.`,
    };
  }

  const newId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const newMessage: NearuMessage = {
    id: newId,
    text: validation.trimmed,
    isDefault: false,
    createdAt: Date.now(),
  };

  const updated = [...currentMessages, newMessage];
  await saveCustomMessages(updated);

  return {
    success: true,
    messages: updated,
    newId,
  };
}

/**
 * Updates an existing message's text (including the default message).
 */
export async function updateCustomMessage(
  id: string,
  text: string
): Promise<{ success: boolean; messages: NearuMessage[]; error?: string }> {
  const validation = validateMessageText(text);
  const currentMessages = await getCustomMessages();

  if (!validation.isValid) {
    return {
      success: false,
      messages: currentMessages,
      error: validation.error,
    };
  }

  const targetIndex = currentMessages.findIndex((m) => m.id === id);
  if (targetIndex === -1) {
    return {
      success: false,
      messages: currentMessages,
      error: 'Message not found.',
    };
  }

  const updated = currentMessages.map((m) =>
    m.id === id ? { ...m, text: validation.trimmed } : m
  );

  await saveCustomMessages(updated);
  return {
    success: true,
    messages: updated,
  };
}

/**
 * Deletes a saved message. If the deleted message was default, falls back to another message.
 */
export async function deleteCustomMessage(
  id: string
): Promise<{ success: boolean; messages: NearuMessage[]; fallbackSelectedId?: string; error?: string }> {
  const currentMessages = await getCustomMessages();
  if (currentMessages.length <= 1) {
    return {
      success: false,
      messages: currentMessages,
      error: 'You must keep at least one saved message.',
    };
  }

  const target = currentMessages.find((m) => m.id === id);
  if (!target) {
    return {
      success: false,
      messages: currentMessages,
      error: 'Message not found.',
    };
  }

  const remaining = currentMessages.filter((m) => m.id !== id);

  // If the deleted message was the default, make the first remaining message default
  let fallbackSelectedId: string | undefined;
  if (target.isDefault && remaining.length > 0) {
    remaining[0].isDefault = true;
    fallbackSelectedId = remaining[0].id;
  } else {
    const currentDefault = remaining.find((m) => m.isDefault);
    if (currentDefault) {
      fallbackSelectedId = currentDefault.id;
    }
  }

  await saveCustomMessages(remaining);

  // If the currently selected message was the deleted one, update selected message ID
  const currentSelectedId = await getSelectedMessageId();
  if (currentSelectedId === id && fallbackSelectedId) {
    await setSelectedMessageId(fallbackSelectedId);
  }

  return {
    success: true,
    messages: remaining,
    fallbackSelectedId,
  };
}

/**
 * Sets one saved message as the designated default.
 */
export async function setDefaultMessage(
  id: string
): Promise<{ success: boolean; messages: NearuMessage[]; error?: string }> {
  const currentMessages = await getCustomMessages();
  const targetExists = currentMessages.some((m) => m.id === id);

  if (!targetExists) {
    return {
      success: false,
      messages: currentMessages,
      error: 'Message not found.',
    };
  }

  const updated = currentMessages.map((m) => ({
    ...m,
    isDefault: m.id === id,
  }));

  await saveCustomMessages(updated);
  return {
    success: true,
    messages: updated,
  };
}

/**
 * Returns the ID of the currently selected message for sending.
 * Falls back safely to the default message if the selection is invalid or missing.
 */
export async function getSelectedMessageId(): Promise<string> {
  const messages = await getCustomMessages();
  const defaultMsg = messages.find((m) => m.isDefault) || messages[0];

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.SELECTED_MESSAGE_ID);
    if (stored && messages.some((m) => m.id === stored)) {
      return stored;
    }
  } catch {
    // ignore
  }

  return defaultMsg ? defaultMsg.id : 'default';
}

export async function setSelectedMessageId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.SELECTED_MESSAGE_ID, id);
  } catch {
    // ignore
  }
}

// ========== Data Reset ==========

export async function clearAllLocalData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.USER_PROFILE,
      STORAGE_KEYS.FRIENDS,
      STORAGE_KEYS.HAS_COMPLETED_ONBOARDING,
      STORAGE_KEYS.NICKNAMES,
      STORAGE_KEYS.DEFAULT_FRIEND_ID,
      STORAGE_KEYS.THEME_PREFERENCE,
      STORAGE_KEYS.CUSTOM_MESSAGES,
      STORAGE_KEYS.SELECTED_MESSAGE_ID,
    ]);
  } catch (error) {
    console.error('[Nearu Storage] Failed to clear local data:', error);
  }
}

