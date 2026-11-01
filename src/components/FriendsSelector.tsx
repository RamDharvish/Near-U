import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Friend } from '../types';
import { resolveFriendDisplayName } from '../services/storage';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface FriendsSelectorProps {
  friends: Friend[];
  selectedFriendId: string | null;
  nicknames?: Record<string, string>;
  defaultFriendId?: string | null;
  onSelectFriend: (friend: Friend) => void;
  onAddFriendPress: () => void;
  onManageFriend?: (friend: Friend) => void;
}

export const FriendsSelector: React.FC<FriendsSelectorProps> = ({
  friends,
  selectedFriendId,
  nicknames = {},
  defaultFriendId = null,
  onSelectFriend,
  onAddFriendPress,
  onManageFriend,
}) => {
  const { colors } = useTheme();

  if (friends.length === 0) {
    return (
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Friends</Text>
        </View>

        <View
          style={[
            styles.emptyCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.emptyIconContainer,
              { backgroundColor: colors.primaryGhost },
            ]}
          >
            <Ionicons name="people-outline" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.primaryDark }]}>
            No friends connected yet
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Share your Nearu ID or enter a friend&apos;s ID to exchange gentle, silent reminders.
          </Text>
          <TouchableOpacity
            style={[styles.emptyAddButton, { backgroundColor: colors.primary }]}
            onPress={onAddFriendPress}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Add your first friend"
          >
            <Ionicons name="person-add-outline" size={16} color={colors.surface} />
            <Text style={[styles.emptyAddButtonText, { color: colors.surface }]}>
              Add a Friend
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.sectionContainer}>
      <View style={styles.sectionHeader}>
        <View style={styles.titleWithCount}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Friends</Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.primarySurface },
            ]}
          >
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              {friends.length}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.addTextButton}
          onPress={onAddFriendPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Add friend"
        >
          <Ionicons name="add-circle" size={18} color={colors.primary} />
          <Text style={[styles.addTextButtonLabel, { color: colors.primary }]}>
            Add Friend
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {friends.map((friend) => {
          const friendUid = friend.uid || friend.id;
          const isSelected = friend.id === selectedFriendId || friend.uid === selectedFriendId;
          const isDefault = friendUid === defaultFriendId || friend.id === defaultFriendId;
          const displayName = resolveFriendDisplayName(friend, friends, nicknames);
          const initials = displayName
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);

          return (
            <TouchableOpacity
              key={friend.id}
              style={[
                styles.friendCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
                isSelected && {
                  backgroundColor: colors.primaryGhost,
                  ...SHADOWS.md,
                },
              ]}
              onPress={() => onSelectFriend(friend)}
              onLongPress={() => onManageFriend && onManageFriend(friend)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Select friend ${displayName}`}
              accessibilityState={{ selected: isSelected }}
            >
              {/* Default Friend Star Badge */}
              {isDefault ? (
                <View style={styles.defaultStarBadge}>
                  <Ionicons name="star" size={12} color="#F5A623" />
                </View>
              ) : null}

              {/* Manage Friend (3 dots) button */}
              {onManageFriend ? (
                <TouchableOpacity
                  style={styles.manageIconBtn}
                  onPress={() => onManageFriend(friend)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Manage settings for ${displayName}`}
                >
                  <Ionicons name="ellipsis-vertical" size={12} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}

              <View
                style={[
                  styles.avatar,
                  { backgroundColor: friend.avatarColor || colors.primary },
                  isSelected && [styles.avatarSelected, { borderColor: colors.surface }],
                ]}
              >
                <Text style={styles.avatarInitials}>{initials}</Text>
                {isSelected && (
                  <View
                    style={[
                      styles.selectedCheckBadge,
                      {
                        backgroundColor: colors.primary,
                        borderColor: colors.surface,
                      },
                    ]}
                  >
                    <Ionicons name="checkmark" size={10} color={colors.surface} />
                  </View>
                )}
              </View>

              <Text
                style={[
                  styles.friendName,
                  { color: colors.text },
                  isSelected && [styles.friendNameSelected, { color: colors.primaryDark }],
                ]}
                numberOfLines={1}
              >
                {displayName}
              </Text>

              <Text
                style={[
                  styles.friendTag,
                  { color: isDefault ? '#F5A623' : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {isDefault ? 'Default' : friend.relationshipTag || 'Friend'}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Quick Add Card */}
        <TouchableOpacity
          style={[
            styles.quickAddCard,
            {
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
          onPress={onAddFriendPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Add another friend"
        >
          <View
            style={[
              styles.quickAddCircle,
              { backgroundColor: colors.primaryGhost },
            ]}
          >
            <Ionicons name="add" size={24} color={colors.primary} />
          </View>
          <Text style={[styles.quickAddText, { color: colors.primary }]}>
            Add Friend
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  sectionContainer: {
    marginVertical: SPACING.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs + 2,
  },
  titleWithCount: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    marginLeft: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addTextButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addTextButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    gap: SPACING.sm + 2,
  },
  friendCard: {
    width: 102,
    alignItems: 'center',
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.xs + 2,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    position: 'relative',
    ...SHADOWS.sm,
  },
  defaultStarBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    zIndex: 2,
  },
  manageIconBtn: {
    position: 'absolute',
    top: 6,
    right: 4,
    padding: 2,
    zIndex: 2,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs + 2,
    position: 'relative',
  },
  avatarSelected: {
    borderWidth: 2,
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  selectedCheckBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  friendName: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  friendNameSelected: {
    fontWeight: '700',
  },
  friendTag: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  quickAddCard: {
    width: 90,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  quickAddCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickAddText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyCard: {
    marginHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1,
    ...SHADOWS.sm,
  },
  emptyIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  emptySubtitle: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: SPACING.md,
  },
  emptyAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
  },
  emptyAddButtonText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
});
