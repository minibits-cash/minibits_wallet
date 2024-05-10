import React from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
import {Button, Icon, IconTypes, ListItem, Screen, Text} from '../../components'
import {colors, spacing, typography, useThemeColor} from '../../theme'
import {translate} from '../../i18n'
import { Currencies, CurrencyCode, formatCurrency, getCurrency } from '../../services/wallet/currency'



export const FeeBadge = function (props: {
  currencyCode: CurrencyCode
  estimatedFee: number
  finalFee: number
  containerStyle?: ViewStyle
  textStyle?: TextStyle
}) {
  const textColor = useThemeColor('header')
  const bgColor = colors.palette.primary200

  return (
    <View
      style={[
        {
          alignSelf: 'center',
          marginTop: spacing.tiny,
          paddingHorizontal: spacing.tiny,
          borderRadius: spacing.tiny,
          backgroundColor: bgColor,
        },
        props.containerStyle || {},
      ]}>
      <Text
        text={
          props.finalFee
            ? translate('walletScreen.feeBadge.final', {fee: formatCurrency(props.finalFee, props.currencyCode), code: props.currencyCode})
            : translate('walletScreen.feeBadge.upto', {fee: formatCurrency(props.estimatedFee, props.currencyCode), code: props.currencyCode})
        }
        style={[
          {
            color: textColor,
            fontSize: 10,
            fontFamily: typography.primary?.light,
            padding: 0,
            lineHeight: 16,
          },
          props.textStyle || {},
        ]}
      />
    </View>
  )
}
