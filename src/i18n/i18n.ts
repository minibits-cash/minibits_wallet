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
  sk
}

// important!
i18n.defaultLocale = 'en'
i18n.enableFallback = true;

// i wanted to use Intl.Locale to parse this and get the base language
// however, seems like Intl.Locale is either not implemented in hermes or not workiking for this version
// also, react native provides locales in the en_US format, whereas js expect them in en-US format
// this is smaller than a full intl polyfill and does what we need


let localeIos = "en_US"
 
/*if(Platform.OS === 'ios') {
  if(NativeModules.SettingsManager.settings.AppleLocale || NativeModules.SettingsManager.settings.AppleLanguages[0]){
    localeIos = NativeModules.SettingsManager.settings.AppleLocale ||  NativeModules.SettingsManager.settings.AppleLanguages[0]
  }
}*/

const fullLocaleRN: string = (Platform.OS === 'ios'
  ? localeIos
  : NativeModules.I18nManager.localeIdentifier
).toString().replaceAll('_', '-')

const localeJSFormat = fullLocaleRN.includes("-") 
  ? fullLocaleRN.split("-")[0]
  : fullLocaleRN.slice(0, 2)

i18n.locale = localeJSFormat


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
