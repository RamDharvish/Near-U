import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { NearuMessage } from '../types';
import {
  MAX_CUSTOM_MESSAGES,
  MAX_MESSAGE_LENGTH,
  validateMessageText,
} from '../services/storage';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface ManageMessagesModalProps {
  visible: boolean;
  messages: NearuMessage[];
  onClose: () => void;
  onAddMessage: (text: string) => Promise<{ success: boolean; error?: string }>;
  onUpdateMessage: (id: string, text: string) => Promise<{ success: boolean; error?: string }>;
  onDeleteMessage: (id: string) => Promise<{ success: boolean; error?: string }>;
  onSetDefaultMessage: (id: string) => Promise<{ success: boolean; error?: string }>;
}

export const ManageMessagesModal: React.FC<ManageMessagesModalProps> = ({
  visible,
  messages,
  onClose,
  onAddMessage,
  onUpdateMessage,
  onDeleteMessage,
  onSetDefaultMessage,
}) => {
  const { colors } = useTheme();

  // Editing / Adding state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [inputText, setInputText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Custom messages count (excludes the single default message slot)
  const customCount = messages.filter((m) => !m.isDefault).length;
  const isLimitReached = customCount >= MAX_CUSTOM_MESSAGES;

  const handleStartAdd = () => {
    if (isLimitReached) {
      setValidationError(`Maximum limit reached: You can have up to ${MAX_CUSTOM_MESSAGES} custom messages.`);
      return;
    }
    setEditingMessageId(null);
    setInputText('');
    setValidationError(null);
    setIsAddingNew(true);
  };

  const handleStartEdit = (msg: NearuMessage) => {
    setIsAddingNew(false);
    setEditingMessageId(msg.id);
    setInputText(msg.text);
    setValidationError(null);
  };

  const handleCancelEditor = () => {
    setIsAddingNew(false);
    setEditingMessageId(null);
    setInputText('');
    setValidationError(null);
  };

  const handleSaveEditor = async () => {
    const validation = validateMessageText(inputText);
    if (!validation.isValid) {
      setValidationError(validation.error || 'Please enter a valid message.');
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);

    try {
      if (isAddingNew) {
        const result = await onAddMessage(validation.trimmed);
        if (!result.success) {
          setValidationError(result.error || 'Could not add message.');
          setIsSubmitting(false);
          return;
        }
      } else if (editingMessageId) {
        const result = await onUpdateMessage(editingMessageId, validation.trimmed);
        if (!result.success) {
          setValidationError(result.error || 'Could not update message.');
          setIsSubmitting(false);
          return;
        }
      }

      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Haptics ignore
      }

      handleCancelEditor();
    } catch {
      setValidationError('Unexpected error saving message.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (msg: NearuMessage) => {
    if (messages.length <= 1) {
      Alert.alert('Cannot Delete', 'You must have at least one saved message.');
      return;
    }

    Alert.alert(
      'Delete Message',
      `Are you sure you want to delete this message?\n\n"${msg.text}"`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await onDeleteMessage(msg.id);
            if (!result.success) {
              Alert.alert('Error', result.error || 'Could not delete message.');
            }
          },
        },
      ]
    );
  };

  const handleSetDefault = async (msg: NearuMessage) => {
    if (msg.isDefault) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // ignore
    }
    await onSetDefaultMessage(msg.id);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          {/* Modal Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="chatbubbles" size={20} color={colors.primary} />
              <Text style={[styles.headerTitle, { color: colors.primaryDark }]}>
                Manage Messages
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
            {/* Usage Counter Bar */}
            <View
              style={[
                styles.counterCard,
                {
                  backgroundColor: colors.primaryGhost,
                  borderColor: colors.borderHighlight,
                },
              ]}
            >
              <View style={styles.counterInfo}>
                <Text style={[styles.counterLabel, { color: colors.primaryDark }]}>
                  Custom Messages
                </Text>
                <Text style={[styles.counterSub, { color: colors.textSecondary }]}>
                  1 built-in default + up to {MAX_CUSTOM_MESSAGES} personal shortcuts
                </Text>
              </View>
              <View
                style={[
                  styles.counterBadge,
                  {
                    backgroundColor: isLimitReached ? colors.warning : colors.primary,
                  },
                ]}
              >
                <Text style={styles.counterBadgeText}>
                  {customCount}/{MAX_CUSTOM_MESSAGES}
                </Text>
              </View>
            </View>

            {/* Inline Editor for Adding / Editing */}
            {(isAddingNew || editingMessageId) ? (
              <View
                style={[
                  styles.editorCard,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <View style={styles.editorHeaderRow}>
                  <Text style={[styles.editorTitle, { color: colors.primaryDark }]}>
                    {isAddingNew ? 'Add Custom Message' : 'Edit Message'}
                  </Text>
                  <Text
                    style={[
                      styles.charCount,
                      {
                        color:
                          inputText.length > MAX_MESSAGE_LENGTH
                            ? colors.error
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    {inputText.length}/{MAX_MESSAGE_LENGTH}
                  </Text>
                </View>

                <TextInput
                  style={[
                    styles.editorInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor: validationError ? colors.error : colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={inputText}
                  onChangeText={(text) => {
                    setInputText(text);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="e.g. Miss you so much 💙"
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_MESSAGE_LENGTH + 10}
                  multiline
                  autoFocus
                />

                {validationError ? (
                  <View style={styles.errorRow}>
                    <Ionicons name="alert-circle" size={14} color={colors.error} />
                    <Text style={[styles.errorText, { color: colors.error }]}>
                      {validationError}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.editorActionsRow}>
                  <TouchableOpacity
                    style={[styles.cancelBtn, { borderColor: colors.border }]}
                    onPress={handleCancelEditor}
                    disabled={isSubmitting}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.saveBtn,
                      { backgroundColor: colors.primary },
                      isSubmitting && { opacity: 0.7 },
                    ]}
                    onPress={handleSaveEditor}
                    disabled={isSubmitting}
                  >
                    <Ionicons name="checkmark" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                    <Text style={styles.saveBtnText}>
                      {isSubmitting ? 'Saving...' : 'Save Message'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* Add Message Trigger Button */
              <TouchableOpacity
                style={[
                  styles.addMessageButton,
                  {
                    backgroundColor: isLimitReached ? colors.surfaceElevated : colors.primaryGhost,
                    borderColor: isLimitReached ? colors.border : colors.borderHighlight,
                  },
                ]}
                onPress={handleStartAdd}
                activeOpacity={0.7}
                disabled={isLimitReached}
              >
                <Ionicons
                  name={isLimitReached ? 'lock-closed-outline' : 'add-circle-outline'}
                  size={20}
                  color={isLimitReached ? colors.textMuted : colors.primary}
                />
                <Text
                  style={[
                    styles.addMessageText,
                    { color: isLimitReached ? colors.textMuted : colors.primary },
                  ]}
                >
                  {isLimitReached
                    ? `Message limit reached (${MAX_CUSTOM_MESSAGES}/${MAX_CUSTOM_MESSAGES})`
                    : 'Add a Custom Message'}
                </Text>
              </TouchableOpacity>
            )}

            {/* List of Saved Messages */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              SAVED MESSAGES ({messages.length})
            </Text>

            <View style={styles.messageList}>
              {messages.map((msg) => {
                const isEditingThis = editingMessageId === msg.id;
                return (
                  <View
                    key={msg.id}
                    style={[
                      styles.messageItem,
                      {
                        backgroundColor: msg.isDefault ? colors.primaryGhost : colors.surface,
                        borderColor: msg.isDefault ? colors.borderHighlight : colors.border,
                      },
                      isEditingThis && { borderColor: colors.primary, borderWidth: 1.5 },
                    ]}
                  >
                    <View style={styles.messageContentRow}>
                      <View style={styles.messageTextWrapper}>
                        <View style={styles.messageBadgeRow}>
                          {msg.isDefault ? (
                            <View
                              style={[
                                styles.defaultIndicatorBadge,
                                { backgroundColor: colors.primary },
                              ]}
                            >
                              <Ionicons name="star" size={10} color="#FFFFFF" />
                              <Text style={styles.defaultIndicatorText}>Default</Text>
                            </View>
                          ) : (
                            <Text style={[styles.customIndicatorText, { color: colors.textMuted }]}>
                              Custom Shortcut
                            </Text>
                          )}
                        </View>
                        <Text style={[styles.messageBodyText, { color: colors.text }]}>
                          &ldquo;{msg.text}&rdquo;
                        </Text>
                      </View>
                    </View>

                    {/* Actions: Set as Default, Edit, Delete */}
                    <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
                      {!msg.isDefault ? (
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleSetDefault(msg)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="star-outline" size={15} color={colors.primary} />
                          <Text style={[styles.actionBtnText, { color: colors.primary }]}>
                            Set as Default
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.actionBtn}>
                          <Ionicons name="checkmark-circle" size={15} color={colors.primary} />
                          <Text style={[styles.actionBtnText, { color: colors.primary, fontWeight: '700' }]}>
                            Active Default
                          </Text>
                        </View>
                      )}

                      <View style={styles.rightActionsGroup}>
                        <TouchableOpacity
                          style={styles.iconActionBtn}
                          onPress={() => handleStartEdit(msg)}
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityLabel="Edit message"
                        >
                          <Ionicons name="pencil" size={16} color={colors.textSecondary} />
                        </TouchableOpacity>

                        {messages.length > 1 && !msg.isDefault ? (
                          <TouchableOpacity
                            style={styles.iconActionBtn}
                            onPress={() => handleDelete(msg)}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Delete message"
                          >
                            <Ionicons name="trash-outline" size={16} color={colors.error} />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
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
  container: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '90%',
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
  counterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  counterInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  counterLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  counterSub: {
    fontSize: 11,
    marginTop: 2,
  },
  counterBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  counterBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  addMessageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md - 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    marginBottom: SPACING.md,
    gap: 8,
  },
  addMessageText: {
    fontSize: 14,
    fontWeight: '700',
  },
  editorCard: {
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    marginBottom: SPACING.md,
    ...SHADOWS.md,
  },
  editorHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  editorTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  charCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  editorInput: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm + 2,
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
  },
  editorActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: SPACING.md,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: RADIUS.md,
    ...SHADOWS.sm,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: SPACING.xs + 2,
  },
  messageList: {
    gap: SPACING.sm,
  },
  messageItem: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  messageContentRow: {
    padding: SPACING.md,
  },
  messageTextWrapper: {
    flex: 1,
  },
  messageBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  defaultIndicatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  defaultIndicatorText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  customIndicatorText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageBodyText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 4,
    borderTopWidth: 1,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  rightActionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconActionBtn: {
    padding: 4,
  },
});
