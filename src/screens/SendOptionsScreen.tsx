import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback, useEffect} from 'react'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import {spacing, useThemeColor, colors} from '../theme'
import {WalletStackScreenProps} from '../navigation'
import {
  Button,
  Icon,
  Card,
  Screen,
  InfoModal,
  ErrorModal,
  ListItem,
  BottomModal,
  Text,
  ScanIcon,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError from '../utils/AppError'
import { IncomingDataType } from '../services/incomingParser'
import { SvgXml } from 'react-native-svg'
import { NutIcon } from '../components/NutIcon'

export enum SendOption {
    SEND_TOKEN = 'SEND_TOKEN',
    PASTE_OR_SCAN_INVOICE = 'PASTE_OR_SCAN_INVOICE',
    SHOW_TOKEN = 'SHOW_TOKEN',
    PAY_PAYMENT_REQUEST = 'PAY_PAYMENT_REQUEST',
    LNURL_PAY = 'LNURL_PAY',
    DONATION = 'DONATION',
}

export const SendOptionsScreen: FC<WalletStackScreenProps<'SendOptions'>> = observer(
  function SendOptionsScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })
 
    const [error, setError] = useState<AppError | undefined>()

    const gotoContacts = function () {
        navigation.navigate('ContactsNavigator', {
            screen: 'Contacts', 
            params: {paymentOption: SendOption.SEND_TOKEN}})
    }


    const gotoSend = function () {
        navigation.navigate('Send', {            
            paymentOption: SendOption.SHOW_TOKEN}
        )
    }


    const onScan = async function () {
        navigation.navigate('Scan')
    }


    const handleError = function (e: AppError): void {
      log.error(e.name, e.message)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
            <Text
              preset="heading"
              tx="sendScreen.title"
              style={{color: 'white'}}
            />
        </View>
        <View style={$contentContainer}>          
            <Card
                style={$optionsCard}
                ContentComponent={
                    <>
                    <ListItem
                        tx="sendScreen.sendToContact"
                        subTx="sendScreen.sendToContactDescription"
                        leftIcon='faPaperPlane'
                        leftIconColor={colors.palette.secondary300}
                        leftIconInverse={true}
                        style={$item}
                        bottomSeparator={true}
                        onPress={gotoContacts}
                    />                 
                    <ListItem
                        tx="sendScreen.showOrShareToken"
                        subTx="sendScreen.showOrShareTokenDescription"
                        leftIcon='faQrcode'
                        leftIconColor={colors.palette.iconViolet300}
                        LeftComponent={
                            <View
                                style={{
                                    marginEnd: spacing.small,
                                    flex: 0,
                                    borderRadius: spacing.small,
                                    padding: spacing.extraSmall,
                                    backgroundColor: colors.palette.iconViolet300
                                }}
                            >
                                <SvgXml 
                                    width={spacing.medium} 
                                    height={spacing.medium} 
                                    xml={NutIcon}
                                    fill='white'
                                />
                            </View>
                        }
                        style={$item}
                        onPress={gotoSend}
                    />
                    <ListItem
                        tx="sendScreen.scanToSend"
                        subTx="sendScreen.scanToSendDescription"
                        LeftComponent={
                            <View
                                style={{
                                    marginEnd: spacing.small,
                                    flex: 0,
                                    borderRadius: spacing.small,
                                    padding: spacing.extraSmall,
                                    backgroundColor: colors.palette.success200
                                }}
                            >
                                <SvgXml 
                                    width={spacing.medium} 
                                    height={spacing.medium} 
                                    xml={ScanIcon}
                                    fill='white'
                                />
                            </View>
                        } 
                        // leftIcon='faBolt'
                        // leftIconColor={colors.palette.success200}
                        // leftIconInverse={true}
                        topSeparator={true}
                        style={$item}                    
                        onPress={onScan}
                    />   
                    </>
              }

            />
        </View>
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $optionsCard: ViewStyle = {
  marginTop: -spacing.extraLarge * 2,
  marginBottom: spacing.small,
  // paddingTop: 0,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $amountContainer: ViewStyle = {
  alignItems: 'center',
  justifyContent: 'center',
}

const $amountToReceive: TextStyle = {
  flex: 1,
  paddingTop: spacing.extraLarge + 10,
  fontSize: 52,
  fontWeight: '400',
  textAlignVertical: 'center',
  color: 'white',
}
