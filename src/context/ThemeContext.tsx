import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { LIGHT_COLORS, DARK_COLORS } from '../constants/theme';
import { getThemePreference, setThemePreference, ThemePreference } from '../services/storage';

interface ThemeContextType {
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  colors: typeof LIGHT_COLORS;
  setTheme: (pref: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  resolvedTheme: 'light',
  colors: LIGHT_COLORS,
  setTheme: async () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemePreference>('system');
  const systemScheme = useColorScheme();

  useEffect(() => {
    let isMounted = true;
    getThemePreference().then((pref) => {
      if (isMounted) {
        setThemeState(pref);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : theme;

  const colors = resolvedTheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;

  const handleSetTheme = async (pref: ThemePreference) => {
    setThemeState(pref);
    await setThemePreference(pref);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        colors,
        setTheme: handleSetTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
