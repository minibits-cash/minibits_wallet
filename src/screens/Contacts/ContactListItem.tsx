import { formatDistance } from 'date-fns'
import { observer } from "mobx-react-lite"
import React from "react"
import { Image, ImageStyle, TextStyle, View, ViewStyle } from "react-native"
import { ListItem } from "../../components"
import { Contact } from "../../models/Contact"
import { spacing } from "../../theme"
import { getImageSource } from '../../utils/utils'
import FastImage from 'react-native-fast-image'


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
        text={contact.noteToSelf || contact.name as string}        
        textStyle={$mintText}
        subText={contact.nip05}        
        LeftComponent={
            <View style={{}}>
                <FastImage 
                    style={[$iconContainer, {
                        width: 40, 
                        height: contact.isExternalDomain ? 40 :  43,
                        borderRadius: 20,
                    }] as import("react-native-fast-image").ImageStyle}
                    source={{uri: getImageSource(contact.picture as string)}} 
                />
                {/*contact.lud16 && (
                    <Text text='⚡' size='xs' style={{marginTop: -spacing.small}}/>
                )*/}                
            </View>
        }  
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
    alignSelf: 'center',
    marginRight: spacing.medium,
  }
  
