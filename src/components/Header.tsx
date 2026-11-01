import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS } from '../constants/theme';

interface HeaderProps {
  onOpenSettings: () => void;
  userName?: string;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSettings, userName }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <View style={[styles.logoBadge, { backgroundColor: colors.primary }]}>
          <Ionicons
            name="heart"
            size={24}
            color="#FFFFFF"
            style={styles.logoIcon}
          />
        </View>
        <View style={styles.brandTextContainer}>
          <Text style={[styles.title, { color: colors.primaryDark }]}>Near-U</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Even when you&apos;re far, I&apos;m near.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[
          styles.profileButton,
          {
            backgroundColor: colors.primaryGhost,
            borderColor: colors.border,
          },
        ]}
        onPress={onOpenSettings}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Open settings and profile"
        activeOpacity={0.7}
      >
        <Ionicons name="settings-outline" size={18} color={colors.primaryDark} />
        {userName ? (
          <Text
            style={[styles.userNameText, { color: colors.primaryDark }]}
            numberOfLines={1}
          >
            {userName}
          </Text>
        ) : null}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm + 2,
  },
  logoIcon: {
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    transform: [{ translateY: 0.5 }],
  },
  brandTextContainer: {
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 11,
    fontWeight: '400',
    marginTop: -2,
  },
  profileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.sm + 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  userNameText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 90,
  },
});
