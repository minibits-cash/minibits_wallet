import {I18nOptions} from 'i18n-js'
import {i18n} from './i18n'
import {TxKeyPath} from './i18n'

/**
 * Translates text.
 *
 * @param key The i18n key.
 * @param options The i18n options.
 * @returns The translated text.
 *
 * @example
 * Translations:
 * ```ts
 * // en.json
 * {
 *  "heading": "Welcome to the app!",
 *  "buttonText": "Donate",
 *  "greeting": "Hello, %{name}!" // parameter
 * }
 * ```
 * Usage:
 * ```tsx
 * import { translate } from "../../i18n";
 * // or whatever the path is, let it auto-import
 *
 * translate("heading")			 // => Welcome to the app!
 * translate("greeting", { name: "world" }) // => Hello world!
 * <Button tx="buttonText" />		 // => a Donate button
 * ```
 * You can use nested objects, access them like: `common.payment.success`
 */

export function translate(
  key: TxKeyPath,
  options?: Partial<I18nOptions> & {[parameter: string]: any},
) {
  return i18n.t(key, options as I18nOptions)
}
