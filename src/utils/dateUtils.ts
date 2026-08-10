import {format, formatDistanceToNow, lightFormat, type Locale} from 'date-fns'
// Deep imports, NOT the 'date-fns/locale' barrel: that barrel is every locale
// date-fns ships (200+), all of which would land in the bundle to reach four.
import {enUS} from 'date-fns/locale/en-US'
import {sk} from 'date-fns/locale/sk'
import {es} from 'date-fns/locale/es'
import {pt} from 'date-fns/locale/pt'
import {i18n} from '../i18n/i18n'

/** The locales the app is translated into; see src/i18n/i18n.ts. */
const dateLocales: Record<string, Locale> = {en: enUS, sk, es, pt}

/**
 * The date-fns locale matching the active app language.
 *
 * Without it every date-fns helper renders English, which is only invisible
 * while the surrounding text is English too — a translated sentence with an
 * interpolated duration comes out as "Posledná kontrola about 1 hour ago".
 *
 * i18n.locale is a bare language code here (set from react-native-localize),
 * but it is split anyway so an "sk-SK" style tag cannot silently fall back.
 */
export const getDateLocale = (): Locale =>
  dateLocales[(i18n.locale ?? 'en').split('-')[0]] ?? enUS

/** "about 1 hour ago" / "približne pred hodinou" */
export const formatRelativeToNow = function (date: number | Date) {
  return formatDistanceToNow(date, {addSuffix: true, locale: getDateLocale()})
}

/** "21 Jul 20:18", with the month name in the active language. */
export const formatDayTime = function (date: number | Date) {
  return format(date, 'd MMM HH:mm', {locale: getDateLocale()})
}

export const formatDate = function (date: number | Date) {
  return lightFormat(date, 'dd.MM.yyyy')
}

export const SQLiteTimestampToDate = function (timestamp: string) {
  const timestampISO = `${timestamp.replace(' ', 'T')}Z`
  return new Date(timestampISO)
}
