import React, { useState } from "react"
import { Pressable, View } from "react-native"
import { Text } from "./Text"
import { translate } from "../i18n"
import { useThemeColor } from "../theme"
import { Icon } from "./Icon"

interface CollapsibleProps {
  summary?: string
  text: string
  collapsed?: boolean
}

const collapsedLines = 2
const maxLines = 50

export const CollapsibleText = (props: CollapsibleProps) => {
  const [collapsed, setCollapsed] = useState(props?.collapsed ?? false)
  const toggleCollapse = () => setCollapsed(!collapsed)
  const textDim = useThemeColor('textDim')

  let summary = props?.summary
  if (!summary) {
    if (summary?.includes("\n")) {
      summary = summary.split("\n")[0]
    } else {
      summary = props?.text.slice(0, 100)
    }
  }
  // summary += "\u2026" // add a unicode ellipsis character
  return (
    <View>
      {props.text.trim() === '' ? (
        <Text text={summary} />
      ) : (
        <Pressable onPress={toggleCollapse}>
          <Text
            text={collapsed ? summary : props.text}
            numberOfLines={collapsed ? collapsedLines : maxLines}
            ellipsizeMode="tail"
          />
          <View style={{ flexDirection: "row" }}>
            <Text text={collapsed ? translate('common.showMore') : translate('common.hideMore')} style={{ color: textDim }} size="xs" />
            <Icon icon={collapsed ? 'faChevronDown' : 'faChevronUp'} color={textDim} size={12} />
          </View>
        </Pressable>
      )}
    </View>
  )
}