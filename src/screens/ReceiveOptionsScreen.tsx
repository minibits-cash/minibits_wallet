import {observer} from 'mobx-react-lite'
import React, {FC, useState, useCallback} from 'react'
import {useFocusEffect} from '@react-navigation/native'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { showMessage, hideMessage } from 'react-native-flash-message'
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
import { Token } from '../models/Token'
import { decodeToken, getTokenAmounts } from '../services/cashuHelpers'

export const ReceiveOptionsScreen: FC<WalletStackScreenProps<'ReceiveOptions'>> = observer(
  function ReceiveOptionsScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const isInternetReachable = useIsInternetReachable()

    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()


    const gotoTopup = function () {
        navigation.navigate('Topup', {})
    }


    const onPasteOrScan = async function () {
        const encodedToken = await Clipboard.getString()
        if (!encodedToken) {
            navigation.navigate('Scan')
            return
        }

        try {
            const decoded: Token = decodeToken(encodedToken)
            showMessage({message: 'Found ecash token in the clipboard.', duration: 1000})
            setTimeout(() => navigation.navigate('Receive', {encodedToken}), 1000)   //TODO rename
        } catch (e: any) {
            showMessage({message: 'Your clipboard does not contain an ecash token.', duration: 1000})
            setTimeout(() => navigation.navigate('Scan'), 1000)            
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
              tx="receiveScreen.title"
              style={{color: 'white'}}
            />
        </View>
        <View style={$contentContainer}>          
            <Card
              style={$optionsCard}
              ContentComponent={
                <>
                  <ListItem
                    tx="receiveScreen.sharePaymentRequest"
                    subTx="receiveScreen.sharePaymentRequestDescription"
                    leftIcon='faPaperPlane'
                    leftIconColor={colors.palette.secondary300}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={gotoTopup}
                  />
                  <ListItem
                    tx="receiveScreen.scanOrPasteToReceive"
                    subTx="receiveScreen.scanOrPasteToReceiveDescription"
                    leftIcon='faQrcode'
                    leftIconColor={colors.palette.success200}
                    leftIconInverse={true}
                    style={$item}
                    bottomSeparator={true}
                    onPress={onPasteOrScan}
                  />
                  <ListItem
                    tx="receiveScreen.showOrShareInvoice"
                    subTx="receiveScreen.showOrShareInvoiceDescription"
                    leftIcon='faBolt'
                    leftIconColor={colors.palette.accent300}
                    leftIconInverse={true}
                    style={$item}
                    onPress={gotoTopup}
                  />
                </>
              }
            />
        </View>        
        {info && <InfoModal message={info} />}
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
