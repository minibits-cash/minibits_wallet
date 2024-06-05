import {observer} from 'mobx-react-lite'
import React, {FC, useState} from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
import { SvgXml } from 'react-native-svg'
import {spacing, useThemeColor, colors} from '../theme'
import {WalletStackScreenProps} from '../navigation'
import {
  Card,
  Screen,
  InfoModal,
  ErrorModal,
  ListItem,
  Text,
  ScanIcon,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError from '../utils/AppError'
import useIsInternetReachable from '../utils/useIsInternetReachable'

export enum ReceiveOption {
    // CREATE_AND_SEND_PAYMENT_REQUEST = 'CREATE_AND_SEND_PAYMENT_REQUEST',
    SEND_PAYMENT_REQUEST = 'SEND_PAYMENT_REQUEST',
    PASTE_OR_SCAN_TOKEN = 'PASTE_OR_SCAN_TOKEN',
    SHOW_INVOICE = 'SHOW_INVOICE',
    LNURL_WITHDRAW = 'LNURL_WITHDRAW'
}

export const ReceiveOptionsScreen: FC<WalletStackScreenProps<'ReceiveOptions'>> = observer(
  function ReceiveOptionsScreen({route, navigation}) {
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })


    const isInternetReachable = useIsInternetReachable()    

    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()

    const gotoContacts = function () {
        navigation.navigate('ContactsNavigator', {
            screen: 'Contacts', 
            params: {
              paymentOption: ReceiveOption.SEND_PAYMENT_REQUEST
            }
        })
    }


    const gotoTopup = function () {
      navigation.navigate('Topup', { paymentOption: ReceiveOption.SHOW_INVOICE })
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
                        onPress={gotoContacts}
                    />
                    <ListItem
                        tx="receiveScreen.showOrShareInvoice"
                        subTx="receiveScreen.showOrShareInvoiceDescription"
                        leftIcon='faBolt'
                        leftIconColor={colors.palette.orange200}
                        leftIconInverse={true}
                        style={$item}                        
                        onPress={gotoTopup}
                    />
                    <ListItem
                        tx="receiveScreen.scanToReceive"
                        subTx="receiveScreen.scanToReceiveDescription"
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
                        // leftIcon='faQrcode'
                        // leftIconColor={colors.palette.success200}
                        // leftIconInverse={true}
                        style={$item} 
                        topSeparator={true}                   
                        onPress={onScan}
                    />
                </>
              }
            />
        </View>        
        {info && <InfoModal message={info} />}
        {error && <ErrorModal error={error} />}
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
  height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
  // flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $optionsCard: ViewStyle = {
  marginTop: -spacing.extraLarge * 2,
  marginBottom: spacing.small,
  //paddingTop: 0,
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
