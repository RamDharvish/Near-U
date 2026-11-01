import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { NearuMessage } from '../types';
import { useTheme } from '../context/ThemeContext';
import { SPACING, RADIUS, SHADOWS } from '../constants/theme';

interface MessageSelectorProps {
  messages: NearuMessage[];
  selectedMessageId: string;
  onSelectMessage: (message: NearuMessage) => void;
  onOpenManageMessages: () => void;
}

export const MessageSelector: React.FC<MessageSelectorProps> = ({
  messages,
  selectedMessageId,
  onSelectMessage,
  onOpenManageMessages,
}) => {
  const { colors } = useTheme();

  const selectedMessage =
    messages.find((m) => m.id === selectedMessageId) ||
    messages.find((m) => m.isDefault) ||
    messages[0];

  const handleSelect = (msg: NearuMessage) => {
    if (msg.id === selectedMessageId) return;
    try {
      Haptics.selectionAsync();
    } catch {
      // Haptics ignore
    }
    onSelectMessage(msg);
  };

  return (
    <View style={styles.container}>
      {/* Compact Active Message Preview Pill */}
      <View
        style={[
          styles.previewCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.borderHighlight,
          },
        ]}
      >
        <View style={styles.previewLeft}>
          <View style={[styles.quoteIconCircle, { backgroundColor: colors.primaryGhost }]}>
            <Ionicons name="chatbubble-ellipses" size={14} color={colors.primary} />
          </View>
          <View style={styles.previewTextWrapper}>
            <View style={styles.previewHeaderRow}>
              <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>
                MESSAGE TO SEND
              </Text>
              {selectedMessage?.isDefault ? (
                <View style={[styles.defaultBadge, { backgroundColor: colors.primaryGhost }]}>
                  <Ionicons name="star" size={10} color={colors.primary} />
                  <Text style={[styles.defaultBadgeText, { color: colors.primary }]}>Default</Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[styles.previewMessageText, { color: colors.primaryDark }]}
              numberOfLines={2}
            >
              &ldquo;{selectedMessage?.text || 'Thinking of you 💙'}&rdquo;
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.manageIconButton, { backgroundColor: colors.background }]}
          onPress={onOpenManageMessages}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Manage messages"
        >
          <Ionicons name="options-outline" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Horizontal Fast-Switch Message Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsScrollContainer}
      >
        {messages.map((msg) => {
          const isSelected = msg.id === selectedMessage?.id;
          return (
            <TouchableOpacity
              key={msg.id}
              style={[
                styles.chip,
                {
                  backgroundColor: isSelected ? colors.primary : colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => handleSelect(msg)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`Select message: ${msg.text}`}
            >
              {msg.isDefault ? (
                <Ionicons
                  name="star"
                  size={11}
                  color={isSelected ? '#FFFFFF' : colors.primary}
                  style={styles.chipStarIcon}
                />
              ) : (
                <Ionicons
                  name="chatbubble-outline"
                  size={11}
                  color={isSelected ? '#FFFFFF' : colors.textMuted}
                  style={styles.chipStarIcon}
                />
              )}
              <Text
                style={[
                  styles.chipText,
                  { color: isSelected ? '#FFFFFF' : colors.text },
                  isSelected && styles.chipTextSelected,
                ]}
                numberOfLines={1}
              >
                {msg.text}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Quick Shortcut to Manage Messages */}
        <TouchableOpacity
          style={[
            styles.manageChip,
            {
              backgroundColor: colors.primaryGhost,
              borderColor: colors.borderHighlight,
            },
          ]}
          onPress={onOpenManageMessages}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Manage custom messages"
        >
          <Ionicons name="add" size={14} color={colors.primary} />
          <Text style={[styles.manageChipText, { color: colors.primary }]}>
            Manage
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    ...SHADOWS.sm,
  },
  previewLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  quoteIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  previewTextWrapper: {
    flex: 1,
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  defaultBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  previewMessageText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  manageIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsScrollContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    maxWidth: 220,
    ...SHADOWS.sm,
  },
  chipStarIcon: {
    marginRight: 5,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  chipTextSelected: {
    fontWeight: '700',
  },
  manageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 3,
  },
  manageChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
