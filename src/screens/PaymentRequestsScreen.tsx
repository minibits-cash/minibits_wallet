import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {
  ImageStyle,
  TextStyle,
  ViewStyle,
  View,
  ScrollView,
  Alert,
  Image,
} from 'react-native'
import {formatDistance, toDate} from 'date-fns'
import {useThemeColor, spacing, colors, typography} from '../theme'
import {
  Button,
  Icon,
  Screen,
  Text,
  Card,
  ListItem,
  ErrorModal,
  InfoModal,
  Loading,
} from '../components'
import {WalletStackScreenProps} from '../navigation'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError from '../utils/AppError'
import { PaymentRequest } from '../models/PaymentRequest'
import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST } from '@env'
import { SendOption } from './SendOptionsScreen'

interface PaymentRequestsScreenProps
  extends WalletStackScreenProps<'PaymentRequests'> {}



export const PaymentRequestsScreen: FC<PaymentRequestsScreenProps> = observer(function PaymentRequestsScreen(_props) {
    const {navigation} = _props
    const {paymentRequestsStore} = useStores()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        onDeleteExpired()
    }, [])
      
    const onDeleteExpired = function() {
        paymentRequestsStore.removeExpired()
    }


    const onPressPaymentRequest = function(paymentRequest: PaymentRequest) {
        navigation.navigate('Transfer', {
            paymentRequest, 
            paymentOption: SendOption.PAY_PAYMENT_REQUEST
        })
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const hintColor = useThemeColor('textDim')
    const activeIconColor = useThemeColor('button')
    

    return (
      <Screen style={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Payment requests" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
          {/*<Card
            style={$actionCard}
            ContentComponent={
                <ListItem
                  text={'Delete expired'}
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon='faXmark'
                      size={spacing.medium}
                      color={iconColor}
                    />
                  }                  
                  style={$item}
                  // bottomSeparator={true}
                  onPress={onDeleteExpired}
                />
            }
            />*/}
          {paymentRequestsStore.count > 0 ? (
            <Card
              ContentComponent={
                <>
                  {paymentRequestsStore.all.map((pr, index: number) => (
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
                        topSeparator={index === 0 ? false : true}
                        style={$item}
                        onPress={() => onPressPaymentRequest(pr)}
                    />
                  ))}                  
                </>
              }              
              style={$card}
            />
          ) : (
            <Card
              content={'There are no payment requests to be paid or they have already expired.'}
              contentStyle={{color: hintColor, padding: spacing.small}}
              style={$card}
            />
          )}
          {isLoading && <Loading />}
        </View>
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  // borderWidth: 1,
  // borderColor: 'red'
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.1,
}

const $contentContainer: TextStyle = {
  minHeight: spacing.screenHeight * 0.5,
  padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
  marginBottom: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 2,
  paddingTop: 0,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingVertical: 0,
}


const $iconContainer: ImageStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}


const $txAmount: TextStyle = {
  fontFamily: typography.primary?.medium,
  alignSelf: 'center',
  marginRight: spacing.small,
}

  
const $prText: TextStyle = {
    overflow: 'hidden', 
    fontSize: 14,  
}


