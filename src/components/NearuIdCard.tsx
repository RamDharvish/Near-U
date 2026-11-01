import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface NearuIdCardProps {
  nearuId: string;
}

export const NearuIdCard: React.FC<NearuIdCardProps> = ({ nearuId }) => {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(nearuId);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Haptics ignore
      }
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch (e) {
      console.warn('Failed to copy ID:', e);
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.infoCol}>
          <Text style={[styles.label, { color: colors.primary }]}>MY NEARU ID</Text>
          <Text
            style={[styles.idText, { color: colors.primaryDark }]}
            selectable
          >
            {nearuId || 'NEARU-....'}
          </Text>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Share your ID with a friend.
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.copyButton,
            {
              backgroundColor: colors.primaryGhost,
              borderColor: colors.borderHighlight,
            },
            copied && {
              backgroundColor: colors.success,
              borderColor: colors.success,
            },
          ]}
          onPress={handleCopy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Copy Nearu ID"
        >
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
            size={18}
            color={copied ? '#FFFFFF' : colors.primary}
          />
          <Text
            style={[
              styles.copyButtonText,
              { color: colors.primary },
              copied && { color: '#FFFFFF' },
            ]}
          >
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md + 2,
    marginHorizontal: SPACING.md,
    marginVertical: SPACING.xs,
    borderWidth: 1,
    ...SHADOWS.sm,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoCol: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  idText: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
  helperText: {
    fontSize: 11,
    marginTop: 2,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs + 4,
    paddingHorizontal: SPACING.sm + 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
});
