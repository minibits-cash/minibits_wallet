const palette = {
  neutral100: '#FFFFFF',
  neutral200: '#F4F4F4',
  neutral300: '#E6E6E6',
  neutral400: '#B6ACA6',
  neutral500: '#978F8A',
  neutral600: '#564E4A',
  neutral700: '#2e2e2e',
  neutral800: '#232323',
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
  angry500: '#C03403',

  overlay20: 'rgba(25, 16, 21, 0.2)',
  overlay50: 'rgba(25, 16, 21, 0.5)',

  blue100: '#75B4FB',
  blue200: '#818AFF',

  orange200: '#FFAB51',
  orange400: '#F7931A',

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
     * The default color of the screen background.
     */
    background: palette.neutral200,
    /**
     * The default bg color of the primary button.
     */
    button: palette.success300,
    /**
     * The default color of the header and status bar.
     */
    header: palette.primary400,
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
    tint: palette.primary400,
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
     * The default card color.
     */
    card: palette.neutral100,
  },
  dark: {
    /**
     * The palette is available to use, but prefer using the name.
     * This is only included for rare, one-off cases. Try to use
     * semantic names as much as possible.
     */
    palette,
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
     * The default color of the screen background.
     */
    background: palette.neutral700,
    /**
     * The default bg color of the primary button.
     */
    button: palette.success200,
    /**
     * The default color of the header and status bar.
     */
    header: palette.primary500,
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
    tint: palette.primary400,
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
     * The default card color.
     */
    card: palette.neutral800,
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
