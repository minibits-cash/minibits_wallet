import React from "react"
import { View, Text } from "react-native"

interface CollapsibleProps {
  summary?: string
  text: string
  collapsed?: boolean
}
export const CollapsibleText = (props: CollapsibleProps) => {
  const [collapsed, setCollapsed] = React.useState(props?.collapsed ?? false)
  let summary = props?.summary

  if (!summary) {
    if (summary?.includes("\n")) {
      summary = summary.split("\n")[0]
    } else {
      summary = props?.text.slice(0, 100)
    }
  }
  summary + "\u2026" // add a unicode ellipsis character
  return (
    <View>
      {props?.collapsed ? (
        <Text onPress={() => setCollapsed(false)}>{summary}</Text>
      ) : (
        <Text onPress={() => setCollapsed(true)}>{props.text}</Text>
      )}
    </View>
  )
}