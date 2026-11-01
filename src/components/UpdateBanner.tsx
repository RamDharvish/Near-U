import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { SHADOWS } from '../constants/theme';

interface UpdateBannerProps {
  isVisible: boolean;
  onRestart: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ isVisible, onRestart, onDismiss }: UpdateBannerProps) {
  const { colors } = useTheme();

  if (!isVisible) return null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderHighlight,
        },
      ]}
    >
      <View style={[styles.iconWrapper, { backgroundColor: colors.primaryGhost }]}>
        <Ionicons name="sparkles" size={16} color={colors.primary} />
      </View>

      <View style={styles.textWrapper}>
        <Text style={[styles.title, { color: colors.text }]}>Update Ready</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Restart NearU to apply the latest changes.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.restartButton, { backgroundColor: colors.primary }]}
        onPress={onRestart}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Restart app to apply update"
      >
        <Text style={styles.restartButtonText}>Restart</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.closeButton}
        onPress={onDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss update banner"
      >
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...SHADOWS.md,
    zIndex: 999,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrapper: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  restartButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restartButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  closeButton: {
    padding: 2,
  },
});
