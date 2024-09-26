import { rootStoreInstance, useStores } from '../models'
import {ThemeCode, colors} from '../theme'
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
  colorName: keyof typeof colors.light & keyof typeof colors.dark & keyof typeof colors.golden,
) {
  const { userSettingsStore } = rootStoreInstance
  
  if(userSettingsStore.theme === ThemeCode.DEFAULT) {
    const colorScheme = useColorScheme()
    return colors[colorScheme][colorName] as ColorValue
  }

  return colors[userSettingsStore.theme][colorName] as ColorValue  
}
