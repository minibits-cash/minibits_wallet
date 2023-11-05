import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST } from "@env"
import formatDistance from "date-fns/formatDistance"
import { observer } from "mobx-react-lite"
import React from "react"
import { Image, ImageStyle, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { Button, Icon, ListItem, Screen, Text } from "../../components"
import { Contact, ContactType } from "../../models/Contact"
import { PaymentRequest, PaymentRequestType } from "../../models/PaymentRequest"
import { NostrClient } from "../../services"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import { getImageSource } from '../../utils/utils'


export interface PaymentRequestListProps {
  pr: PaymentRequest
  isFirst: boolean
  onPressPaymentRequest: any
}

export const PaymentRequestListItem = observer(function (props: PaymentRequestListProps) {
  
    const { pr, isFirst, onPressPaymentRequest } = props

    if (pr.type === PaymentRequestType.INCOMING) {
        return (
            <ListItem
                key={pr.paymentHash}                      
                text={pr.description as string}        
                textStyle={$prText}
                subText={`${pr.sentFrom} · ${pr.status} · Expires ${formatDistance(pr.expiresAt as Date, new Date(), {addSuffix: true})}`}       
                LeftComponent={<Image style={[
                    $iconContainer, {
                        width: 40, 
                        height: pr.sentFrom?.includes(MINIBITS_NIP05_DOMAIN) ? 43 :  40,
                        borderRadius: pr.sentFrom?.includes(MINIBITS_NIP05_DOMAIN) ? 0 :  20,
                    }]} 
                    source={{uri: MINIBITS_SERVER_API_HOST + '/profile/avatar/' + pr.sentFromPubkey}} />
                }  
                RightComponent={
                    <Text style={{marginHorizontal: spacing.small}} text={pr.amount.toLocaleString()}/>
                }          
                topSeparator={isFirst ? false : true}
                style={$item}
                onPress={() => onPressPaymentRequest(pr)}
            />
        )
    } else {
        return(
            <ListItem
                key={pr.paymentHash}                      
                text={pr.description as string}        
                textStyle={$prText}
                subText={`${pr.sentTo || ''} · ${pr.status} · Expires ${formatDistance(pr.expiresAt as Date, new Date(), {addSuffix: true})}`}       
                LeftComponent={<Image style={[
                    $iconContainer, {
                        width: 40, 
                        height: pr.sentFrom?.includes(MINIBITS_NIP05_DOMAIN) ? 43 :  40,
                        borderRadius: pr.sentFrom?.includes(MINIBITS_NIP05_DOMAIN) ? 0 :  20,
                    }]} 
                    source={{uri: MINIBITS_SERVER_API_HOST + '/profile/avatar/' + pr.sentFromPubkey}} />
                }  
                RightComponent={
                    <Text style={{marginHorizontal: spacing.small}} text={pr.amount.toLocaleString()}/>
                }          
                topSeparator={isFirst ? false : true}
                style={$item}
                onPress={() => onPressPaymentRequest(pr)}
            />
        )
    }
  

})



  
const $item: ViewStyle = {
    marginHorizontal: spacing.micro,
}


const $iconContainer: ImageStyle = {
    padding: spacing.extraSmall,
    alignSelf: "center",
    marginRight: spacing.medium,
}

const $prText: TextStyle = {
    overflow: 'hidden', 
    fontSize: 14,  
}
  
