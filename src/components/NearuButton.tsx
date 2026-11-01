import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Friend } from '../types';
import { useTheme } from '../context/ThemeContext';
import { SPACING, SHADOWS } from '../constants/theme';

interface NearuButtonProps {
  selectedFriend: Friend | null;
  friendNickname?: string;
  onPressNearu: (friend: Friend, isLongPress?: boolean) => void;
  disabled?: boolean;
  isSending?: boolean;
  cooldownRemaining?: number;
}

export const NearuButton: React.FC<NearuButtonProps> = ({
  selectedFriend,
  friendNickname,
  onPressNearu,
  disabled = false,
  isSending = false,
  cooldownRemaining = 0,
}) => {
  const { colors } = useTheme();

  // Animation values
  const [scaleAnim] = useState(() => new Animated.Value(1));
  const [rippleAnim] = useState(() => new Animated.Value(1));
  const [rippleOpacity] = useState(() => new Animated.Value(0));
  const [ambientScale] = useState(() => new Animated.Value(1));
  const [ambientOpacity] = useState(() => new Animated.Value(0.7));
  const [heartPulseAnim] = useState(() => new Animated.Value(1));

  // Long press tracking ref to avoid accidental tap after long press release
  const isLongPressTriggered = useRef(false);

  const isCoolingDown = cooldownRemaining > 0;
  const isDisabled = disabled || !selectedFriend || isSending || isCoolingDown;
  const targetDisplayName = friendNickname || selectedFriend?.name || '';

  // 1. Subtle idle breathing effect while button is active and friend is selected
  useEffect(() => {
    if (isDisabled) {
      ambientScale.setValue(1);
      ambientOpacity.setValue(0.5);
      return;
    }

    const breathingAnimation = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ambientScale, {
            toValue: 1.05,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(ambientOpacity, {
            toValue: 0.95,
            duration: 1800,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(ambientScale, {
            toValue: 1.0,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(ambientOpacity, {
            toValue: 0.65,
            duration: 1800,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    breathingAnimation.start();
    return () => breathingAnimation.stop();
  }, [isDisabled, ambientScale, ambientOpacity]);

  // Press down feedback
  const handlePressIn = () => {
    if (isDisabled) return;
    Animated.spring(scaleAnim, {
      toValue: 0.94,
      friction: 6,
      tension: 60,
      useNativeDriver: true,
    }).start();

    // Subtle heart pulse while holding
    Animated.timing(heartPulseAnim, {
      toValue: 1.15,
      duration: 650,
      useNativeDriver: true,
    }).start();
  };

  // Release feedback
  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 40,
      useNativeDriver: true,
    }).start();

    Animated.timing(heartPulseAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    // Reset long-press flag shortly after release
    setTimeout(() => {
      isLongPressTriggered.current = false;
    }, 120);
  };

  // Normal tap action
  const handlePress = () => {
    if (isLongPressTriggered.current) {
      // Long press already handled
      return;
    }
    if (isDisabled || !selectedFriend) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // Haptics ignore
    }

    // Standard ripple
    rippleAnim.setValue(1);
    rippleOpacity.setValue(0.6);
    Animated.parallel([
      Animated.timing(rippleAnim, {
        toValue: 1.45,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(rippleOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();

    onPressNearu(selectedFriend, false);
  };

  // Deliberate long press action (~700ms)
  const handleLongPress = () => {
    if (isDisabled || !selectedFriend) return;
    isLongPressTriggered.current = true;

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Haptics ignore
    }

    // High-energy celebratory ripple
    rippleAnim.setValue(1);
    rippleOpacity.setValue(0.85);
    Animated.parallel([
      Animated.timing(rippleAnim, {
        toValue: 1.65,
        duration: 650,
        useNativeDriver: true,
      }),
      Animated.timing(rippleOpacity, {
        toValue: 0,
        duration: 650,
        useNativeDriver: true,
      }),
    ]).start();

    onPressNearu(selectedFriend, true);
  };

  return (
    <View style={styles.container}>
      {/* Selected Friend Prompt Banner */}
      <View style={styles.promptContainer}>
        {selectedFriend ? (
          <>
            <Text style={[styles.promptLead, { color: colors.textSecondary }]}>
              Send a little gesture to
            </Text>
            <View style={styles.friendHighlightRow}>
              <View
                style={[
                  styles.miniAvatarDot,
                  { backgroundColor: selectedFriend.avatarColor || colors.primary },
                ]}
              />
              <Text
                style={[styles.friendHighlightName, { color: colors.primaryDark }]}
                numberOfLines={1}
              >
                {targetDisplayName}
              </Text>
            </View>
            <Text style={[styles.promptSub, { color: colors.textSecondary }]}>
              {isCoolingDown
                ? `Wait ${cooldownRemaining}s before sending another NearU.`
                : 'Tap to send, or hold for a long 5s vibration.'}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.promptLead, { color: colors.textSecondary }]}>
              Choose someone to connect with
            </Text>
            <Text style={[styles.promptNoSelection, { color: colors.textMuted }]}>
              Select a friend above
            </Text>
            <Text style={[styles.promptSub, { color: colors.textSecondary }]}>
              Tap any friend card to get your Nearu ready.
            </Text>
          </>
        )}
      </View>

      {/* Main Nearu Circular Button Container */}
      <View style={styles.buttonWrapper}>
        {/* Animated Ripple Layer */}
        <Animated.View
          style={[
            styles.rippleCircle,
            {
              backgroundColor: colors.primaryLight,
              transform: [{ scale: rippleAnim }],
              opacity: rippleOpacity,
            },
          ]}
          pointerEvents="none"
        />

        {/* Ambient Breathing Halo Ring */}
        <Animated.View
          style={[
            styles.ambientRing,
            {
              backgroundColor: colors.primaryGhost,
              borderColor: colors.borderHighlight,
              transform: [{ scale: ambientScale }],
              opacity: ambientOpacity,
            },
            isDisabled && [
              styles.ambientRingDisabled,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                opacity: 0.5,
              },
            ],
          ]}
          pointerEvents="none"
        />

        {/* Interactive Button */}
        <Animated.View
          style={[
            styles.animatedButtonContainer,
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.mainButton,
              isDisabled
                ? [styles.mainButtonDisabled, { backgroundColor: colors.borderHighlight }]
                : [styles.mainButtonActive, { backgroundColor: colors.primary }],
            ]}
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onLongPress={handleLongPress}
            delayLongPress={700}
            activeOpacity={0.9}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel={
              selectedFriend
                ? `Send a Near-U to ${targetDisplayName}. Long press for long vibration.`
                : 'Send a Near-U button, disabled. Please select a friend first.'
            }
          >
            <View style={styles.innerContent}>
              <Animated.View
                style={[
                  styles.iconCircle,
                  isDisabled ? styles.iconCircleDisabled : styles.iconCircleActive,
                  { transform: [{ scale: heartPulseAnim }] },
                ]}
              >
                <Ionicons
                  name={isSending ? 'hourglass-outline' : 'heart'}
                  size={38}
                  color="#FFFFFF"
                />
              </Animated.View>

              <Text
                style={[
                  styles.actionText,
                  { color: '#FFFFFF' },
                  isDisabled && styles.actionTextDisabled,
                ]}
              >
                {isSending
                  ? 'SENDING...'
                  : isCoolingDown
                  ? `WAIT ${cooldownRemaining}s`
                  : 'Send a Near-U'}
              </Text>

              <Text
                style={[
                  styles.subText,
                  { color: '#FFFFFF' },
                  isDisabled && styles.subTextDisabled,
                ]}
              >
                {isSending
                  ? 'Delivering...'
                  : isCoolingDown
                  ? 'Anti-spam cooldown'
                  : selectedFriend
                  ? 'Tap or hold to send'
                  : 'Select a friend'}
              </Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
};

const BUTTON_SIZE = 190;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
  },
  promptContainer: {
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
    minHeight: 74,
    justifyContent: 'center',
  },
  promptLead: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  friendHighlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  friendHighlightName: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  promptNoSelection: {
    fontSize: 20,
    fontWeight: '700',
  },
  promptSub: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  buttonWrapper: {
    width: BUTTON_SIZE + 40,
    height: BUTTON_SIZE + 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  rippleCircle: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
  },
  ambientRing: {
    position: 'absolute',
    width: BUTTON_SIZE + 24,
    height: BUTTON_SIZE + 24,
    borderRadius: (BUTTON_SIZE + 24) / 2,
    borderWidth: 1.5,
  },
  ambientRingDisabled: {},
  animatedButtonContainer: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
  },
  mainButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainButtonActive: {
    ...SHADOWS.buttonPulse,
  },
  mainButtonDisabled: {
    ...SHADOWS.sm,
  },
  innerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  iconCircleActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  iconCircleDisabled: {
    backgroundColor: 'transparent',
  },
  actionText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  actionTextDisabled: {
    fontWeight: '600',
    opacity: 0.85,
  },
  subText: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.9,
    marginTop: 2,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  subTextDisabled: {
    opacity: 0.75,
  },
});
