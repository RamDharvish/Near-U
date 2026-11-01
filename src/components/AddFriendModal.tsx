import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { UserProfile } from '../types';
import { sendFriendRequest, normalizeNearuId, validateNearuIdFormat } from '../services/pairing';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface AddFriendModalProps {
  visible: boolean;
  userProfile: UserProfile;
  onClose: () => void;
}

export const AddFriendModal: React.FC<AddFriendModalProps> = ({
  visible,
  userProfile,
  onClose,
}) => {
  const { colors } = useTheme();
  const [friendId, setFriendId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successRecipient, setSuccessRecipient] = useState<string | null>(null);
  const activeRequestIdRef = useRef<number>(0);

  const resetForm = () => {
    activeRequestIdRef.current = 0;
    setFriendId('');
    setErrorMessage(null);
    setIsSubmitting(false);
    setSuccessRecipient(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSendRequest = async () => {
    setErrorMessage(null);
    const normalizedTargetId = normalizeNearuId(friendId);

    if (!normalizedTargetId) {
      setErrorMessage('Please enter a Nearu ID.');
      return;
    }

    if (!validateNearuIdFormat(normalizedTargetId)) {
      setErrorMessage('ID format must be NEARU- followed by code (e.g. NEARU-7K29M4X2).');
      return;
    }

    const normalizedSelfId = normalizeNearuId(userProfile.id);
    if (normalizedTargetId === normalizedSelfId) {
      setErrorMessage('You cannot send a friend request to your own Nearu ID.');
      return;
    }

    const currentRequestId = ++activeRequestIdRef.current;
    setIsSubmitting(true);

    try {
      const result = await sendFriendRequest(normalizedTargetId, userProfile);

      // If modal was dismissed or a newer request was started, ignore response
      if (activeRequestIdRef.current !== currentRequestId) {
        return;
      }

      if (result.success) {
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // ignore
        }
        setSuccessRecipient(result.targetName || 'your friend');
        setTimeout(() => {
          if (activeRequestIdRef.current === currentRequestId) {
            handleClose();
          }
        }, 2600);
      } else {
        setErrorMessage(result.message);
      }
    } catch (err: any) {
      if (activeRequestIdRef.current === currentRequestId) {
        setErrorMessage(err?.message || 'Could not send friend request. Check your internet connection.');
      }
    } finally {
      if (activeRequestIdRef.current === currentRequestId) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardContainer}
          >
            <View style={[styles.dialogCard, { backgroundColor: colors.surface }]}>
              {successRecipient ? (
                // Success View
                <View style={styles.successContainer}>
                  <View style={styles.successIconCircle}>
                    <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                  </View>
                  <Text style={[styles.successTitle, { color: colors.primaryDark }]}>
                    Request Sent! 💜
                  </Text>
                  <Text style={[styles.successMessage, { color: colors.text }]}>
                    Friend request sent to{' '}
                    <Text style={{ fontWeight: '700', color: colors.primaryDark }}>
                      {successRecipient}
                    </Text>
                    .
                  </Text>
                  <Text style={[styles.successSub, { color: colors.textSecondary }]}>
                    They will appear in your friends list once they accept on their device.
                  </Text>
                  <TouchableOpacity
                    style={[styles.doneBtn, { backgroundColor: colors.primary }]}
                    onPress={handleClose}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.doneBtnText, { color: colors.surface }]}>
                      Done
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                // Form View
                <>
                  <View style={styles.dialogHeader}>
                    <View
                      style={[
                        styles.headerIcon,
                        { backgroundColor: colors.primaryGhost },
                      ]}
                    >
                      <Ionicons name="person-add" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.headerTitles}>
                      <Text style={[styles.title, { color: colors.primaryDark }]}>
                        Add a friend
                      </Text>
                      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                        Enter their shareable Nearu ID to pair
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={handleClose}
                      style={styles.closeIconBtn}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close" size={22} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  {/* Input: Nearu ID */}
                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.primary }]}>
                      THEIR NEARU ID
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                          color: colors.text,
                        },
                      ]}
                      placeholder="e.g. NEARU-7K29M4X2"
                      placeholderTextColor={colors.textMuted}
                      value={friendId}
                      onChangeText={(text) => {
                        setFriendId(text.toUpperCase());
                        if (errorMessage) setErrorMessage(null);
                      }}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={32}
                      editable={!isSubmitting}
                    />
                    <Text style={[styles.inputHelper, { color: colors.textMuted }]}>
                      Format: NEARU- followed by your friend&apos;s code
                    </Text>
                  </View>

                  {/* Error Display */}
                  {errorMessage ? (
                    <View
                      style={[
                        styles.errorContainer,
                        { backgroundColor: colors.errorLight },
                      ]}
                    >
                      <Ionicons name="alert-circle" size={16} color={colors.error} />
                      <Text style={[styles.errorText, { color: colors.error }]}>
                        {errorMessage}
                      </Text>
                    </View>
                  ) : null}

                  {/* Actions */}
                  <View style={styles.buttonRow}>
                    <TouchableOpacity
                      style={[
                        styles.cancelButton,
                        { borderColor: colors.border },
                      ]}
                      onPress={handleClose}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>
                        Cancel
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.submitButton,
                        { backgroundColor: colors.primary },
                        isSubmitting && styles.submitButtonDisabled,
                      ]}
                      onPress={handleSendRequest}
                      activeOpacity={0.8}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <View style={styles.loadingRow}>
                          <ActivityIndicator size="small" color={colors.surface} />
                          <Text
                            style={[
                              styles.submitButtonText,
                              { color: colors.surface, marginLeft: 8 },
                            ]}
                          >
                            Sending...
                          </Text>
                        </View>
                      ) : (
                        <Text style={[styles.submitButtonText, { color: colors.surface }]}>
                          Send Request
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(40, 35, 58, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  keyboardContainer: {
    width: '100%',
    maxWidth: 380,
  },
  dialogCard: {
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    ...SHADOWS.lg,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  headerTitles: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeIconBtn: {
    padding: 4,
  },
  inputGroup: {
    marginTop: SPACING.md,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  inputHelper: {
    fontSize: 11,
    marginTop: 4,
    marginLeft: 2,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    marginTop: SPACING.md,
  },
  errorText: {
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '500',
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  cancelButton: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
    ...SHADOWS.sm,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  successIconCircle: {
    marginBottom: SPACING.sm,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  successMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  successSub: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.sm,
  },
  doneBtn: {
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.full,
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
