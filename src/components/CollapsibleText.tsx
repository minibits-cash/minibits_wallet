import React, { useState } from "react"
import { Pressable, View } from "react-native"
import { Text, TextProps } from "./Text"
import { translate } from "../i18n"
import { useThemeColor } from "../theme"
import { Icon } from "./Icon"
import { LayoutAnimation } from "react-native"

interface CollapsibleProps {
  summary?: string
  text: string
  collapsed?: boolean
  textProps?: TextProps
}

const collapsedLines = 2
const maxLines = 50

export const CollapsibleText = (props: CollapsibleProps) => {
  const [collapsed, setCollapsed] = useState(props?.collapsed ?? false)
  const toggleCollapse = () => {
    LayoutAnimation.easeInEaseOut()
    setCollapsed(!collapsed)
  }
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
        <Text text={summary} {...props.textProps} />
      ) : (
        <Pressable onPress={toggleCollapse}>
          <Text
            text={collapsed ? summary : props.text}
            numberOfLines={collapsed ? collapsedLines : maxLines}
            ellipsizeMode="tail"
            {...props.textProps}
          />
          <View style={{ flexDirection: "row" }}>
            <Text tx={collapsed ? 'common.showMore' : 'common.hideMore'} style={{ color: textDim }} size="xs" />
            <Icon icon={collapsed ? 'faChevronDown' : 'faChevronUp'} color={textDim} size={12} />
          </View>
        </Pressable>
      )}
    </View>
  )
}