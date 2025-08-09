import numbro from 'numbro'
import { BtcIcon, EurIcon, UsdIcon, CadIcon } from '../../components'
import AppError, { Err } from '../../utils/AppError'
import { log } from '../logService'
import { ExchangeRate } from '../../models/WalletStore'


export type MintUnit = typeof MintUnits[number]
export const MintUnits = ['btc', 'sat', 'msat', 'usd', 'eur'] as const

export enum CurrencyCode {
    BTC = 'BTC', SAT = 'SAT', MSAT = 'MSAT', EUR = 'EUR', GBP = 'GBP', 
    CZK = 'CZK', USD = 'USD', PLN = 'PLN', HUF = 'HUF', RON = 'RON',
    CAD = 'CAD'
}

export type MintUnitCurrencyPair = {
    [key in MintUnit]: CurrencyCode
}

export const MintUnitCurrencyPairs: MintUnitCurrencyPair = {
  btc:CurrencyCode.BTC, sat:CurrencyCode.SAT, msat:CurrencyCode.MSAT, eur:CurrencyCode.EUR, usd:CurrencyCode.USD,
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
    SAT: {
        symbol: 'SAT',
        title: 'Satoshis',
        code: CurrencyCode.SAT,
        mintUnit: 'sat',
        icon: BtcIcon,
        precision: 1,
        mantissa: 0,
    },
    MSAT: {
        symbol: 'mSAT',
        title: 'Milisatoshis',
        code: CurrencyCode.MSAT,
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
    CAD: {
        symbol: 'CAD',
        title: 'Canadian Dollar',
        code: CurrencyCode.CAD,
        icon: CadIcon,
        precision: 100,
        mantissa: 2,
    },
} as const


export const formatCurrency = (amount: number, code: CurrencyCode) => {
    const c = Currencies[code] 
    if(!c || !c.precision) {
        throw new AppError(Err.VALIDATION_ERROR, `Currency code ${code} is not yet supported by Minibits. Submit request to add it on our Github.`)
    }

    return numbro(amount / c.precision).format({ mantissa: c.mantissa, thousandSeparated: true })
}

export const getCurrency = (unit: MintUnit) => {
    if (!unit) {
        unit = 'sat'
    }

    const currencyCode = MintUnitCurrencyPairs[unit]

    if(!currencyCode) {
        throw new AppError(Err.VALIDATION_ERROR, `Currency unit ${unit} is not yet supported by Minibits. Submit request to add it on our Github.`)
    }

    const currencyData = Currencies[currencyCode]

    if (!currencyData) {
        throw new AppError(Err.VALIDATION_ERROR, `Currency code ${currencyCode} is not properly configured by Minibits. Submit issue on our Github.`)
    }

    return currencyData as CurrencyData
}

export const getCurrencyByCode = (code: CurrencyCode): CurrencyData | undefined => {
    for (const [currencyCode, currencyData] of Object.entries(Currencies)) {
        if (currencyCode === code && currencyData) {
            return currencyData satisfies CurrencyData
        }
    }
    return void 0;
}

export const convertToFromSats = (amount: number, currencyFrom: CurrencyCode, satExchangeRate: ExchangeRate) => {
    // exchangeRate is always 1 fiat precision unit (cent) in SAT {currency: 'EUR', rate: 15.69} 

    if(currencyFrom === CurrencyCode.SAT) {
        return amount / satExchangeRate.rate
    }

    return amount * satExchangeRate.rate
}

export const convertToSatsFrom = (amount: number, currencyFrom: CurrencyCode, satExchangeRate: ExchangeRate) => {
    // exchangeRate is always 1 fiat precision unit (cent) in SAT {currency: 'EUR', rate: 15.69} 

    if(currencyFrom === CurrencyCode.SAT) {
        return amount * satExchangeRate.rate
    }

    return amount / satExchangeRate.rate
    
}