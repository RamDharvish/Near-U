import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { UserProfile } from '../types';
import { getFirebaseConnectionStatus } from '../services/firebase';
import { getAppUpdateInfo, checkAndDownloadUpdateInBackground, applyUpdateNow } from '../services/updates';
import { useTheme } from '../context/ThemeContext';
import { ThemePreference } from '../services/storage';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface SettingsModalProps {
  visible: boolean;
  profile: UserProfile | null;
  onClose: () => void;
  onUpdateName: (newName: string) => void;
  onClearFriends: () => void;
  onResetOnboarding: () => void;
  onDeleteAccount?: () => Promise<void>;
  onOpenManageMessages?: () => void;
  customMessagesCount?: number;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  profile,
  onClose,
  onUpdateName,
  onClearFriends,
  onResetOnboarding,
  onDeleteAccount,
  onOpenManageMessages,
  customMessagesCount = 0,
}) => {
  const { theme, colors, setTheme } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateReadyToApply, setUpdateReadyToApply] = useState(false);
  const updateInfo = getAppUpdateInfo();

  const handleManualCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus('Checking for updates...');
    try {
      const result = await checkAndDownloadUpdateInBackground({ force: true });
      if (result.status === 'update_ready') {
        setUpdateReadyToApply(true);
        setUpdateStatus('Update downloaded! Ready to apply.');
      } else {
        setUpdateStatus(result.message);
      }
    } catch {
      setUpdateStatus('Could not check updates.');
    } finally {
      setIsCheckingUpdate(false);
    }
  };
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.name || '');
  const [copied, setCopied] = useState(false);
  const firebaseStatus = getFirebaseConnectionStatus();

  const handleCopyId = async () => {
    if (!profile?.id) return;
    await Clipboard.setStringAsync(profile.id);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Haptics ignore
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      onUpdateName(trimmed);
      setIsEditingName(false);
    }
  };

  const confirmClearFriends = () => {
    Alert.alert(
      'Clear Friends List',
      'This will remove all accepted friendships from your account and your friends\' lists. You can add each other back anytime using your NearU IDs.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All Friends',
          style: 'destructive',
          onPress: () => {
            onClearFriends();
            onClose();
          },
        },
      ]
    );
  };

  const confirmResetOnboarding = () => {
    Alert.alert(
      'Reset Onboarding',
      'This will erase your local profile and re-open the initial setup screen. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            onResetOnboarding();
            onClose();
          },
        },
      ]
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete Account?',
      'This will permanently delete your NearU ID, friends list, device push tokens, and cloud profile. This action is permanent and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue Deletion',
          style: 'destructive',
          onPress: () => {
            // Second confirmation step for irreversible action
            Alert.alert(
              'Final Confirmation',
              'Are you absolutely sure you want to permanently delete your NearU account and all connections?',
              [
                { text: 'Keep Account', style: 'cancel' },
                {
                  text: 'Permanently Delete',
                  style: 'destructive',
                  onPress: async () => {
                    if (onDeleteAccount) {
                      await onDeleteAccount();
                      onClose();
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const themeOptions: { key: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'light', label: 'Light', icon: 'sunny-outline' },
    { key: 'dark', label: 'Dark', icon: 'moon-outline' },
    { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdropDismiss} />
        </TouchableWithoutFeedback>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="settings" size={20} color={colors.primary} />
              <Text style={[styles.headerTitle, { color: colors.primaryDark }]}>
                Profile & Settings
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
            {/* Profile Card */}
            <View
              style={[
                styles.profileCard,
                {
                  backgroundColor: colors.primaryGhost,
                  borderColor: colors.borderHighlight,
                },
              ]}
            >
              <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
                <Text style={styles.avatarText}>
                  {profile?.name ? profile.name[0].toUpperCase() : 'U'}
                </Text>
              </View>

              <View style={styles.profileInfo}>
                {isEditingName ? (
                  <View style={styles.editNameRow}>
                    <TextInput
                      style={[
                        styles.nameInput,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.primary,
                          color: colors.text,
                        },
                      ]}
                      value={nameInput}
                      onChangeText={setNameInput}
                      autoFocus
                      maxLength={25}
                    />
                    <TouchableOpacity
                      style={[styles.saveNameBtn, { backgroundColor: colors.primary }]}
                      onPress={handleSaveName}
                    >
                      <Ionicons name="checkmark" size={18} color={colors.surface} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.nameDisplayRow}
                    onPress={() => {
                      setNameInput(profile?.name || '');
                      setIsEditingName(true);
                    }}
                  >
                    <Text style={[styles.profileName, { color: colors.primaryDark }]}>
                      {profile?.name || 'User'}
                    </Text>
                    <Ionicons name="pencil" size={14} color={colors.primary} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.idChip,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.borderHighlight,
                    },
                  ]}
                  onPress={handleCopyId}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.idChipText, { color: colors.primary }]}>
                    {profile?.id || 'NEARU-....'}
                  </Text>
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={13}
                    color={copied ? colors.success : colors.primary}
                    style={{ marginLeft: 4 }}
                  />
                  {copied ? (
                    <Text style={[styles.copiedBadgeText, { color: colors.success }]}>
                      Copied
                    </Text>
                  ) : null}
                </TouchableOpacity>
              </View>
            </View>

            {/* Appearance Theme Selector */}
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              APPEARANCE
            </Text>
            <View
              style={[
                styles.themeSelectorGroup,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {themeOptions.map((opt) => {
                const isSelected = theme === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.themeTab,
                      isSelected && [
                        styles.themeTabActive,
                        { backgroundColor: colors.primaryGhost, borderColor: colors.primary },
                      ],
                    ]}
                    onPress={() => setTheme(opt.key)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={18}
                      color={isSelected ? colors.primary : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.themeTabText,
                        { color: isSelected ? colors.primary : colors.textSecondary },
                        isSelected && { fontWeight: '700' },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Nearu Messages Management */}
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              NEARU MESSAGES
            </Text>
            <View
              style={[
                styles.menuGroup,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  onClose();
                  onOpenManageMessages?.();
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: colors.primaryGhost },
                  ]}
                >
                  <Ionicons name="chatbubbles" size={18} color={colors.primary} />
                </View>
                <View style={styles.menuTextContainer}>
                  <Text style={[styles.menuTitle, { color: colors.text }]}>
                    Manage Messages
                  </Text>
                  <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>
                    Customize default & personal shortcuts ({customMessagesCount}/5 used)
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* App Data Management */}
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              DATA MANAGEMENT
            </Text>
            <View
              style={[
                styles.menuGroup,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.menuItem}
                onPress={confirmClearFriends}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: colors.background },
                  ]}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.warning} />
                </View>
                <View style={styles.menuTextContainer}>
                  <Text style={[styles.menuTitle, { color: colors.text }]}>
                    Clear Friends List
                  </Text>
                  <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>
                    Remove all accepted friendships
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <TouchableOpacity
                style={styles.menuItem}
                onPress={confirmResetOnboarding}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: colors.background },
                  ]}
                >
                  <Ionicons name="sparkles-outline" size={18} color={colors.textSecondary} />
                </View>
                <View style={styles.menuTextContainer}>
                  <Text style={[styles.menuTitle, { color: colors.text }]}>
                    Reset Onboarding
                  </Text>
                  <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>
                    Re-experience first-launch setup
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <TouchableOpacity
                style={styles.menuItem}
                onPress={confirmDeleteAccount}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: colors.background },
                  ]}
                >
                  <Ionicons name="trash" size={18} color={colors.error} />
                </View>
                <View style={styles.menuTextContainer}>
                  <Text style={[styles.menuTitle, { color: colors.error }]}>
                    Delete Account
                  </Text>
                  <Text style={[styles.menuSubtitle, { color: colors.textSecondary }]}>
                    Permanently delete NearU ID and all data
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* About Card */}
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              ABOUT NEARU
            </Text>
            <View
              style={[
                styles.aboutCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.aboutHeader}>
                <Ionicons name="heart" size={20} color={colors.primary} />
                <Text style={[styles.aboutTitle, { color: colors.primaryDark }]}>
                  Nearu
                </Text>
                <View
                  style={[
                    styles.versionBadge,
                    { backgroundColor: colors.primaryGhost },
                  ]}
                >
                  <Text style={[styles.versionBadgeText, { color: colors.primary }]}>
                    v1.0 (Milestone 2)
                  </Text>
                </View>
              </View>
              <Text style={[styles.aboutTagline, { color: colors.primary }]}>
                &ldquo;Even when you&apos;re far, I&apos;m near.&rdquo;
              </Text>
              <Text style={[styles.aboutDescription, { color: colors.textSecondary }]}>
                Nearu represents feeling close to someone even when you are physically apart. A silent, gentle gesture communicating you care.
              </Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.statusText, { color: colors.success }]}>
                  Device-to-Device Pairing Active
                </Text>
              </View>

              <View style={[styles.firebaseBox, { borderTopColor: colors.border }]}>
                <View style={styles.firebaseHeader}>
                  <Ionicons name="flame" size={14} color="#FFA000" />
                  <Text style={[styles.firebaseTitle, { color: colors.text }]}>
                    Firebase Connected
                  </Text>
                  <Text style={[styles.firebaseProjectId, { backgroundColor: colors.background, color: colors.textSecondary }]}>
                    {firebaseStatus.projectId}
                  </Text>
                </View>
                <Text style={[styles.firebaseSub, { color: colors.textSecondary }]}>
                  {firebaseStatus.currentUserId
                    ? `Anonymous session active (${firebaseStatus.currentUserId.substring(0, 8)}...).`
                    : 'Cloud Firestore initialized for real-time NearU delivery.'}
                </Text>
              </View>

              {/* EAS App Updates Section */}
              <View style={[styles.firebaseBox, { borderTopColor: colors.border }]}>
                <View style={styles.firebaseHeader}>
                  <Ionicons name="sparkles" size={14} color={colors.primary} />
                  <Text style={[styles.firebaseTitle, { color: colors.text }]}>
                    App Updates (EAS)
                  </Text>
                  <Text style={[styles.firebaseProjectId, { backgroundColor: colors.background, color: colors.textSecondary }]}>
                    {updateInfo.channel ? `channel: ${updateInfo.channel}` : 'embedded'}
                  </Text>
                </View>
                <Text style={[styles.firebaseSub, { color: colors.textSecondary }]}>
                  {updateInfo.isEnabled
                    ? `Runtime v${updateInfo.runtimeVersion || '1.0.0'} • ${updateInfo.updateId ? `Update: ${updateInfo.updateId.substring(0, 8)}...` : 'Running embedded bundle'}`
                    : 'EAS updates active in standalone preview/production builds.'}
                </Text>

                {updateReadyToApply ? (
                  <TouchableOpacity
                    style={[styles.checkUpdateBtn, { backgroundColor: colors.primary, marginTop: 10 }]}
                    onPress={() => applyUpdateNow()}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh" size={14} color="#FFFFFF" />
                    <Text style={[styles.checkUpdateBtnText, { color: '#FFFFFF' }]}>Restart to Apply Update</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.checkUpdateBtn, { borderColor: colors.border, marginTop: 10 }]}
                    onPress={handleManualCheckUpdate}
                    disabled={isCheckingUpdate}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="cloud-download-outline" size={14} color={colors.primary} />
                    <Text style={[styles.checkUpdateBtnText, { color: colors.primary }]}>
                      {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
                    </Text>
                  </TouchableOpacity>
                )}

                {updateStatus && (
                  <Text style={[styles.updateStatusMsg, { color: updateReadyToApply ? colors.success : colors.textSecondary }]}>
                    {updateStatus}
                  </Text>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(40, 35, 58, 0.55)',
    justifyContent: 'flex-end',
  },
  backdropDismiss: {
    flex: 1,
  },
  container: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '88%',
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
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  profileInfo: {
    flex: 1,
  },
  nameDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
  },
  editNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    fontSize: 16,
    fontWeight: '600',
  },
  saveNameBtn: {
    borderRadius: RADIUS.sm,
    padding: 6,
    marginLeft: 6,
  },
  idChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  idChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  copiedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: SPACING.xs + 2,
    marginTop: SPACING.sm,
  },
  themeSelectorGroup: {
    flexDirection: 'row',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 4,
    gap: 6,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  themeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm + 2,
    borderRadius: RADIUS.md,
    gap: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  themeTabActive: {},
  themeTabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  menuGroup: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
  },
  menuIconContainer: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm + 2,
  },
  menuTextContainer: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginLeft: SPACING.md + 42,
  },
  aboutCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md + 2,
    borderWidth: 1,
    ...SHADOWS.sm,
  },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  aboutTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  versionBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    marginLeft: 4,
  },
  versionBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  aboutTagline: {
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '600',
    marginBottom: 6,
  },
  aboutDescription: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: SPACING.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  firebaseBox: {
    marginTop: SPACING.sm + 2,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
  },
  firebaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  firebaseTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  firebaseProjectId: {
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: RADIUS.sm,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  firebaseSub: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  checkUpdateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  checkUpdateBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  updateStatusMsg: {
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
});
