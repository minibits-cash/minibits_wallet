import {colors} from '../theme'
import {
  ColorSchemeName,
  useColorScheme as _useColorScheme,
  ColorValue,
} from 'react-native'

// The useColorScheme value is always either light or dark, but the built-in
// type suggests that it can be null. This will not happen in practice, so this
// makes it a bit easier to work with.
export default function useColorScheme(): NonNullable<ColorSchemeName> {
  return _useColorScheme() as NonNullable<ColorSchemeName>
}

export function useThemeColor(
  colorName: keyof typeof colors.light & keyof typeof colors.dark,
) {
  const colorScheme = useColorScheme()
  return colors[colorScheme][colorName] as ColorValue
}
