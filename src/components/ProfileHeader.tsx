import { observer } from "mobx-react-lite"
import React from "react"
import { useStores } from "../models"
import { translate } from "../i18n"
import { AvatarHeader } from "./AvatarHeader"
import { StyleProp, TextStyle } from "react-native"


export interface ProfileHeaderProps {
  headerBg?: string
  headerTextStyle?: StyleProp<TextStyle>
}

export const ProfileHeader = observer(function (props: ProfileHeaderProps) {
  const { walletProfileStore } = useStores()
  const { picture, nip05 } = walletProfileStore

  return ( <AvatarHeader
    text={nip05 || translate("common.notCreated")}
    textStyle={props.headerTextStyle}
    picture={picture}
    fallbackIcon="faCircleUser"
    headerBgColor={props.headerBg}
    pictureHeight={walletProfileStore.isOwnProfile ? 90 : 96}
  />)
})
