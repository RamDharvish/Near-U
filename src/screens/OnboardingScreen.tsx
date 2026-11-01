import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { generateNearuId, saveUserProfile } from '../services/storage';
import { syncUserIdentityWithCloud } from '../services/pairing';
import { auth } from '../services/firebase';
import { UserProfile } from '../types';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface OnboardingScreenProps {
  onComplete: (profile: UserProfile) => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [generatedId] = useState<string>(() => generateNearuId());
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleCopyId = async () => {
    await Clipboard.setStringAsync(generatedId);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Haptics ignore
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGetStarted = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter what your friends should call you.');
      return;
    }

    setIsSubmitting(true);
    try {
      const syncedProfile = await syncUserIdentityWithCloud(trimmed, generatedId);
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Haptics ignore
      }
      onComplete(syncedProfile);
    } catch {
      // Offline fallback: save locally so user is never blocked
      const fallbackProfile: UserProfile = {
        id: generatedId,
        uid: auth.currentUser?.uid,
        name: trimmed,
        createdAt: Date.now(),
      };
      await saveUserProfile(fallbackProfile);
      onComplete(fallbackProfile);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        style={styles.keyboardContainer}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: keyboardVisible
                ? (Platform.OS === 'android' ? 220 : 140)
                : SPACING.xxl,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand Presentation */}
          <View style={styles.brandHero}>
            <View
              style={[
                styles.logoHalo,
                {
                  backgroundColor: colors.primaryGhost,
                  borderColor: colors.borderHighlight,
                },
              ]}
            >
              <View style={[styles.logoCircle, { backgroundColor: colors.primary }]}>
                <Ionicons
                  name="heart"
                  size={38}
                  color="#FFFFFF"
                  style={styles.logoIcon}
                />
              </View>
            </View>

            <Text style={[styles.appName, { color: colors.primaryDark }]}>Near-U</Text>
            <Text style={[styles.tagline, { color: colors.primary }]}>
              &ldquo;Even when you&apos;re far, I&apos;m near.&rdquo;
            </Text>

            <Text style={[styles.philosophy, { color: colors.textSecondary }]}>
              A quiet, personal gesture to let someone know they are on your mind. No messages, no feeds, no noise.
            </Text>
          </View>

          {/* Form Card */}
          <View
            style={[
              styles.formCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {/* Generated ID Box */}
            <View
              style={[
                styles.idPreviewBox,
                {
                  backgroundColor: colors.primaryGhost,
                  borderColor: colors.borderHighlight,
                },
              ]}
            >
              <View style={styles.idHeaderRow}>
                <Text style={[styles.idLabel, { color: colors.primary }]}>
                  YOUR UNIQUE NEARU ID
                </Text>
                <TouchableOpacity
                  style={[
                    styles.copyChip,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.borderHighlight,
                    },
                  ]}
                  onPress={handleCopyId}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Copy Nearu ID"
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={12}
                    color={copied ? colors.success : colors.primary}
                  />
                  <Text
                    style={[
                      styles.copyChipText,
                      { color: colors.primary },
                      copied && { color: colors.success },
                    ]}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.idValue, { color: colors.primaryDark }]}>
                {generatedId}
              </Text>
              <Text style={[styles.idHint, { color: colors.textSecondary }]}>
                This random ID is saved locally so friends can connect with you.
              </Text>
            </View>

            {/* Name Input */}
            <View style={styles.inputSection}>
              <Text style={[styles.inputLabel, { color: colors.primary }]}>
                Enter Your Name
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="Enter your name"
                placeholderTextColor={colors.textMuted}
                value={name}
                onFocus={() => {
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true });
                  }, 120);
                }}
                onChangeText={(text) => {
                  setName(text);
                  if (error) setError(null);
                }}
                autoCapitalize="words"
                maxLength={30}
              />
            </View>

            {/* Error Message */}
            {error ? (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: colors.errorLight },
                ]}
              >
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
              </View>
            ) : null}

            {/* Submit Button */}
            <TouchableOpacity
              style={[
                styles.startButton,
                { backgroundColor: colors.primary },
                isSubmitting && styles.startButtonDisabled,
              ]}
              onPress={handleGetStarted}
              activeOpacity={0.85}
              disabled={isSubmitting}
            >
              <Text style={[styles.startButtonText, { color: colors.surface }]}>
                {isSubmitting ? 'Setting up...' : 'Get Started'}
              </Text>
              <Ionicons name="arrow-forward" size={18} color={colors.surface} />
            </TouchableOpacity>

            {/* Privacy Note */}
            <View style={styles.privacyNote}>
              <Ionicons
                name="shield-checkmark-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text style={[styles.privacyNoteText, { color: colors.textSecondary }]}>
                No email, phone number, or password required.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    alignItems: 'center',
    flexGrow: 1,
  },
  brandHero: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
    marginTop: SPACING.sm,
  },
  logoHalo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
    borderWidth: 1.5,
  },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.buttonPulse,
  },
  logoIcon: {
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    transform: [{ translateY: 0.5 }],
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    fontStyle: 'italic',
    fontWeight: '600',
    marginTop: 2,
    marginBottom: SPACING.sm,
  },
  philosophy: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 290,
  },
  formCard: {
    width: '100%',
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    ...SHADOWS.md,
  },
  idPreviewBox: {
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  idHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  idLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    gap: 4,
  },
  copyChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  idValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginVertical: 4,
  },
  idHint: {
    fontSize: 11,
  },
  inputSection: {
    marginBottom: SPACING.md,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md - 2,
    fontSize: 16,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
    gap: 6,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.full,
    gap: 8,
    ...SHADOWS.sm,
  },
  startButtonDisabled: {
    opacity: 0.6,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.md,
    gap: 6,
  },
  privacyNoteText: {
    fontSize: 11,
  },
});
