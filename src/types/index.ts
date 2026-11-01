export interface UserProfile {
  id: string; // e.g. "NEARU-7K29" (The Nearu ID)
  uid?: string; // Firebase Auth UID
  name: string;
  createdAt: number;
}

export interface Friend {
  id: string; // e.g. "NEARU-3M8X" or UID
  name: string;
  avatarColor: string;
  nickname?: string;
  relationshipTag?: string;
  lastNearuSentAt?: number;
  isSample?: boolean;
  uid?: string;
  nearuId?: string;
  pairedAt?: number;
}

export interface FriendRequest {
  id: string; // `${fromUid}_${toUid}`
  fromUid: string;
  toUid: string;
  fromNearuId: string;
  toNearuId: string;
  fromName: string;
  toName: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
  updatedAt?: number;
}

export interface CustomMessage {
  id: string; // e.g. 'default' or unique id
  text: string;
  isDefault: boolean;
  createdAt: number;
}

export type NearuMessage = CustomMessage;

export interface NearuEvent {
  id: string;
  fromUid: string;
  fromNearuId: string;
  fromName: string;
  toUid: string;
  timestamp: number;
  type?: 'standard' | 'long_press' | 'nudge' | string;
  message?: string;
}
