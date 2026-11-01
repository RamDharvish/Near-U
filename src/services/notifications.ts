import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { EAS_CONFIG } from '../constants/config';

export const NOTIFICATION_CHANNELS = {
  STANDARD: 'standard_nearu',
  LONG_PRESS: 'long_press_nearu',
} as const;

// Configure how foreground notifications are handled
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Initializes Android notification channels with distinct vibration patterns.
 * Standard channel: double pulse
 * Long-press channel: ~5-second sustained vibration pattern
 */
export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    // 1. Standard message channel
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.STANDARD, {
      name: 'Near-U Messages',
      description: 'Standard Near-U messages from friends',
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 450, 150, 450],
      enableVibrate: true,
      sound: 'default',
      lightColor: '#7958CF',
    });

    // 2. Long-press message channel (5 pulses totaling ~4.8-5 seconds)
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.LONG_PRESS, {
      name: 'Near-U Long-Press Messages',
      description: 'Special long-press Near-U messages with sustained vibration',
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 800, 200, 800, 200, 800, 200, 800, 200, 800],
      enableVibrate: true,
      sound: 'default',
      lightColor: '#7958CF',
    });
  } catch (err) {
    console.warn('[Near-U Notifications] Channel setup error:', err);
  }
}

/**
 * Requests notification permission from user and registers the Expo push token in Firestore.
 * Tokens are stored securely under `users/{uid}/fcm_tokens/{tokenId}` and `users/{uid}/expo_push_tokens/{tokenId}`
 * where only the authenticated owner has read/write access.
 */
export async function registerPushNotifications(currentUid: string): Promise<string | null> {
  try {
    // 1. Setup notification channels first (required on Android 13+ before permission prompt)
    await setupNotificationChannels();

    // 2. Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.info('[NearU Notifications] User declined push notification permissions.');
      return null;
    }

    // 3. Obtain Expo Push Token using configured EAS project ID
    let expoPushToken: string | null = null;
    try {
      const tokenResponse = await Notifications.getExpoPushTokenAsync({
        projectId: EAS_CONFIG.projectId,
      });
      expoPushToken = tokenResponse.data;
    } catch (tokenErr) {
      console.warn('[NearU Notifications] Could not obtain Expo push token directly:', tokenErr);
    }

    if (!expoPushToken) {
      return null;
    }

    const tokenString = expoPushToken;

    // 4. Securely associate token with authenticated user in private subcollections
    // Safe ID key for firestore document
    const safeDocId = tokenString.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-60);

    const tokenData = {
      token: tokenString,
      type: 'expo',
      platform: Platform.OS,
      updatedAt: serverTimestamp(),
    };

    // Save to fcm_tokens (allowed in existing deployed rules)
    const fcmDocRef = doc(db, 'users', currentUid, 'fcm_tokens', safeDocId);
    await setDoc(fcmDocRef, tokenData, { merge: true });

    // Also attempt saving to expo_push_tokens
    try {
      const expoDocRef = doc(db, 'users', currentUid, 'expo_push_tokens', safeDocId);
      await setDoc(expoDocRef, tokenData, { merge: true });
    } catch (e) {
      // Non-fatal if expo_push_tokens subcollection rules are pending deployment
      console.info('[NearU Notifications] expo_push_tokens write note:', e);
    }

    return tokenString;
  } catch (err) {
    console.warn('[NearU Notifications] Error during push notification registration:', err);
    return null;
  }
}

/**
 * Removes the device push token on logout or session reset so notifications are not delivered to old accounts.
 */
export async function unregisterPushToken(currentUid: string, tokenString: string): Promise<void> {
  if (!currentUid || !tokenString) return;
  try {
    const safeDocId = tokenString.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-60);
    const fcmDocRef = doc(db, 'users', currentUid, 'fcm_tokens', safeDocId);
    await deleteDoc(fcmDocRef).catch(() => {});

    const expoDocRef = doc(db, 'users', currentUid, 'expo_push_tokens', safeDocId);
    await deleteDoc(expoDocRef).catch(() => {});
  } catch (err) {
    console.warn('[NearU Notifications] Error unregistering token:', err);
  }
}

