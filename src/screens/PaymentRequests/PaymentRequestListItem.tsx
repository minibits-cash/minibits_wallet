import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST } from "@env"
import differenceInSeconds from "date-fns/differenceInSeconds"
import formatDistance from "date-fns/formatDistance"
import { observer } from "mobx-react-lite"
import React from "react"
import { Image, ImageStyle, ScrollView, StyleSheet, TextStyle, View, ViewStyle } from "react-native"
import { Button, Card, Icon, ListItem, Screen, Text } from "../../components"
import { Contact, ContactType } from "../../models/Contact"
import { PaymentRequest, PaymentRequestStatus, PaymentRequestType } from "../../models/PaymentRequest"
import { NostrClient } from "../../services"
import { colors, spacing, typography, useThemeColor } from "../../theme"
import { getImageSource } from '../../utils/utils'
import { ContactListItem } from "../Contacts/ContactListItem"
import { CurrencyCode, CurrencySign } from "../Wallet/CurrencySign"


export interface PaymentRequestListProps {
  pr: PaymentRequest
  isFirst: boolean
  onPressPaymentRequest: any
}

export const PaymentRequestListItem = observer(function (props: PaymentRequestListProps) {
  
    const { pr, isFirst, onPressPaymentRequest } = props
    const hintColor = useThemeColor('textDim')
    const secToExpiry = differenceInSeconds(pr.expiresAt as Date, new Date())
    const expiryBg = ( secToExpiry < 0 ? colors.palette.angry500 : secToExpiry < 60 ? colors.palette.orange400 : colors.palette.success300)
    const separatorColor = useThemeColor('separator')
    
    return (
        <Card
            HeadingComponent={
                <View style={[$headerContainer, {borderBottomColor: separatorColor, borderBottomWidth: 1}]}>
                    <Text
                        text={pr.type === PaymentRequestType.INCOMING ? 'Pay' : 'Pay me'}
                    />
                    <Text                            
                        preset='heading'
                        text={pr.amount.toLocaleString()}
                    /> 
                    <CurrencySign 
                        currencyCode={CurrencyCode.SATS}
                        containerStyle={{marginBottom: spacing.small}}
                    />             
                </View>
            }
            ContentComponent={
                <>
                    {pr.type === PaymentRequestType.INCOMING ? (
                        <>
                            <View style={{borderBottomColor: separatorColor, borderBottomWidth: 1}}>                                
                                <ContactListItem 
                                    contact={pr.contactFrom} 
                                    isFirst={true} 
                                    gotoContactDetail={undefined}                        
                                />                                
                            </View>
                            {pr.description && (
                                <View style={{borderBottomColor: separatorColor, borderBottomWidth: 1, paddingLeft: 8}}>
                                    <ListItem
                                        leftIcon="faInfoCircle"                                        
                                        text={pr.description}
                                        textStyle={{fontSize: 14, marginLeft: 8}}                                            
                                    />                                    
                                </View>
                            )}
                        </>
                    ) : (
                        <>
                            {pr.contactTo && (
                                <View style={{borderBottomColor: separatorColor, borderBottomWidth: 1}}>
                                    <ContactListItem 
                                        contact={pr.contactTo} 
                                        isFirst={true} 
                                        gotoContactDetail={undefined}                        
                                    />
                                </View>
                            )}
                            {pr.description && (
                                <View style={{borderBottomColor: separatorColor, borderBottomWidth: 1, paddingLeft: 8}}>
                                    <ListItem
                                        leftIcon="faInfoCircle"                                        
                                        text={pr.description}
                                        textStyle={{fontSize: 14, marginLeft: 8}}                                            
                                    />                                    
                                </View>
                            )}
                        </>
                    )}
                    {pr.status === PaymentRequestStatus.ACTIVE ? (
                        <Text 
                            style={[$expiry, {backgroundColor: expiryBg}]} 
                            text={`Expire${secToExpiry > 0 ? 's' : 'd'} ${formatDistance(pr.expiresAt as Date, new Date(), {addSuffix: true})}`} 
                            size='xxs'
                        />
                    ) : (
                        <Text 
                            style={[$expiry, {backgroundColor: colors.palette.success300}]} 
                            text={pr.status === PaymentRequestStatus.PAID ? `Request has been paid` : ''} 
                            size='xxs'
                        /> 
                    )}
                </>
            }
            FooterComponent={
                <View style={$buttonContainer}>                    
                    {pr.status === PaymentRequestStatus.ACTIVE && (
                        <Button 
                            preset="secondary"
                            text={pr.type === PaymentRequestType.INCOMING ? 'Pay from wallet' : 'Receive in person'}
                            onPress={onPressPaymentRequest}
                        />
                    )}                                       
                </View>
            }
            style={$card}
        />
    )
})


const $headerContainer: TextStyle = {
    // justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.medium,    
    // marginBottom: spacing.small,
    // height: spacing.screenHeight * 0.18,
}
  
const $expiry: ViewStyle = {
    paddingHorizontal: spacing.small,
    borderRadius: spacing.tiny,
    alignSelf: 'center',
    marginVertical: spacing.small,
}


const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
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

const $card: ViewStyle = {
    marginBottom: spacing.small,  
}
  
