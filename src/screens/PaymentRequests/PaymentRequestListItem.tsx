import {MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST} from '@env'
import {differenceInSeconds} from 'date-fns/differenceInSeconds'
import {formatDistance} from 'date-fns/formatDistance'
import {observer} from 'mobx-react-lite'
import React from 'react'
import {
  Image,
  ImageStyle,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native'
import {Button, Card, Icon, ListItem, Screen, Text} from '../../components'
import {
  PaymentRequest,
  PaymentRequestStatus,
  PaymentRequestType,
} from '../../models/PaymentRequest'
import {log} from '../../services'
import {colors, spacing, useThemeColor} from '../../theme'
import {getImageSource} from '../../utils/utils'
import {SendOption} from '../SendScreen'
import {translate} from '../../i18n'
import { CurrencyAmount } from '../Wallet/CurrencyAmount'

export interface PaymentRequestListProps {
  pr: PaymentRequest
  isFirst: boolean
  navigation: any
  onShowQRModal?: any
}

export const PaymentRequestListItem = observer(function (
  props: PaymentRequestListProps,
) {
  const {pr, isFirst, navigation, onShowQRModal} = props
  const hintColor = useThemeColor('textDim')
  const secToExpiry = differenceInSeconds(pr.expiresAt as Date, new Date())
  const expiryBg =
    secToExpiry < 0
      ? colors.palette.angry500
      : secToExpiry < 60
      ? colors.palette.orange400
      : colors.palette.success300
  const separatorColor = useThemeColor('separator')

  const onGotoContactDetail = function () {
    log.trace(pr)
    navigation.navigate('ContactsNavigator', {
      screen: 'ContactDetail',
      params: {
        contact:
          pr.type === PaymentRequestType.INCOMING
            ? pr.contactFrom
            : pr.contactTo,
      },
    })
  }

  const onPressPaymentRequest = function () {
    if (pr.type === PaymentRequestType.INCOMING) {
      navigation.navigate('Transfer', {
        paymentRequest: pr,
        paymentOption: SendOption.PAY_PAYMENT_REQUEST,
      })
    } else {
      if (onShowQRModal) {
        onShowQRModal(pr)
      }
    }
  }

  const dim = useThemeColor('textDim')

  return (
    <Card
      HeadingComponent={
        <View
          style={[
            $headerContainer,
            {borderBottomColor: separatorColor, borderBottomWidth: 1},
          ]}>

          {pr.type === PaymentRequestType.INCOMING ? (
            <>
              <Text
                tx={'payCommon.pay'} 
                style={{marginBottom: spacing.small}}               
              />
              <CurrencyAmount
                amount={pr.invoicedAmount}
                mintUnit={pr.invoicedUnit!}
                size='large'
                containerStyle={{marginLeft: -spacing.extraLarge}}                
              />
            </>
          ) : (
            <>
              <Text
                tx={'payCommon.payMe'}  
                style={{marginBottom: spacing.small}}                
              />
              <CurrencyAmount
                amount={pr.amountToTopup!}
                mintUnit={pr.mintUnit!}
                size='large' 
                containerStyle={{marginLeft: -spacing.extraLarge}}                  
              />
            </>
          )}
        </View>
      }
      ContentComponent={
        <>
          {pr.contactFrom && pr.contactTo && (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-around',
                alignItems: 'center',
                marginVertical: spacing.medium,
              }}>
              <View
                style={{
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: 100,
                }}>
                <Image
                  style={[
                    $profileIcon,
                    {
                      width: 40,
                      height: pr.contactTo?.isExternalDomain ? 40 : 43,
                      borderRadius: pr.contactTo?.isExternalDomain ? 20 : 0,
                    },
                  ]}
                  source={{
                    uri: getImageSource(pr.contactTo?.picture as string),
                  }}
                />
                <Text
                  size="xxs"
                  style={{color: dim}}
                  text={pr.contactTo?.name}
                />
              </View>
              <Text
                size="xxs"
                style={{
                  color: dim,
                  textAlign: 'center',
                  marginLeft: 30,
                  marginBottom: 20,
                }}
                text="..........."
              />
              <View style={{flexDirection: 'column', alignItems: 'center'}}>
                <Icon icon="faPaperPlane" size={spacing.medium} color={dim} />
                <Text
                  size="xxs"
                  style={{color: dim, marginBottom: -10}}
                  text={translate('payCommon.pay')}
                />
              </View>
              <Text
                size="xxs"
                style={{
                  color: dim,
                  textAlign: 'center',
                  marginRight: 30,
                  marginBottom: 20,
                }}
                text="..........."
              />
              <View
                style={{
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: 100,
                }}>
                {pr.contactFrom.picture ? (
                  <View style={{borderRadius: 20, overflow: 'hidden'}}>
                    <Image
                      style={[
                        $profileIcon,
                        {
                          width: 40,
                          height: pr.contactFrom.isExternalDomain ? 40 : 43,
                          borderRadius: pr.contactFrom.isExternalDomain
                            ? 20
                            : 0,
                        },
                      ]}
                      source={{
                        uri: getImageSource(pr.contactFrom.picture as string),
                      }}
                    />
                  </View>
                ) : (
                  <Icon icon="faCircleUser" size={38} color={dim} />
                )}
                <Text
                  size="xxs"
                  style={{color: dim}}
                  text={pr.contactFrom.name}
                />
              </View>
            </View>
          )}
          {pr.description && (
            <View
              style={{
                borderBottomColor: separatorColor,
                borderBottomWidth: 1,
                paddingLeft: 8,
              }}>
              <ListItem
                leftIcon="faInfoCircle"
                text={pr.description}
                textStyle={{fontSize: 14, marginLeft: 8}}
                topSeparator={true}
              />
            </View>
          )}
          {pr.status === PaymentRequestStatus.ACTIVE ? (
            <Text
              style={[$expiry, {backgroundColor: expiryBg}]}
              text={
                translate(
                  secToExpiry > 0
                    ? 'paymentRequestScreen.listItem.expires'
                    : 'paymentRequestScreen.listItem.expired',
                ) +
                ' ' +
                formatDistance(pr.expiresAt as Date, new Date(), {
                  addSuffix: true,
                })
              }
              size="xxs"
            />
          ) : (
            <Text
              style={[$expiry, {backgroundColor: colors.palette.success300}]}
              text={
                pr.status === PaymentRequestStatus.PAID
                  ? translate("paymentRequestScreen.listItem.requestPaymentSuccess")
                  : ''
              }
              size="xxs"
            />
          )}
        </>
      }
      FooterComponent={
        <View style={$buttonContainer}>
          {pr.status === PaymentRequestStatus.ACTIVE && (
            <Button
              preset="secondary"
              tx={
                pr.type === PaymentRequestType.INCOMING
                  ? "payCommon.payFromWallet"
                  : 'payCommon.receiveInPerson'
              }
              onPress={onPressPaymentRequest}
            />
          )}
        </View>
      }
      style={$card}
    />
  )
})

const $profileIcon: ImageStyle = {
  padding: spacing.medium,
}

const $headerContainer: TextStyle = {
  // justifyContent: 'space-between',
  alignItems: 'center',
  paddingHorizontal: spacing.medium,
  // marginBottom: spacing.small,
  // height: spacing.screenHeight * 0.20,
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
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $prText: TextStyle = {
  overflow: 'hidden',
  fontSize: 14,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}
