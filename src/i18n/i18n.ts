// import * as Localization from "expo-localization"
import { I18n } from "i18n-js"
import { NativeModules, Platform } from "react-native"

// if English isn't your default language, move Translations to the appropriate language file.
import en from "../i18n_messages/en.json"
import sk from "../i18n_messages/sk.json"

type Translations = typeof en;
export const i18n = new I18n({ 'en-US': en })

/**
 * we need always include "*-US" for some valid language codes because when you change the system language,
 * the language code is the suffixed with "-US". i.e. if a device is set to English ("en"),
 * if you change to another language and then return to English language code is now "en-US".
 */
i18n.translations = { 
  en, "en-US": en, 
  sk, 'sk_SK': sk 
}

// important!
i18n.defaultLocale = 'en'
i18n.enableFallback = true;

i18n.locale = Platform.OS === 'ios'
  ? NativeModules.SettingsManager.settings.AppleLocale
  : NativeModules.I18nManager.localeIdentifier

console.log(i18n.locale)

/**
 * Builds up valid keypaths for translations.
 */
export type TxKeyPath = RecursiveKeyOf<Translations>

// via: https://stackoverflow.com/a/65333050
type RecursiveKeyOf<TObj extends object> = {
  [TKey in keyof TObj & (string | number)]: RecursiveKeyOfHandleValue<TObj[TKey], `${TKey}`>
}[keyof TObj & (string | number)]

type RecursiveKeyOfInner<TObj extends object> = {
  [TKey in keyof TObj & (string | number)]: RecursiveKeyOfHandleValue<
    TObj[TKey],
    `['${TKey}']` | `.${TKey}`
  >
}[keyof TObj & (string | number)]

type RecursiveKeyOfHandleValue<TValue, Text extends string> = TValue extends any[]
  ? Text
  : TValue extends object
  ? Text | `${Text}${RecursiveKeyOfInner<TValue>}`
  : Text
