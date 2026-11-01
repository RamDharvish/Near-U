import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Vibration,
  Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../components/Header';
import { NearuIdCard } from '../components/NearuIdCard';
import { IncomingRequestsBar } from '../components/IncomingRequestsBar';
import { FriendsSelector } from '../components/FriendsSelector';
import { NearuButton } from '../components/NearuButton';
import { AddFriendModal } from '../components/AddFriendModal';
import { SettingsModal } from '../components/SettingsModal';
import { ManageFriendModal } from '../components/ManageFriendModal';
import { MessageSelector } from '../components/MessageSelector';
import { ManageMessagesModal } from '../components/ManageMessagesModal';
import { Friend, FriendRequest, UserProfile, NearuEvent, NearuMessage } from '../types';
import {
  saveUserProfile,
  clearAllLocalData,
  updateFriendLastSent,
  getFriends,
  saveFriends,
  getNicknames,
  setNickname as storageSetNickname,
  resolveFriendDisplayName,
  getDefaultFriendId,
  setDefaultFriendId as storageSetDefaultFriendId,
  getCustomMessages,
  getSelectedMessageId,
  setSelectedMessageId as storageSetSelectedMessageId,
  addCustomMessage as storageAddCustomMessage,
  updateCustomMessage as storageUpdateCustomMessage,
  deleteCustomMessage as storageDeleteCustomMessage,
  setDefaultMessage as storageSetDefaultMessage,
  DEFAULT_BUILTIN_MESSAGE,
} from '../services/storage';
import { formatIncomingNearuToast } from '../services/displayName';
import {
  syncUserIdentityWithCloud,
  subscribeToIncomingRequests,
  subscribeToOutgoingRequests,
  subscribeToCloudFriends,
  acceptFriendRequest,
  declineFriendRequest,
  cancelOutgoingRequest,
  sendRealNearuEvent,
  subscribeToNearuEvents,
  EventHandlingResult,
  removeFriend,
  clearAllFriends,
  deleteUserAccount,
} from '../services/pairing';
import { auth, subscribeToAuthChanges } from '../services/firebase';
import * as Notifications from 'expo-notifications';
import { registerPushNotifications } from '../services/notifications';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface MainScreenProps {
  userProfile: UserProfile;
  onResetOnboarding: () => void;
}

export const MainScreen: React.FC<MainScreenProps> = ({
  userProfile,
  onResetOnboarding,
}) => {
  const { colors, resolvedTheme } = useTheme();
  const [profile, setProfile] = useState<UserProfile>(userProfile);
  const [cloudFriends, setCloudFriends] = useState<Friend[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);

  // Custom Nicknames & Default Friend state
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [defaultFriendId, setDefaultFriendIdState] = useState<string | null>(null);

  // Mutable refs for stable subscriptions without listener thrashing
  const cloudFriendsRef = useRef(cloudFriends);
  const nicknamesRef = useRef(nicknames);
  const defaultFriendIdRef = useRef(defaultFriendId);
  // Shared handled event IDs across notification taps and Firestore events
  const handledEventIds = useRef<Set<string>>(new Set());
  // Tracks whether local settings (nicknames, friends) have finished initial disk loading
  const isSettingsLoadedRef = useRef<boolean>(false);

  useEffect(() => {
    cloudFriendsRef.current = cloudFriends;
    nicknamesRef.current = nicknames;
    defaultFriendIdRef.current = defaultFriendId;
  }, [cloudFriends, nicknames, defaultFriendId]);

  // Custom Messages state
  const [customMessages, setCustomMessages] = useState<NearuMessage[]>([]);
  const [selectedMessageId, setSelectedMessageIdState] = useState<string>('default');

  // Sending state and rate-limiting
  const [isSendingNearu, setIsSendingNearu] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // In-app notifications & Toast state
  interface ToastState {
    text: string;
    senderName?: string;
    subtitle?: string;
    icon: keyof typeof Ionicons.glyphMap;
    isIncoming?: boolean;
  }
  const [toastMessage, setToastMessage] = useState<ToastState | null>(null);
  const [toastFadeAnim] = useState(() => new Animated.Value(0));

  // Modals state
  const [isAddFriendVisible, setIsAddFriendVisible] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isManageMessagesVisible, setIsManageMessagesVisible] = useState(false);
  const [managingFriend, setManagingFriend] = useState<Friend | null>(null);

  // Show Toast banner helper
  const showToast = useCallback(
    (
      text: string,
      icon: keyof typeof Ionicons.glyphMap = 'heart',
      isIncoming = false,
      extra?: { senderName?: string; subtitle?: string }
    ) => {
      setToastMessage({
        text,
        icon,
        isIncoming,
        senderName: extra?.senderName,
        subtitle: extra?.subtitle,
      });
      Animated.sequence([
        Animated.timing(toastFadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.delay(3200),
        Animated.timing(toastFadeAnim, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setToastMessage(null);
      });
    },
    [toastFadeAnim]
  );

  // Robust sender name resolution using recipient's friend relationships and custom nicknames
  const resolveSenderName = useCallback(
    async (sender: { fromUid?: string; fromNearuId?: string; fromName?: string }): Promise<string> => {
      let currentNicknames = nicknamesRef.current;
      let currentFriends = cloudFriendsRef.current;

      // Only perform async storage lookups during cold start before loadLocalSettings has completed
      if (!isSettingsLoadedRef.current) {
        try {
          const [savedNicknames, savedFriends] = await Promise.all([
            getNicknames(),
            getFriends(),
          ]);
          if (!currentNicknames || Object.keys(currentNicknames).length === 0) {
            currentNicknames = savedNicknames;
          }
          if (!currentFriends || currentFriends.length === 0) {
            currentFriends = savedFriends;
          }
        } catch {
          // fallback to in-memory state
        }
      }

      return resolveFriendDisplayName(
        {
          uid: sender.fromUid,
          nearuId: sender.fromNearuId,
          name: sender.fromName,
        },
        currentFriends || [],
        currentNicknames || {}
      );
    },
    []
  );

  // Present incoming NearU message toast with prominent sender name and message content
  const showIncomingNearuToast = useCallback(
    (senderName: string, rawMessage?: string, eventType?: string) => {
      const formatted = formatIncomingNearuToast(senderName, rawMessage, eventType);
      showToast(formatted.message, formatted.icon, true, {
        senderName: formatted.senderName,
        subtitle: formatted.subtitle,
      });
    },
    [showToast]
  );

  // Shared notification response handler for both cold-start and warm taps
  const handleNotificationResponse = useCallback(
    async (response: Notifications.NotificationResponse | null) => {
      if (!response?.notification?.request?.content?.data) return;
      const data = response.notification.request.content.data;
      const eventId = data.eventId;

      if (eventId && typeof eventId === 'string') {
        if (handledEventIds.current.has(eventId)) {
          return;
        }
        handledEventIds.current.add(eventId);
      }

      if (data.fromUid) {
        setSelectedFriend((prev) => {
          const friend = cloudFriendsRef.current.find(
            (f) => f.uid === data.fromUid || f.id === data.fromUid
          );
          return friend || prev;
        });
      }

      const senderDisplayName = await resolveSenderName({
        fromUid: typeof data.fromUid === 'string' ? data.fromUid : undefined,
        fromNearuId: typeof data.fromNearuId === 'string' ? data.fromNearuId : undefined,
        fromName: typeof data.fromName === 'string' ? data.fromName : undefined,
      });

      const message = typeof data.message === 'string' ? data.message : undefined;
      const eventType = typeof data.type === 'string' ? data.type : undefined;

      showIncomingNearuToast(senderDisplayName, message, eventType);
    },
    [resolveSenderName, showIncomingNearuToast]
  );

  const [activeUid, setActiveUid] = useState<string | null>(() => {
    return userProfile.uid || auth.currentUser?.uid || null;
  });
  const [isProcessingRequest, setIsProcessingRequest] = useState(false);

  // 1. Initial Load: Load local friends, nicknames, default friend, and sync user identity
  useEffect(() => {
    let isMounted = true;

    const loadLocalSettings = async () => {
      const [savedFriends, savedNicknames, savedDefaultFriendId, savedMessages, savedMessageId] = await Promise.all([
        getFriends(),
        getNicknames(),
        getDefaultFriendId(),
        getCustomMessages(),
        getSelectedMessageId(),
      ]);
      if (isMounted) {
        if (savedFriends && savedFriends.length > 0) {
          setCloudFriends(savedFriends);
          setSelectedFriend((prev) => {
            if (prev) return prev;
            if (savedDefaultFriendId) {
              const matched = savedFriends.find((f) => f.uid === savedDefaultFriendId || f.id === savedDefaultFriendId);
              if (matched) return matched;
            }
            return savedFriends[0];
          });
        }
        setNicknames(savedNicknames);
        setDefaultFriendIdState(savedDefaultFriendId);
        setCustomMessages(savedMessages);
        setSelectedMessageIdState(savedMessageId);
        isSettingsLoadedRef.current = true;
      }

      // Synchronize user profile with Cloud Firestore in background
      try {
        const synced = await syncUserIdentityWithCloud(userProfile.name, userProfile.id);
        if (isMounted) {
          setProfile(synced);
        }
      } catch (err) {
        console.info('[Nearu] Background cloud sync note:', err);
      }
    };

    loadLocalSettings();

    return () => {
      isMounted = false;
    };
  }, [userProfile.id, userProfile.name]);

  // Sync profile.uid and activeUid when Firebase Auth initializes or changes
  useEffect(() => {
    const unsub = subscribeToAuthChanges((user) => {
      if (user) {
        setActiveUid(user.uid);
        if (!profile.uid || profile.uid !== user.uid) {
          const updated = { ...profile, uid: user.uid };
          setProfile(updated);
          saveUserProfile(updated).catch(() => {});
        }
      }
    });
    return () => unsub();
  }, [profile]);

  // 2. Real-time Firebase subscriptions
  useEffect(() => {
    let isMounted = true;
    const currentUid = activeUid || profile.uid || auth.currentUser?.uid;
    if (!currentUid) return;

    // A. Subscribe to incoming friend requests
    const unsubIncoming = subscribeToIncomingRequests(currentUid, (reqs) => {
      setIncomingRequests(reqs);
    });

    // B. Subscribe to outgoing friend requests
    const unsubOutgoing = subscribeToOutgoingRequests(currentUid, (reqs) => {
      setOutgoingRequests(reqs);
    });

    // C. Subscribe to accepted mutual cloud friends
    const unsubFriends = subscribeToCloudFriends(currentUid, (cFriends) => {
      setCloudFriends(cFriends);
      saveFriends(cFriends).catch(() => {});

      // Auto-select friend logic:
      // Priority 1: Default Friend if set and present
      // Priority 2: Currently selected friend if still in list
      // Priority 3: First available friend
      setSelectedFriend((prev) => {
        const currentDefault = defaultFriendIdRef.current;
        if (currentDefault) {
          const matchDefault = cFriends.find(
            (f) => f.uid === currentDefault || f.id === currentDefault
          );
          if (matchDefault) {
            return matchDefault;
          } else if (cFriends.length > 0) {
            // Default friend is no longer in list; safely clear invalid selection
            storageSetDefaultFriendId(null);
            setDefaultFriendIdState(null);
          }
        }
        if (prev) {
          const stillExists = cFriends.find(
            (f) => f.id === prev.id || f.uid === prev.uid
          );
          if (stillExists) return stillExists;
        }
        return cFriends.length > 0 ? cFriends[0] : null;
      });
    });

    let unsubEvents: (() => void) | null = null;
    let notificationResponseSub: Notifications.Subscription | null = null;

    // D. Register push notification token & configure notification channels
    registerPushNotifications(currentUid);

    // E. Sequential initialization: resolve cold-start tap, attach warm tap, then attach Firestore listener
    const initEventHandling = async () => {
      // 1. Resolve cold-start notification response BEFORE attaching Firestore listener
      try {
        const coldResponse = await Notifications.getLastNotificationResponseAsync();
        if (coldResponse && isMounted) {
          handleNotificationResponse(coldResponse);
        }
      } catch (err) {
        console.warn('[NearU Notifications] Cold-start notification check note:', err);
      }

      if (!isMounted) return;

      // 2. Listen for warm notification taps (using exact same deduplication logic)
      notificationResponseSub = Notifications.addNotificationResponseReceivedListener((response) => {
        if (isMounted) {
          handleNotificationResponse(response);
        }
      });

      // 3. Attach Firestore listener ONLY after cold-start check has completed
      unsubEvents = subscribeToNearuEvents(
        currentUid,
        async (event: NearuEvent, { isInitialSnapshot }): Promise<EventHandlingResult> => {
          if (!isMounted) {
            return 'retry'; // Component unmounted, retain document in Firestore for next mount
          }

          // A. If already handled by cold-start or warm notification tap, mark handled and suppress
          if (handledEventIds.current.has(event.id)) {
            return 'handled';
          }

          // B. Initial snapshot handling (event arrived while app was closed / prior to launch)
          if (isInitialSnapshot) {
            let isPresentInTray = false;
            try {
              const presented = await Notifications.getPresentedNotificationsAsync();
              isPresentInTray = presented.some(
                (n) => n.request?.content?.data?.eventId === event.id
              );
            } catch (trayErr) {
              console.warn('[NearU Notifications] Presented notifications query note:', trayErr);
            }

            if (!isMounted) {
              return 'retry';
            }

            if (isPresentInTray) {
              // Notification is already sitting in Android tray; suppress duplicate in-app toast and vibration
              handledEventIds.current.add(event.id);
              return 'handled';
            }

            // Silent Catch-Up (Push delivery failed, delayed, or dismissed):
            // Show visual toast so message is not lost, but NEVER vibrate!
            handledEventIds.current.add(event.id);
            const senderDisplayName = await resolveSenderName({
              fromUid: event.fromUid,
              fromNearuId: event.fromNearuId,
              fromName: event.fromName,
            });

            showIncomingNearuToast(senderDisplayName, event.message, event.type);
            return 'handled';
          }

          // C. Live Foreground Event (arrived in real-time while app is open and active)
          handledEventIds.current.add(event.id);

          try {
            if (event.type === 'long_press') {
              Vibration.vibrate([0, 800, 200, 800, 200, 800, 200, 800, 200, 800]);
            } else {
              Vibration.vibrate([0, 450, 150, 450]);
            }
          } catch (vibErr) {
            console.warn('[Nearu Vibration] Hardware vibration note:', vibErr);
          }

          const senderDisplayName = await resolveSenderName({
            fromUid: event.fromUid,
            fromNearuId: event.fromNearuId,
            fromName: event.fromName,
          });

          showIncomingNearuToast(senderDisplayName, event.message, event.type);
          return 'handled';
        }
      );
    };

    initEventHandling();

    return () => {
      isMounted = false;
      unsubIncoming();
      unsubOutgoing();
      unsubFriends();
      if (unsubEvents) unsubEvents();
      if (notificationResponseSub) notificationResponseSub.remove();
    };
  }, [activeUid, profile.uid, showIncomingNearuToast, resolveSenderName, handleNotificationResponse]);

  // Handle Cooldown Timer countdown
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setCooldownRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  const handleSelectFriend = (friend: Friend) => {
    setSelectedFriend(friend);
  };

  const handleAcceptRequest = async (req: FriendRequest) => {
    if (isProcessingRequest) return;
    setIsProcessingRequest(true);
    try {
      // Optimistic update: instantly remove from incoming requests list
      setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id));

      await acceptFriendRequest(req);
      showToast(`Accepted ${req.fromName || 'friend'}! 💙`, 'checkmark-circle');
    } catch (err: unknown) {
      console.error('[Nearu] Accept request failed:', err);
      const errMsg = err instanceof Error ? err.message : 'Could not accept friend request. Please check connection.';
      showToast(errMsg, 'alert-circle');
    } finally {
      setIsProcessingRequest(false);
    }
  };

  const handleDeclineRequest = async (req: FriendRequest) => {
    try {
      setIncomingRequests((prev) => prev.filter((r) => r.id !== req.id));
      await declineFriendRequest(req);
      showToast('Request declined', 'close-circle');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Could not decline request.';
      showToast(errMsg, 'alert-circle');
    }
  };

  const handleCancelOutgoing = async (reqId: string) => {
    try {
      setOutgoingRequests((prev) => prev.filter((r) => r.id !== reqId));
      await cancelOutgoingRequest(reqId);
      showToast('Request cancelled', 'checkmark-circle');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Could not cancel request.';
      showToast(errMsg, 'alert-circle');
    }
  };

  // Custom Messages handlers
  const handleSelectMessage = async (msg: NearuMessage) => {
    setSelectedMessageIdState(msg.id);
    await storageSetSelectedMessageId(msg.id);
  };

  const handleAddCustomMessage = async (text: string) => {
    const result = await storageAddCustomMessage(text);
    if (result.success) {
      setCustomMessages(result.messages);
      if (result.newId) {
        setSelectedMessageIdState(result.newId);
        await storageSetSelectedMessageId(result.newId);
      }
      showToast('Custom message saved ✨', 'chatbubble');
      return { success: true };
    }
    return { success: false, error: result.error };
  };

  const handleUpdateCustomMessage = async (id: string, text: string) => {
    const result = await storageUpdateCustomMessage(id, text);
    if (result.success) {
      setCustomMessages(result.messages);
      showToast('Message updated ✍️', 'checkmark-circle');
      return { success: true };
    }
    return { success: false, error: result.error };
  };

  const handleDeleteCustomMessage = async (id: string) => {
    const result = await storageDeleteCustomMessage(id);
    if (result.success) {
      setCustomMessages(result.messages);
      if (result.fallbackSelectedId && selectedMessageId === id) {
        setSelectedMessageIdState(result.fallbackSelectedId);
      }
      showToast('Message removed', 'trash');
      return { success: true };
    }
    return { success: false, error: result.error };
  };

  const handleSetDefaultMessage = async (id: string) => {
    const result = await storageSetDefaultMessage(id);
    if (result.success) {
      setCustomMessages(result.messages);
      showToast('Designated as default message ⭐', 'star');
      return { success: true };
    }
    return { success: false, error: result.error };
  };

  // SEND REAL NEARU ACTION (supports normal tap and deliberate long press)
  const handlePressNearu = async (target: Friend, isLongPress: boolean = false) => {
    if (!target) return;
    const targetUid = target.uid || target.id;
    const targetDisplayName = resolveFriendDisplayName(target, cloudFriends, nicknames);

    // Pick currently selected message
    const activeMsg =
      customMessages.find((m) => m.id === selectedMessageId) ||
      customMessages.find((m) => m.isDefault) ||
      customMessages[0];
    const messageToSend = activeMsg?.text || DEFAULT_BUILTIN_MESSAGE;

    setIsSendingNearu(true);
    try {
      const eventType = isLongPress ? 'long_press' : 'standard';
      const result = await sendRealNearuEvent(targetUid, profile, eventType, messageToSend);

      if (result.success) {
        // Start cooldown
        setCooldownRemaining(5);
        await updateFriendLastSent(target.id);
        // Small, truthful confirmation to sender only after delivery acceptance
        if (isLongPress) {
          showToast(`Special NearU sent to ${targetDisplayName}! 💙`, 'paper-plane');
        } else {
          showToast(`NearU sent to ${targetDisplayName}! ✨`, 'paper-plane');
        }
      } else {
        if (result.cooldownRemaining) {
          setCooldownRemaining(result.cooldownRemaining);
        }
        showToast(result.message, 'alert-circle');
      }
    } catch {
      showToast('Could not deliver NearU. Check connection.', 'alert-circle');
    } finally {
      setIsSendingNearu(false);
    }
  };

  const handleUpdateName = async (newName: string) => {
    const updated = { ...profile, name: newName };
    await saveUserProfile(updated);
    setProfile(updated);
    try {
      await syncUserIdentityWithCloud(newName, profile.id);
    } catch {
      // ignore
    }
  };

  const handleClearFriends = async () => {
    const res = await clearAllFriends();
    setCloudFriends([]);
    setSelectedFriend(null);
    if (res.success) {
      showToast(res.clearedCount > 0 ? `Cleared ${res.clearedCount} friend(s)` : 'Friends list cleared', 'trash-outline');
    } else {
      showToast(res.message || 'Error clearing some friends', 'alert-circle');
    }
  };

  const handleRemoveFriend = async (friendUid: string) => {
    const res = await removeFriend(friendUid);
    if (res.success) {
      setCloudFriends((prev) => prev.filter((f) => (f.uid || f.id) !== friendUid));
      if (selectedFriend && (selectedFriend.uid === friendUid || selectedFriend.id === friendUid)) {
        const remaining = cloudFriends.filter((f) => (f.uid || f.id) !== friendUid);
        setSelectedFriend(remaining.length > 0 ? remaining[0] : null);
      }
      showToast('Friend removed', 'trash-outline');
    } else {
      showToast(res.message || 'Failed to remove friend', 'alert-circle');
    }
  };

  const handleDeleteAccount = async () => {
    const res = await deleteUserAccount();
    if (res.success) {
      showToast('Account permanently deleted', 'checkmark-circle');
      onResetOnboarding();
    } else {
      showToast(res.message || 'Failed to delete account', 'alert-circle');
    }
  };

  const handleResetOnboarding = async () => {
    await clearAllLocalData();
    onResetOnboarding();
  };

  // Nickname management
  const handleSaveNickname = async (friendUid: string, nickname: string) => {
    const updated = await storageSetNickname(friendUid, nickname);
    setNicknames(updated);
  };

  // Default Friend management
  const handleToggleDefaultFriend = async (friendUid: string) => {
    const isCurrent = defaultFriendId === friendUid;
    const newDefault = isCurrent ? null : friendUid;
    await storageSetDefaultFriendId(newDefault);
    setDefaultFriendIdState(newDefault);
    if (!isCurrent) {
      showToast('Marked as default friend ⭐', 'star');
    }
  };

  const selectedFriendNickname = selectedFriend
    ? nicknames[selectedFriend.uid || ''] ||
      nicknames[selectedFriend.id || ''] ||
      nicknames[selectedFriend.nearuId || '']
    : undefined;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />

      {/* Floating Truthful Toast Banner */}
      {toastMessage ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            toastMessage.isIncoming
              ? [styles.toastIncoming, { backgroundColor: colors.primary }]
              : [styles.toastStandard, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderHighlight }],
            { opacity: toastFadeAnim },
          ]}
        >
          <Ionicons
            name={toastMessage.icon}
            size={toastMessage.senderName ? 20 : 18}
            color={toastMessage.isIncoming ? '#FFFFFF' : colors.primary}
            style={toastMessage.senderName ? styles.toastIconIncoming : undefined}
          />
          {toastMessage.senderName ? (
            <View style={styles.toastContentContainer}>
              <Text style={styles.toastSenderName} numberOfLines={1}>
                {toastMessage.senderName}
              </Text>
              {toastMessage.subtitle ? (
                <Text style={styles.toastSubtitle} numberOfLines={1}>
                  {toastMessage.subtitle}
                </Text>
              ) : null}
              <Text style={styles.toastMessageText} numberOfLines={2}>
                {toastMessage.text}
              </Text>
            </View>
          ) : (
            <Text
              style={[
                styles.toastText,
                { color: toastMessage.isIncoming ? '#FFFFFF' : colors.text },
              ]}
            >
              {toastMessage.text}
            </Text>
          )}
        </Animated.View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Header
          userName={profile.name}
          onOpenSettings={() => setIsSettingsVisible(true)}
        />

        {/* My Nearu ID Card */}
        <NearuIdCard nearuId={profile.id} />

        {/* Real-time Friend Requests Bar */}
        <IncomingRequestsBar
          incomingRequests={incomingRequests}
          outgoingRequests={outgoingRequests}
          onAccept={handleAcceptRequest}
          onDecline={handleDeclineRequest}
          onCancelOutgoing={handleCancelOutgoing}
        />

        {/* Friends Selector Section */}
        <FriendsSelector
          friends={cloudFriends}
          selectedFriendId={selectedFriend?.id || null}
          nicknames={nicknames}
          defaultFriendId={defaultFriendId}
          onSelectFriend={handleSelectFriend}
          onAddFriendPress={() => setIsAddFriendVisible(true)}
          onManageFriend={(friend) => setManagingFriend(friend)}
        />

        {/* Compact Customizable Message Selector */}
        <MessageSelector
          messages={customMessages}
          selectedMessageId={selectedMessageId}
          onSelectMessage={handleSelectMessage}
          onOpenManageMessages={() => setIsManageMessagesVisible(true)}
        />

        {/* Centerpiece Nearu Action Button */}
        <NearuButton
          selectedFriend={selectedFriend}
          friendNickname={selectedFriendNickname}
          onPressNearu={handlePressNearu}
          disabled={!selectedFriend}
          isSending={isSendingNearu}
          cooldownRemaining={cooldownRemaining}
        />
      </ScrollView>

      {/* Add Friend Dialog (Nearu ID Resolver) */}
      <AddFriendModal
        visible={isAddFriendVisible}
        userProfile={profile}
        onClose={() => setIsAddFriendVisible(false)}
      />

      {/* Manage Friend (Nickname & Default) Dialog */}
      <ManageFriendModal
        visible={!!managingFriend}
        friend={managingFriend}
        currentNickname={
          managingFriend
            ? nicknames[managingFriend.uid || ''] ||
              nicknames[managingFriend.id || ''] ||
              nicknames[managingFriend.nearuId || '']
            : undefined
        }
        isDefault={
          !!managingFriend &&
          (managingFriend.uid === defaultFriendId || managingFriend.id === defaultFriendId)
        }
        onClose={() => setManagingFriend(null)}
        onSaveNickname={handleSaveNickname}
        onToggleDefault={handleToggleDefaultFriend}
        onRemoveFriend={handleRemoveFriend}
      />

      {/* Manage Messages Dialog */}
      <ManageMessagesModal
        visible={isManageMessagesVisible}
        messages={customMessages}
        onClose={() => setIsManageMessagesVisible(false)}
        onAddMessage={handleAddCustomMessage}
        onUpdateMessage={handleUpdateCustomMessage}
        onDeleteMessage={handleDeleteCustomMessage}
        onSetDefaultMessage={handleSetDefaultMessage}
      />

      {/* Settings / Profile Dialog */}
      <SettingsModal
        visible={isSettingsVisible}
        profile={profile}
        onClose={() => setIsSettingsVisible(false)}
        onUpdateName={handleUpdateName}
        onClearFriends={handleClearFriends}
        onResetOnboarding={handleResetOnboarding}
        onDeleteAccount={handleDeleteAccount}
        onOpenManageMessages={() => setIsManageMessagesVisible(true)}
        customMessagesCount={customMessages.filter((m) => !m.isDefault).length}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  toastContainer: {
    position: 'absolute',
    top: 55,
    left: 20,
    right: 20,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    borderRadius: RADIUS.lg,
    gap: 8,
    ...SHADOWS.md,
  },
  toastStandard: {
    borderWidth: 1.5,
  },
  toastIncoming: {
    ...SHADOWS.lg,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  toastIconIncoming: {
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  toastContentContainer: {
    flex: 1,
    gap: 1,
  },
  toastSenderName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  toastSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.92)',
  },
  toastMessageText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 18,
  },
});
