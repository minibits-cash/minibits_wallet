import numbro from 'numbro'

export const formatNumber = (amount: number | string, mantissa: number) => {
  return numbro(amount).format({
    mantissa,
    thousandSeparated: true,
    //trimMantissa: true,
  })
}

export const toNumber = (value: string) => {
  return numbro(value).value()
}

export const round = (number: number, decimals: number) => {
  const factorOfTen = Math.pow(10, decimals)
  return Math.round(number * factorOfTen) / factorOfTen
}

export const roundUp = (number: number, decimals: number) => {
  const factorOfTen = Math.pow(10, decimals)
  return Math.ceil(number * factorOfTen) / factorOfTen
}

export const roundDown = (number: number, decimals: number) => {
  const factorOfTen = Math.pow(10, decimals)
  return Math.floor(number * factorOfTen) / factorOfTen
}
