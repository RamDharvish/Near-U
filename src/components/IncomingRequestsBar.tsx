import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FriendRequest } from '../types';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface IncomingRequestsBarProps {
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  onAccept: (request: FriendRequest) => Promise<void>;
  onDecline: (request: FriendRequest) => Promise<void>;
  onCancelOutgoing: (requestId: string) => Promise<void>;
}

export const IncomingRequestsBar: React.FC<IncomingRequestsBarProps> = ({
  incomingRequests,
  outgoingRequests,
  onAccept,
  onDecline,
  onCancelOutgoing,
}) => {
  const { colors } = useTheme();
  const [processingId, setProcessingId] = useState<string | null>(null);

  if (incomingRequests.length === 0 && outgoingRequests.length === 0) {
    return null;
  }

  const handleAccept = async (req: FriendRequest) => {
    setProcessingId(req.id);
    try {
      await onAccept(req);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // ignore
      }
    } catch (err) {
      console.warn('Accept error:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (req: FriendRequest) => {
    setProcessingId(req.id);
    try {
      await onDecline(req);
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // ignore
      }
    } catch (err) {
      console.warn('Decline error:', err);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <View style={styles.container}>
      {/* Incoming Requests */}
      {incomingRequests.map((req) => {
        const isProcessing = processingId === req.id;
        const initials = req.fromName
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .substring(0, 2);

        return (
          <View
            key={req.id}
            style={[
              styles.requestCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.primaryLight,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.avatarMini,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text style={styles.avatarMiniText}>{initials}</Text>
              </View>

              <View style={styles.requestInfo}>
                <View style={styles.nameRow}>
                  <Text style={[styles.fromName, { color: colors.primaryDark }]}>
                    {req.fromName}
                  </Text>
                  <View
                    style={[
                      styles.idBadge,
                      { backgroundColor: colors.primaryGhost },
                    ]}
                  >
                    <Text style={[styles.idBadgeText, { color: colors.primary }]}>
                      {req.fromNearuId}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.promptText, { color: colors.textSecondary }]}>
                  wants to connect with you on Nearu
                </Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.declineButton,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                  isProcessing && styles.btnDisabled,
                ]}
                onPress={() => handleDecline(req)}
                activeOpacity={0.7}
                disabled={isProcessing}
                accessibilityRole="button"
                accessibilityLabel={`Decline friend request from ${req.fromName}`}
              >
                <Ionicons name="close" size={16} color={colors.textSecondary} />
                <Text style={[styles.declineButtonText, { color: colors.textSecondary }]}>
                  Decline
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.acceptButton,
                  { backgroundColor: colors.primary },
                  isProcessing && styles.btnDisabled,
                ]}
                onPress={() => handleAccept(req)}
                activeOpacity={0.8}
                disabled={isProcessing}
                accessibilityRole="button"
                accessibilityLabel={`Accept friend request from ${req.fromName}`}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color={colors.surface} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color={colors.surface} />
                    <Text style={[styles.acceptButtonText, { color: colors.surface }]}>
                      Accept
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* Outgoing Requests (Subtle pill) */}
      {outgoingRequests.map((req) => (
        <View
          key={req.id}
          style={[
            styles.outgoingCard,
            {
              backgroundColor: colors.primaryGhost,
              borderColor: colors.borderHighlight,
            },
          ]}
        >
          <Ionicons name="time-outline" size={14} color={colors.primary} />
          <Text
            style={[styles.outgoingText, { color: colors.primaryDark }]}
            numberOfLines={1}
          >
            Waiting for <Text style={{ fontWeight: '700' }}>{req.toName}</Text> ({req.toNearuId})
          </Text>
          <TouchableOpacity
            style={styles.cancelOutgoingBtn}
            onPress={() => onCancelOutgoing(req.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.cancelOutgoingText, { color: colors.textMuted }]}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: SPACING.md,
    marginVertical: SPACING.xs,
    gap: SPACING.xs + 2,
  },
  requestCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    ...SHADOWS.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  avatarMini: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  avatarMiniText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  requestInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fromName: {
    fontSize: 15,
    fontWeight: '700',
  },
  idBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: RADIUS.full,
  },
  idBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  promptText: {
    fontSize: 12,
    marginTop: 1,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
  declineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  declineButtonText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
    ...SHADOWS.sm,
  },
  acceptButtonText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 4,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  outgoingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.sm + 4,
    borderWidth: 1,
  },
  outgoingText: {
    fontSize: 12,
    flex: 1,
    marginLeft: 6,
  },
  cancelOutgoingBtn: {
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  cancelOutgoingText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
