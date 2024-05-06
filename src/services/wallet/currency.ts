import numbro from 'numbro'
import { BtcIcon, EurIcon, UsdIcon } from '../../components'
import AppError, { Err } from '../../utils/AppError'
import { log } from '../logService'


export type MintUnit = typeof MintUnits[number]
export const MintUnits = ['btc', 'sat', 'msat', 'usd', 'eur'] as const

export enum CurrencyCode {
    BTC = 'BTC', SATS = 'SATS', MSATS = 'mSATS', EUR = 'EUR', GBP = 'GBP', 
    CZK = 'CZK', USD = 'USD', PLN = 'PLN', HUF = 'HUF', RON = 'RON',
}

export type MintUnitCurrencyPair = {
    [key in MintUnit]: CurrencyCode
}

export const MintUnitCurrencyPairs: MintUnitCurrencyPair = {
  btc:CurrencyCode.BTC, sat:CurrencyCode.SATS, msat:CurrencyCode.MSATS, eur:CurrencyCode.EUR, usd:CurrencyCode.USD,
}

export interface CurrencyData {
    symbol: string,
    title: string,
    code: CurrencyCode,
    icon?: string,
    mintUnit?: MintUnit,
    precision: number,
    mantissa: number,
}

export type CurrencyList = Partial<Record<CurrencyCode, CurrencyData>>

export const Currencies: CurrencyList = {
    SATS: {
        symbol: 'SATS',
        title: 'Satoshis',
        code: CurrencyCode.SATS,
        mintUnit: 'sat',
        icon: BtcIcon,
        precision: 1,
        mantissa: 0,
    },
    mSATS: {
        symbol: 'mSATS',
        title: 'Milisatoshis',
        code: CurrencyCode.MSATS,
        mintUnit: 'msat',
        icon: BtcIcon,
        precision: 1,
        mantissa: 0,
    },
    BTC: {
        symbol: '₿',
        title: 'Bitcoin',
        code: CurrencyCode.BTC,
        mintUnit: 'btc',
        icon: BtcIcon,
        precision: 1,
        mantissa: 6,
    },
    USD: {
        symbol: '$',
        title: 'US dollar',
        code: CurrencyCode.USD,
        mintUnit: 'usd',
        icon: UsdIcon,
        precision: 100,
        mantissa: 2,
    },
    EUR: {
        symbol: '€',
        title: 'Euro',
        code: CurrencyCode.EUR,
        mintUnit: 'eur',
        icon: EurIcon,
        precision: 100,
        mantissa: 2,
    },
    GBP: {
        symbol: '£',
        title: 'Pound sterling',
        code: CurrencyCode.GBP,        
        precision: 100,
        mantissa: 2,
    },
    CZK: {
        symbol: 'Kč',
        title: 'Česká koruna',
        code: CurrencyCode.CZK,
        precision: 100,
        mantissa: 2,
    },
    PLN: {
        symbol: 'zł',
        title: 'Złoty',
        code: CurrencyCode.PLN,
        precision: 100,
        mantissa: 2,
    },
    HUF: {
        symbol: 'Ft',
        title: 'Magyar forint',
        code: CurrencyCode.HUF,
        precision: 100,
        mantissa: 2,
    },
    RON: {
        symbol: 'L',
        title: 'Leu românesc',
        code: CurrencyCode.RON,
        precision: 100,
        mantissa: 2,
    },
} as const

export const formatCurrency = (amount: number | string, code: CurrencyCode) => {
    const c = Currencies[code]    
    return numbro(amount).format({ mantissa: c?.mantissa, thousandSeparated: true })
}

export const getCurrency = (unit: MintUnit) => {
    if (!unit) {
        unit = 'sat'
    }

    const currencyCode = MintUnitCurrencyPairs[unit]

    if(!currencyCode) {
        throw new AppError(Err.VALIDATION_ERROR, `Currency unit ${unit} is not yet supported by Minibits. Submit request to support on our Github.`)
    }

    const currencyData = Currencies[currencyCode]

    if (!currencyData) {
        throw new AppError(Err.VALIDATION_ERROR, `Currency code ${currencyCode} is not properly configured by Minibits. Submit issue on our Github.`)
    }

    return currencyData as CurrencyData
}