import React from "react"
import { View, ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"
import { colors, spacing, useThemeColor } from "../theme"
import { Button } from "./Button"
import { Text } from "./Text"
import { Card } from "./Card"
import { Icon } from "./Icon"
import { CurrencyAmount } from "../screens/Wallet/CurrencyAmount"
import { MintUnit } from "../services/wallet/currency"

interface AmountMatchSelectorProps {
  requestedAmount: number
  availableAmount: number
  isExactMatch: boolean
  unit: MintUnit
  onAcceptMatch: () => void
  onCustomSelect: () => void
  onCancel: () => void
}

export const AmountMatchSelector = observer(function AmountMatchSelector(props: AmountMatchSelectorProps) {
  const {
    requestedAmount,
    availableAmount,
    isExactMatch,
    unit,
    onAcceptMatch,
    onCustomSelect,
    onCancel,
  } = props

  const hintColor = useThemeColor('textDim')
  const successColor = colors.palette.success200
  const warningColor = colors.palette.accent400

  return (
    <Card
      style={$container}
      ContentComponent={
        <View style={$content}>
          <View style={$matchInfo}>
            <Icon
              icon={isExactMatch ? "faCheckCircle" : "faTriangleExclamation"}
              color={isExactMatch ? successColor : warningColor}
              size={spacing.medium}
            />
            <Text
              tx={isExactMatch ? "amountExactMatch" : "amountClosestMatch"}
              style={[$matchText, { color: isExactMatch ? successColor : warningColor }]}
              size="sm"
              weight="medium"
            />
          </View>

          <View style={$amountDisplay}>
            <Text
              text="Requested:"
              style={[$labelText, { color: hintColor }]}
              size="xs"
            />
            <CurrencyAmount
              amount={requestedAmount}
              mintUnit={unit}
              size="medium"
            />
          </View>

          <View style={$amountDisplay}>
            <Text
              text="Available:"
              style={[$labelText, { color: hintColor }]}
              size="xs"
            />
            <CurrencyAmount
              amount={availableAmount}
              mintUnit={unit}
              size="medium"
            />
          </View>

          {!isExactMatch && (
            <Text
              tx="amountMatchExplanation"
              style={[{ color: hintColor, textAlign: 'center', marginTop: spacing.small }]}
              size="xs"
            />
          )}

          <View style={$buttonContainer}>
            <Button
              tx={isExactMatch ? "sendContinue" : "acceptClosestMatch"}
              onPress={onAcceptMatch}
              style={[$acceptButton, { marginRight: spacing.small }]}
            />
            
            {!isExactMatch && (
              <Button
                tx="selectCustomAmount"
                preset="secondary"
                onPress={onCustomSelect}
                style={[$customButton, { marginRight: spacing.small }]}
              />
            )}
            
            <Button
              tx="commonCancel"
              preset="tertiary"
              onPress={onCancel}
              style={$cancelButton}
            />
          </View>
        </View>
      }
    />
  )
})

const $container: ViewStyle = {
  marginVertical: spacing.medium,
}

const $content: ViewStyle = {
  alignItems: 'center',
  padding: spacing.medium,
}

const $matchInfo: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  marginBottom: spacing.medium,
}

const $matchText: ViewStyle = {
  marginLeft: spacing.small,
}

const $amountDisplay: ViewStyle = {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  marginBottom: spacing.small,
}

const $labelText: ViewStyle = {
  flex: 1,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
  marginTop: spacing.medium,
  flexWrap: 'wrap',
}

const $acceptButton: ViewStyle = {
  minWidth: 100,
}

const $customButton: ViewStyle = {
  minWidth: 100,
}

const $cancelButton: ViewStyle = {
  minWidth: 80,
}
