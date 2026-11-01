import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { getUserProfile, saveUserProfile } from './src/services/storage';
import { initializeAnonymousSession } from './src/services/firebase';
import { UserProfile } from './src/types';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { MainScreen } from './src/screens/MainScreen';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { SHADOWS } from './src/constants/theme';

import { checkAndDownloadUpdateInBackground, applyUpdateNow } from './src/services/updates';
import { UpdateBanner } from './src/components/UpdateBanner';

function AppContent() {
  const { colors, resolvedTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isUpdateReady, setIsUpdateReady] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function initializeApp() {
      try {
        // 1. Await anonymous Firebase session with persistence (bounded by 4s timeout for offline start)
        const authPromise = initializeAnonymousSession();
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
        const user = await Promise.race([authPromise, timeoutPromise]);

        // 2. Load stored profile and guarantee uid is linked if available
        const storedProfile = await getUserProfile();
        if (storedProfile && user && !storedProfile.uid) {
          storedProfile.uid = user.uid;
          await saveUserProfile(storedProfile);
        }

        if (isMounted) {
          setUserProfile(storedProfile);
        }
      } catch (e) {
        console.warn('Error reading stored profile:', e);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initializeApp();

    // 3. Safe, non-blocking EAS Update check in background
    checkAndDownloadUpdateInBackground()
      .then((res) => {
        if (isMounted && res.status === 'update_ready') {
          setIsUpdateReady(true);
        }
      })
      .catch((err) => {
        console.info('[NearU Updates] Background update check note:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleOnboardingComplete = (profile: UserProfile) => {
    setUserProfile(profile);
  };

  const handleResetOnboarding = () => {
    setUserProfile(null);
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
        <View style={[styles.loadingLogoBadge, { backgroundColor: colors.primary }]}>
          <Ionicons
            name="heart"
            size={32}
            color="#FFFFFF"
            style={styles.loadingLogoIcon}
          />
        </View>
        <Text style={[styles.loadingAppName, { color: colors.primaryDark }]}>Near-U</Text>
        <Text style={[styles.loadingTagline, { color: colors.primary }]}>
          Even when you&apos;re far, I&apos;m near.
        </Text>
        <ActivityIndicator
          size="small"
          color={colors.primary}
          style={{ marginTop: 20 }}
        />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
      <UpdateBanner
        isVisible={isUpdateReady && !bannerDismissed}
        onRestart={applyUpdateNow}
        onDismiss={() => setBannerDismissed(true)}
      />
      {userProfile ? (
        <MainScreen
          userProfile={userProfile}
          onResetOnboarding={handleResetOnboarding}
        />
      ) : (
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      )}
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingLogoBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...SHADOWS.md,
  },
  loadingLogoIcon: {
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    transform: [{ translateY: 0.5 }],
  },
  loadingAppName: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  loadingTagline: {
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
