import formatDistance from "date-fns/formatDistance"
import { observer } from "mobx-react-lite"
import React from "react"
import { Image, ImageStyle, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { Button, Icon, ListItem, Screen, Text } from "../../components"
import { Contact, ContactType } from "../../models/Contact"
import { NostrClient } from "../../services"
import { colors, spacing, typography, useThemeColor } from "../../theme"


export interface ContactListProps {
  Contact: Contact  
}

export const ContactListItem = observer(function (props: {contact: Contact, isFirst: boolean, gotoContactDetail: any}) {
  
    const { contact } = props

    const getImageSource = function(img: string) {
        if(img.startsWith('http') || img.startsWith('https')) {
            return img
        } else {
            return `data:image/png;base64,${img}`
        }
    }
  
    return (
      <ListItem
        key={contact.pubkey}                      
        text={contact.name as string}        
        textStyle={$mintText}
        subText={contact.nip05handle}        
        LeftComponent={<Image style={[$iconContainer, {width: 40, height: 43}]} source={{uri: getImageSource(contact.picture as string)}} />}  
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
  
