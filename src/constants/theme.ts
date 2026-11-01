export const LIGHT_COLORS = {
  primary: '#7958CF',
  primaryDark: '#39245E',
  primaryLight: '#9A7DE5',
  primaryGhost: '#F0EAFF',
  primarySurface: '#EFEAFF',

  background: '#F5F1FF',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',

  border: '#E8E1F7',
  borderHighlight: '#D3C6F2',

  text: '#28233A',
  textSecondary: '#827B96',
  textMuted: '#A7A1B8',
  textOnPrimary: '#FFFFFF',

  success: '#2E8B57',
  successLight: '#E8F5EE',

  error: '#D9383A',
  errorLight: '#FDF0F0',

  warning: '#D9822B',
  warningLight: '#FFF6ED',

  accent: '#E774A3',
  accentLight: '#FFEBF3',
};

export const DARK_COLORS: typeof LIGHT_COLORS = {
  primary: '#9A7DE5',
  primaryDark: '#F0EAFF',
  primaryLight: '#BCA8F2',
  primaryGhost: 'rgba(154, 125, 229, 0.16)',
  primarySurface: 'rgba(154, 125, 229, 0.25)',

  background: '#120F1D',
  surface: '#1D182B',
  surfaceElevated: '#28223B',

  border: '#2E2742',
  borderHighlight: '#4A3E6B',

  text: '#F5F2FC',
  textSecondary: '#A9A2C2',
  textMuted: '#787192',
  textOnPrimary: '#FFFFFF',

  success: '#34A853',
  successLight: 'rgba(52, 168, 83, 0.15)',

  error: '#EA4335',
  errorLight: 'rgba(234, 67, 53, 0.15)',

  warning: '#FBBC04',
  warningLight: 'rgba(251, 188, 4, 0.15)',

  accent: '#F08AB1',
  accentLight: 'rgba(240, 138, 177, 0.2)',
};

// Default export keeps backward compatibility
export const COLORS = LIGHT_COLORS;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
};

export const RADIUS = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
};

export const SHADOWS = {
  sm: {
    shadowColor: '#39245E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#39245E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  lg: {
    shadowColor: '#7958CF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 8,
  },
  buttonPulse: {
    shadowColor: '#7958CF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
};
