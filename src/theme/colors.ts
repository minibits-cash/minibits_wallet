import { ColorValue, useColorScheme } from 'react-native'

export enum ThemeCode {
  DEFAULT = 'default',
  DARK = 'dark',
  LIGHT = 'light',
  GOLDEN = 'golden'  
}

export interface ThemeData {
  code: ThemeCode,
  title: string, 
  color: string | ColorValue 
}

export type ThemeList = Partial<Record<ThemeCode, ThemeData>>

const palette = {
  neutral100: '#FFFFFF',
  neutral200: '#F4F4F4',
  neutral300: '#E6E6E6',
  neutral400: '#B6ACA6',
  neutral500: '#978F8A',
  neutral600: '#564E4A',
  neutral700: '#2e2e2e',
  neutral800: '#181818',
  neutral900: '#050505',

  primary100: '#D6E4FF',
  primary200: '#ADC8FF',
  primary300: '#84A9FF',
  primary400: '#3680FA',
  primary500: '#2371F4',
  primary600: '#254EDB',
  primary700: '#1939B7',
  primary800: '#102693',
  primary900: '#091A7A',

  gold100: '#E4C19B',
  gold200: '#D7A068',

  secondary100: '#54ACE7',
  secondary200: '#318BC8',
  secondary300: '#1A71AC',
  secondary400: '#0E629B',
  secondary500: '#025287',

  success100: '#78C670',
  success200: '#599D52',
  success300: '#3E7A38',

  accent100: '#FDBFD3',
  accent200: '#F9D192',
  accent300: '#F7C577',
  accent400: '#FFBB50',
  accent500: '#DEA144',

  angry100: '#F2D6CD',
  angry300: '#C03403',
  angry500: '#8F3403',

  overlay20: 'rgba(25, 16, 21, 0.2)',
  overlay50: 'rgba(25, 16, 21, 0.5)',

  blue100: '#75B4FB',
  blue200: '#818AFF',
  blue400: '#2D57E1',
  blue600: '#1D3FBB',

  green400: '#599D52',

  orange200: '#FFAB51',
  orange400: '#FF9900',
  orange600: '#F7931A',
  orange800: '#AB6E12',

  focus100: '#FB4E9E',
  focus200: '#F62586',
  focus300: '#CC0964',

  iconBlue200: '#318BC8',
  iconBlue300: '#1A71AC',
  iconGreen200: '#599D52',
  iconGreen300: '#3E7A38',
  iconYellow300: '#F7C577',
  iconGreyBlue400: '#0E629B',
  iconMagenta200: '#F62586',
  iconViolet200: '#AF00C9',
  iconViolet300: '#7F38CA',
  iconViolet400: '#662482',
} as const


export const colors = {
  /**
   * The palette is available to use, but prefer using the name.
   * This is only included for rare, one-off cases. Try to use
   * semantic names as much as possible.
   */
  palette,
  light: {
    /**
     * A helper for making something see-thru.
     */
    transparent: 'rgba(0, 0, 0, 0)',
    /**
     * The default text color in many components.
     */
    text: palette.neutral800,
    /**
     * Secondary text information.
     */
    textDim: palette.neutral500,
    /**
     * Color for amounts and balances.
     */
    amount: palette.neutral800,
    /**
     * Color for amount input inside header.
     */
    amountInput: palette.neutral100,
    /**
     * Color for amounts and balances.
     */
    receivedAmount: palette.success300,
    /**
     * The default color of the screen background.
     */
    background: palette.neutral200,
    /**
     * The default bg color of the primary button.
     */
    button: palette.success300,
    /**
     * The default bg color of the primary button.
     */
    buttonPressed: palette.success200,
    /**
     * The default bg color of the primary button.
     */
    buttonSecondary: palette.neutral200,
    /**
     * The default bg color of the primary button.
     */
    buttonSecondaryPressed: palette.neutral300,
    /**
     * The default bg color of the primary button.
     */
    buttonTertiary: 'transparent',
    /**
     * The default bg color of the primary button.
     */
    buttonTertiaryPressed: palette.neutral200,
    /**
     * The default icon color of the main screen button.
     */
    mainButtonIcon: palette.success300,
    /**
     * The default icon color of the primary button.
     */
    buttonIcon: palette.neutral100,
    /**
     * The default icon color of the secondary button.
     */
    buttonSecondaryIcon: palette.neutral100,
    /**
     * The default icon color of the tertiary button.
     */
    buttonTertiaryIcon: palette.neutral100,
    /**
     * The default color of the header and status bar.
     */
    header: palette.primary400,
    /**
     * The default color of the header title.
     */
    headerTitle: palette.neutral100,
    /**
     * The default color of the header sub title.
     */
    headerSubTitle: palette.primary200,
    /**
     * The default color of the bottom menu.
     */
    menu: palette.neutral200,
    /**
     * The default border color.
     */
    border: palette.neutral400,
    /**
     * The main tinting color.
     */
    tint: palette.primary200,
    /**
     * A subtle color used for lines.
     */
    separator: palette.neutral200,
    /**
     * Error messages.
     */
    error: palette.angry500,
    /**
     * Error Background.
     *
     */
    errorBackground: palette.angry100,
    /**
     * Info Background.
     *
     */
    info: palette.success100,
    /**
     * Warning Background.
     *
     */
    warn: palette.accent400,
    /**
     * The default card color.
     */
    card: palette.neutral100,
    statusBarOnModalOpen: '#214D96',
    statusBarOnLoading: '#346BC6',
    loadingIndicator: '#fff',
    btc: '#f7931A',
    usd: '#599D52',
    eur: '#0002C8'
  },
  dark: {
    /**
     * A helper for making something see-thru.
     */
    transparent: 'rgba(0, 0, 0, 0)',
    /**
     * The default text color in many components.
     */
    text: palette.neutral200,
    /**
     * Secondary text information.
     */
    textDim: palette.neutral500,
    /**
     * Color for amounts and balances.
     */
    amount: palette.neutral200,
    /**
     * Color for amount input inside header.
     */
    amountInput: palette.neutral100,
    /**
     * Color for amounts and balances.
     */
    receivedAmount: palette.success200,
    /**
     * The default color of the screen background.
     */
    background: palette.neutral700,
    /**
     * The default bg color of the primary button.
     */
    button: palette.success300,
    /**
     * The default bg color of the primary button.
     */
    buttonPressed: palette.success200,
    /**
     * The default bg color of the primary button.
     */
    buttonSecondary: palette.neutral700,
    /**
     * The default bg color of the primary button.
     */
    buttonSecondaryPressed: palette.neutral600,
    /**
     * The default bg color of the primary button.
     */
    buttonTertiary: 'transparent',
    /**
     * The default bg color of the primary button.
     */
    buttonTertiaryPressed: palette.neutral700,
    /**
     * The default icon color of the main screen button.
     */
    mainButtonIcon: palette.success300,
    /**
     * The default icon color of the primary button.
     */
    buttonIcon: palette.neutral100,
    /**
     * The default icon color of the secondary button.
     */
    buttonSecondaryIcon: palette.neutral100,
    /**
     * The default icon color of the tertiary button.
     */
    buttonTertiaryIcon: palette.neutral100,
    /**
     * The default color of the header and status bar.
     */
    header: palette.primary600,
    /**
     * The default color of the header title.
     */
    headerTitle: palette.neutral100,
    /**
     * The default color of the header sub title.
     */
    headerSubTitle: palette.primary200,
    /**
     * The default color of the bottom menu.
     */
    menu: palette.neutral700,
    /**
     * The default border color.
     */
    border: palette.neutral400,
    /**
     * The main tinting color.
     */
    tint: palette.primary200,
    /**
     * A subtle color used for lines.
     */
    separator: palette.neutral700,
    /**
     * Error messages.
     */
    error: palette.angry500,
    /**
     * Error Background.
     *
     */
    errorBackground: palette.angry100,
    /**
     * Info Background.
     *
     */
    info: palette.success200,
    /**
     * Warning Background.
     *
     */
    warn: palette.accent500,
    /**
     * The default card color.
     */
    card: palette.neutral800,
    statusBarOnModalOpen: '#162F83',
    statusBarOnLoading: '#2746B0',
    loadingIndicator: '#ccc',
    btc: '#f7931A',
    usd: '#599D52',
    eur: '#0002C8'
  },
  golden: {
    /**
     * A helper for making something see-thru.
     */
    transparent: 'rgba(0, 0, 0, 0)',
    /**
     * The default text color in many components.
     */
    text: palette.neutral200,
    /**
     * Secondary text information.
     */
    textDim: palette.neutral500,
    /**
     * Color for amounts and balances.
     */
    amount: palette.gold100,
    /**
     * Color for amount input inside header.
     */
    amountInput: palette.gold200,
    /**
     * Color for amounts and balances.
     */
    receivedAmount: palette.success200,
    /**
     * The default color of the screen background.
     */
    background: palette.neutral700,
    /**
     * The default bg color of the primary button.
     */
    button: palette.neutral900,
    /**
     * The default bg color of the primary button.
     */
    buttonPressed: palette.success200,
    /**
     * The default bg color of the primary button.
     */
    buttonSecondary: palette.neutral700,
    /**
     * The default bg color of the primary button.
     */
    buttonSecondaryPressed: palette.neutral600,
    /**
     * The default bg color of the primary button.
     */
    buttonTertiary: 'transparent',
    /**
     * The default bg color of the primary button.
     */
    buttonTertiaryPressed: palette.neutral700,
    /**
     * The default icon color of the main screen button.
     */
    mainButtonIcon: palette.gold200,
    /**
     * The default icon color of the primary button.
     */
    buttonIcon: palette.gold200,
    /**
     * The default icon color of the secondary button.
     */
    buttonSecondaryIcon: palette.gold100,
    /**
     * The default icon color of the tertiary button.
     */
    buttonTertiaryIcon: palette.gold100,
    /**
     * The default color of the header and status bar.
     */
    header: palette.neutral900,
    /**
     * The default color of the header title.
     */
    headerTitle: palette.gold200,
    /**
     * The default color of the header sub title.
     */
    headerSubTitle: palette.gold100,
    /**
     * The default color of the bottom menu.
     */
    menu: palette.neutral700,
    /**
     * The default border color.
     */
    border: palette.neutral400,
    /**
     * The main tinting color.
     */
    tint: palette.gold200,
    /**
     * A subtle color used for lines.
     */
    separator: palette.neutral700,
    /**
     * Error messages.
     */
    error: palette.angry500,
    /**
     * Error Background.
     *
     */
    errorBackground: palette.angry100,
    /**
     * Info Background.
     *
     */
    info: palette.success200,
    /**
     * Warning Background.
     *
     */
    warn: palette.accent500,
    /**
     * The default card color.
     */
    card: palette.neutral800,
    statusBarOnModalOpen: palette.neutral900,
    statusBarOnLoading: palette.neutral900,
    loadingIndicator: '#ccc',
    btc: '#f7931A',
    usd: '#599D52',
    eur: '#0002C8'
  },
}


// const colorScheme = useColorScheme()

export const Themes: ThemeList = {
  default: {
    code: ThemeCode.DEFAULT,
    title: 'Default',
    color: palette.primary400
  },
  dark: {
    code: ThemeCode.DARK,
    title: 'Dark',
    color: colors[ThemeCode.DARK].header
  },
  light: {
    code: ThemeCode.LIGHT,
    title: 'Light',
    color: colors[ThemeCode.LIGHT].header
  },
  golden: {
    code: ThemeCode.GOLDEN,
    title: 'Golden',
    color: palette.gold200
  },
}

export const getRandomIconColor = () => {
  const options = [
    palette.iconBlue200,
    palette.iconBlue300,
    palette.iconGreen200,
    palette.iconGreen300,
    palette.iconYellow300,
  ]

  const randomIndex = Math.floor(Math.random() * options.length)
  return options[randomIndex]
}
