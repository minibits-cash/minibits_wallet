import formatDistance from "date-fns/formatDistance"
import { observer } from "mobx-react-lite"
import React from "react"
import { Image, ImageStyle, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { Button, Icon, ListItem, Screen, Text } from "../../components"
import { Contact, ContactType } from "../../models/Contact"
import { NostrClient } from "../../services"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import { getImageSource } from '../../utils/utils'


export interface ContactListProps {
  contact: Contact,
  isFirst: boolean, 
  gotoContactDetail: any
}

export const ContactListItem = observer(function (props: ContactListProps) {
  
    const { contact } = props
  
    return (
      <ListItem
        key={contact.pubkey}                      
        text={contact.name as string}        
        textStyle={$mintText}
        subText={contact.noteToSelf || contact.nip05}        
        LeftComponent={<Image style={[
            $iconContainer, {
                width: 40, 
                height: contact.isExternalDomain ? 40 :  43,
                borderRadius: 20,
            }]} source={{uri: getImageSource(contact.picture as string)}} />}  
        RightComponent={
          <></>
        }          
        topSeparator={props.isFirst ? false : true}
        style={$item}
        onPress={() => props.gotoContactDetail(contact.pubkey)}
      />
    )
})



  
  const $item: ViewStyle = {
    marginHorizontal: spacing.micro,
  }
  
  const $mintText: TextStyle = {
    overflow: 'hidden', 
    fontSize: 14,  
  }

  const $iconContainer: ImageStyle = {
    padding: spacing.extraSmall,
    alignSelf: "center",
    marginRight: spacing.medium,
  }
  
