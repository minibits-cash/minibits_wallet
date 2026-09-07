/**
 * Jest manual mock for react-native-localize.
 *
 * The real module reaches for a native TurboModule at import time, so anything
 * importing `src/i18n` — which calls getLocales() at module scope to pick the
 * device locale — was unloadable under jest. That kept `translate` out of every
 * testable module, which is why user-facing strings in services used to be
 * hardcoded English.
 *
 * Reports en-US, so tests read the `en` messages: assertions can match on the
 * English text without pinning a device locale.
 */
module.exports = {
  getLocales: () => [
    {countryCode: 'US', languageTag: 'en-US', languageCode: 'en', isRTL: false},
  ],
  getNumberFormatSettings: () => ({decimalSeparator: '.', groupingSeparator: ','}),
  getCountry: () => 'US',
  getCurrencies: () => ['USD'],
  getTimeZone: () => 'UTC',
  uses24HourClock: () => true,
  usesMetricSystem: () => true,
  usesAutoDateAndTime: () => true,
  usesAutoTimeZone: () => true,
  findBestLanguageTag: () => ({languageTag: 'en-US', isRTL: false}),
}
