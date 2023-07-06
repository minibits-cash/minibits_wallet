import {lightFormat} from 'date-fns'
// import { i18n } from "../i18n"
// import en from "date-fns/locale/en-US"

// TODO

/* type Options = Parameters<typeof format>[2]

 const getLocale = (): Locale => {
  const locale = i18n.locale.split("-")[0]
  // return locale === "ar" ? ar : locale === "ko" ? ko : en
  return locale
}

export const formatDate = (date: number | Date, dateFormat?: string, options?: Options) => {
const locale = `${i18n.locale}` */

export const formatDate = function (date: number | Date) {
  return lightFormat(date, 'dd.MM.yyyy')
}

export const SQLiteTimestampToDate = function (timestamp: string) {
  const timestampISO = `${timestamp.replace(' ', 'T')}Z`
  return new Date(timestampISO)
}
