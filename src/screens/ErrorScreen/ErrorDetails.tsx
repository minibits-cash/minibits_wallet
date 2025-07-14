import React, { ErrorInfo } from "react"
import { ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { Button, Icon, Screen, Text } from "../../components"
import { colors, spacing } from "../../theme"

export interface ErrorDetailsProps {
  error: Error
  errorInfo: ErrorInfo | null
  onReset(): void
}

export function ErrorDetails(props: ErrorDetailsProps) {
  
  return (
    
    <Screen
      preset="fixed"
      // safeAreaEdges={["top", "bottom"]}
      contentContainerStyle={$contentContainer}
    >
      <View style={$topSection}>
        <Icon icon="faInfoCircle" size={64} />
        <Text style={$heading} preset="subheading" tx="errorScreen_title" />
        <Text tx="errorScreen_friendlySubtitle" />
      </View>

      <ScrollView style={$errorSection} contentContainerStyle={$errorSectionContentContainer}>
        <Text selectable style={$errorContent} text={`${props.error}`.trim()} />
        <Text
          selectable
          style={$errorBacktrace}
          text={`${props.errorInfo?.componentStack}`.trim()}
        />
      </ScrollView>

      <Button
        preset="secondary"
        style={$resetButton}
        onPress={props.onReset}
        tx="errorScreen_reset"
      />
  </Screen>
  )

}

const $contentContainer: ViewStyle = {
    alignItems: "center",
    padding: spacing.large,
    paddingTop: spacing.extraLarge,  
}

const $topSection: ViewStyle = {
  // flex: 1,
    alignItems: "center",
}

const $heading: TextStyle = {  
  marginVertical: spacing.medium,
  fontWeight: '800',
}

const $errorSection: ViewStyle = {
  // flex: 2,
  maxHeight: spacing.screenHeight * 0.5,
  backgroundColor: colors.palette.neutral200,
  marginVertical: spacing.medium,
  borderRadius: 6,
}

const $errorSectionContentContainer: ViewStyle = {
  padding: spacing.medium,
}

const $errorContent: TextStyle = {
  color: colors.palette.neutral800,
  fontWeight: '800',
}

const $errorBacktrace: TextStyle = {
  marginTop: spacing.medium,
  color: colors.palette.neutral500,
}

const $resetButton: ViewStyle = {
  backgroundColor: colors.palette.angry500,
  paddingHorizontal: spacing.huge,
}
