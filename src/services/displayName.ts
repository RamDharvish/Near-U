import type { Friend } from '../types';

export type NicknameMap = Record<string, string>;

export interface SenderIdentity {
  uid?: string;
  fromUid?: string;
  nearuId?: string;
  fromNearuId?: string;
  name?: string;
  fromName?: string;
  message?: string;
  eventId?: string;
  type?: string;
}

export interface IncomingNearuToastData {
  senderName: string;
  subtitle?: string;
  message: string;
  icon: 'heart';
}

/**
 * Resolves the display name for a friend or incoming message sender.
 * 1. Checks if the recipient assigned a custom nickname to the sender (by UID or NearU ID).
 * 2. Matches sender against recipient's accepted friend list and checks if a nickname is set.
 * 3. Falls back to friend.nickname stored on the friend record before friend.name.
 * 4. Falls back to friend's profile name (friend.name).
 * 5. Falls back to sender's transmitted profile name (fromName / name).
 * 6. Falls back to 'Someone'.
 * Nicknames stored in the recipient's nickname map always take precedence.
 * Does not modify any user's profile name or foreign nickname data.
 */
export function resolveFriendDisplayName(
  sender?: SenderIdentity | null,
  friends: Friend[] = [],
  nicknames: NicknameMap = {}
): string {
  if (!sender) return 'Someone';

  const senderUid = (sender.fromUid || sender.uid)?.trim();
  const senderNearuId = (sender.fromNearuId || sender.nearuId)?.trim();
  const senderName = (sender.fromName || sender.name)?.trim();

  // 1. Direct nickname lookup by sender UID in recipient's nickname map
  if (senderUid && nicknames[senderUid]?.trim()) {
    return nicknames[senderUid].trim();
  }

  // 2. Direct nickname lookup by sender NearU ID in recipient's nickname map
  if (senderNearuId && nicknames[senderNearuId]?.trim()) {
    return nicknames[senderNearuId].trim();
  }

  // 3. Match sender against recipient's accepted friend list
  const matchedFriend = friends.find((f) => {
    if (senderUid && (f.uid === senderUid || f.id === senderUid)) return true;
    if (senderNearuId && (f.nearuId === senderNearuId || f.id === senderNearuId || f.uid === senderNearuId)) return true;
    return false;
  });

  if (matchedFriend) {
    // Recipient's nickname map takes precedence over embedded friend.nickname
    if (matchedFriend.uid && nicknames[matchedFriend.uid]?.trim()) {
      return nicknames[matchedFriend.uid].trim();
    }
    if (matchedFriend.id && nicknames[matchedFriend.id]?.trim()) {
      return nicknames[matchedFriend.id].trim();
    }
    if (matchedFriend.nearuId && nicknames[matchedFriend.nearuId]?.trim()) {
      return nicknames[matchedFriend.nearuId].trim();
    }
    // Fallback to friend.nickname if stored on friend record
    if (matchedFriend.nickname?.trim()) {
      return matchedFriend.nickname.trim();
    }
    // Fallback to friend's profile name
    if (matchedFriend.name?.trim()) {
      return matchedFriend.name.trim();
    }
  }

  // 4. Fallback to sender's profile name from event or request
  if (senderName) {
    return senderName;
  }

  return 'Someone';
}

/**
 * Formats incoming NearU message toast data:
 * - Default NearU message: "Thinking of you 💙" without redundant subtitle.
 * - Long-press NearU: "Misses you so much! 💙".
 * - Custom message: sender name, "Thinking of you" (or "Misses you so much!") subtitle, and quoted text.
 */
export function formatIncomingNearuToast(
  senderName: string,
  rawMessage?: string,
  eventType?: string
): IncomingNearuToastData {
  const cleanMessage = (rawMessage || '').trim();
  const isLongPress = eventType === 'long_press';
  const isDefaultMessage =
    !cleanMessage ||
    cleanMessage === 'Thinking of you 💙' ||
    cleanMessage === 'Thinking of you' ||
    cleanMessage === 'Thinking of you!';

  if (isDefaultMessage) {
    return {
      senderName,
      subtitle: undefined,
      message: isLongPress ? 'Misses you so much! 💙' : 'Thinking of you 💙',
      icon: 'heart',
    };
  }

  const formattedQuote =
    cleanMessage.startsWith('"') || cleanMessage.startsWith('“')
      ? cleanMessage
      : `"${cleanMessage}"`;

  return {
    senderName,
    subtitle: isLongPress ? 'Misses you so much!' : 'Thinking of you',
    message: formattedQuote,
    icon: 'heart',
  };
}
