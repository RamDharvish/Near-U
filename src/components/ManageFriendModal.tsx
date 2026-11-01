import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Friend } from '../types';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface ManageFriendModalProps {
  visible: boolean;
  friend: Friend | null;
  currentNickname?: string;
  isDefault: boolean;
  onClose: () => void;
  onSaveNickname: (friendUid: string, nickname: string) => Promise<void>;
  onToggleDefault: (friendUid: string) => Promise<void>;
  onRemoveFriend: (friendUid: string) => Promise<void>;
}

export const ManageFriendModal: React.FC<ManageFriendModalProps> = ({
  visible,
  friend,
  currentNickname,
  isDefault,
  onClose,
  onSaveNickname,
  onToggleDefault,
  onRemoveFriend,
}) => {
  if (!visible || !friend) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <ManageFriendModalContent
        friend={friend}
        currentNickname={currentNickname}
        isDefault={isDefault}
        onClose={onClose}
        onSaveNickname={onSaveNickname}
        onToggleDefault={onToggleDefault}
        onRemoveFriend={onRemoveFriend}
      />
    </Modal>
  );
};

interface ContentProps {
  friend: Friend;
  currentNickname?: string;
  isDefault: boolean;
  onClose: () => void;
  onSaveNickname: (friendUid: string, nickname: string) => Promise<void>;
  onToggleDefault: (friendUid: string) => Promise<void>;
  onRemoveFriend: (friendUid: string) => Promise<void>;
}

const ManageFriendModalContent: React.FC<ContentProps> = ({
  friend,
  currentNickname,
  isDefault,
  onClose,
  onSaveNickname,
  onToggleDefault,
  onRemoveFriend,
}) => {
  const { colors } = useTheme();
  const [nicknameInput, setNicknameInput] = useState(currentNickname || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const friendUid = friend.uid || friend.id;
  const initials = friend.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveNickname(friendUid, nicknameInput.trim());
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    try {
      await onSaveNickname(friendUid, '');
      setNicknameInput('');
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDefault = async () => {
    await onToggleDefault(friendUid);
  };

  const confirmRemoveFriend = () => {
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${friend.name}? You can reconnect later by exchanging NearU IDs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsRemoving(true);
            try {
              await onRemoveFriend(friendUid);
              onClose();
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not remove friend.');
            } finally {
              setIsRemoving(false);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="person" size={20} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.primaryDark }]}>
              Friend Details
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollBody}
        >
          {/* Friend Identity Banner */}
          <View
            style={[
              styles.identityCard,
              {
                backgroundColor: colors.primaryGhost,
                borderColor: colors.borderHighlight,
              },
            ]}
          >
            <View
              style={[
                styles.avatar,
                { backgroundColor: friend.avatarColor || colors.primary },
              ]}
            >
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
            <View style={styles.identityDetails}>
              <Text style={[styles.originalName, { color: colors.primaryDark }]}>
                {friend.name}
              </Text>
              <Text style={[styles.nearuId, { color: colors.primary }]}>
                {friend.nearuId || friend.id}
              </Text>
              {currentNickname ? (
                <Text style={[styles.nicknameHint, { color: colors.textSecondary }]}>
                  Showing as &ldquo;{currentNickname}&rdquo; on your phone
                </Text>
              ) : null}
            </View>
          </View>

          {/* Default Friend Toggle Section */}
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: colors.surface,
                borderColor: isDefault ? colors.primary : colors.border,
              },
            ]}
          >
            <View style={styles.defaultFriendRow}>
              <View style={styles.defaultFriendInfo}>
                <View style={styles.starTitleRow}>
                  <Ionicons
                    name={isDefault ? 'star' : 'star-outline'}
                    size={20}
                    color={isDefault ? '#F5A623' : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: isDefault ? colors.primaryDark : colors.text },
                    ]}
                  >
                    Default NearU Friend
                  </Text>
                </View>
                <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
                  {isDefault
                    ? 'Selected automatically when you open Nearu. Pressing NearU sends straight to them.'
                    : 'Make this friend your default. When you open Nearu, they will be chosen automatically.'}
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.defaultToggleBtn,
                  isDefault
                    ? [styles.defaultActiveBtn, { backgroundColor: colors.primaryGhost }]
                    : [styles.defaultInactiveBtn, { backgroundColor: colors.primary }],
                ]}
                onPress={handleToggleDefault}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.defaultToggleBtnText,
                    { color: isDefault ? colors.primary : colors.surface },
                  ]}
                >
                  {isDefault ? 'Remove Default' : 'Set Default'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Private Nickname Section */}
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Private Nickname
            </Text>
            <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
              Only visible on your device. Their original profile name remains unchanged.
            </Text>

            <TextInput
              style={[
                styles.nicknameInput,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              placeholder="e.g. Best Friend, Mom"
              placeholderTextColor={colors.textMuted}
              value={nicknameInput}
              onChangeText={setNicknameInput}
              maxLength={25}
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  { backgroundColor: colors.primary },
                  isSaving && { opacity: 0.6 },
                ]}
                onPress={handleSave}
                disabled={isSaving}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark" size={16} color={colors.surface} />
                <Text style={[styles.saveBtnText, { color: colors.surface }]}>
                  Save Nickname
                </Text>
              </TouchableOpacity>

              {currentNickname ? (
                <TouchableOpacity
                  style={[
                    styles.resetBtn,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={handleReset}
                  disabled={isSaving}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.resetBtnText, { color: colors.textSecondary }]}>
                    Reset
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Remove Friend Section */}
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                marginTop: SPACING.md,
              },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.removeBtn,
                {
                  borderColor: colors.error,
                  backgroundColor: colors.background,
                },
                isRemoving && { opacity: 0.6 },
              ]}
              onPress={confirmRemoveFriend}
              disabled={isRemoving}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Remove friend ${friend.name}`}
            >
              <Ionicons name="person-remove-outline" size={16} color={colors.error} />
              <Text style={[styles.removeBtnText, { color: colors.error }]}>
                {isRemoving ? 'Removing Friend...' : 'Remove Friend'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(40, 35, 58, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '85%',
    paddingBottom: SPACING.xl,
    ...SHADOWS.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 2,
  },
  scrollBody: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  identityDetails: {
    flex: 1,
  },
  originalName: {
    fontSize: 18,
    fontWeight: '700',
  },
  nearuId: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  nicknameHint: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 3,
  },
  sectionCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    ...SHADOWS.sm,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  sectionDesc: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: SPACING.sm,
  },
  defaultFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  defaultFriendInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  starTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  defaultToggleBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultActiveBtn: {
    borderWidth: 1,
    borderColor: '#D3C6F2',
  },
  defaultInactiveBtn: {},
  defaultToggleBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  nicknameInput: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
    gap: 6,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  resetBtn: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    gap: 8,
  },
  removeBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
