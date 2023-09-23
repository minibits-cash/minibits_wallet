import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
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
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../utils/logger'
import AppError from '../utils/AppError'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { DecodedLightningInvoice, decodeInvoice, findEncodedLightningInvoice } from '../services/cashuHelpers'
import { infoMessage } from '../utils/utils'

export enum SendOption {
    SEND_TOKEN = 'SEND_TOKEN',
    PASTE_OR_SCAN_INVOICE = 'PASTE_OR_SCAN_INVOICE',
    SHOW_TOKEN = 'SHOW_TOKEN',
}

export const SendOptionsScreen: FC<WalletStackScreenProps<'SendOptions'>> = observer(
  function SendOptionsScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const isInternetReachable = useIsInternetReachable()    
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


    const onPaste = async function () {
        const maybeInvoice = await Clipboard.getString()
        if (!maybeInvoice) {
            infoMessage('Please copy the invoice first.')
        }

        try {
            const encodedInvoice = findEncodedLightningInvoice(maybeInvoice)

            if(encodedInvoice) {
                const decoded: DecodedLightningInvoice = decodeInvoice(encodedInvoice)
                infoMessage('Found lightning invoice in the clipboard.')                
                setTimeout(() => navigation.navigate('Transfer', {encodedInvoice}), 1000)   //TODO rename
                return
            }

            infoMessage('Your clipboard does not contain a lightning invoice.')            
        } catch (e: any) {
            handleError(e)
        }
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
                  {/*<ListItem
                    tx="sendScreen.pasteToSend"
                    subTx="sendScreen.pasteToSendDescription"
                    leftIcon='faClipboard'
                    leftIconColor={colors.palette.iconGreyBlue400}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={onPaste}
                  />*/}
                  <ListItem
                    tx="sendScreen.showOrShareToken"
                    subTx="sendScreen.showOrShareTokenDescription"
                    leftIcon='faQrcode'
                    leftIconColor={colors.palette.success200}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoSend}
                  />
                  <ListItem
                    tx="sendScreen.scanToSend"
                    subTx="sendScreen.scanToSendDescription"
                    leftIcon='faBolt'
                    leftIconColor={colors.palette.accent300}
                    leftIconInverse={true}
                    style={$item}                    
                    onPress={onScan}
                  />
                </>
              }
              FooterComponent={
                <Button 
                    onPress={onPaste}
                    tx='sendScreen.pasteToSend'
                    preset='tertiary'
                    textStyle={{fontSize: 14, color: iconColor}}
                    style={{alignSelf: 'flex-start', marginLeft: 33}}
                />
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
  paddingTop: 0,
}

const $card: ViewStyle = {
  // marginTop: - spacing.extraLarge * 2,
  marginBottom: spacing.small,
  paddingTop: 0,
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
