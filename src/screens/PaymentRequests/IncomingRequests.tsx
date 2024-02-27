import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {
  ImageStyle,
  TextStyle,
  ViewStyle,
  View,
  Image,
  FlatList,
} from 'react-native'
import {formatDistance, toDate} from 'date-fns'
import {useThemeColor, spacing, colors, typography} from '../../theme'
import {
  Screen,
  Text,
  Card,
  ListItem,
  ErrorModal,
  InfoModal,
  Loading,
} from '../../components'
import {WalletStackParamList, WalletStackScreenProps} from '../../navigation'
import {useHeader} from '../../utils/useHeader'
import {useStores} from '../../models'
import AppError from '../../utils/AppError'
import { PaymentRequest } from '../../models/PaymentRequest'
import { MINIBITS_NIP05_DOMAIN, MINIBITS_SERVER_API_HOST } from '@env'
import { SendOption } from '../SendOptionsScreen'
import { StackNavigationProp } from '@react-navigation/stack'
import { PaymentRequestListItem } from './PaymentRequestListItem'


export const IncomingRequests = observer(function (props: {
    navigation: StackNavigationProp<WalletStackParamList, "PaymentRequests", undefined>,       
}) {    
    const {navigation} = props
    const {paymentRequestsStore} = useStores()

    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        onDeleteExpired()
    }, [])
      
    const onDeleteExpired = function() {
        paymentRequestsStore.removeExpired()
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
    <Screen contentContainerStyle={$screen}>
        <View style={$contentContainer}>          
          {paymentRequestsStore.allIncoming.length > 0 ? (            
            <FlatList<PaymentRequest>
                data={paymentRequestsStore.allIncoming}
                renderItem={({ item, index }) => {                                
                    return(
                        <PaymentRequestListItem                                        
                            pr={item}
                            isFirst={index === 0}                            
                            navigation={navigation}                                               
                        />
                    )
                }}
                keyExtractor={(item) => item.paymentHash} 
                style={{ flexGrow: 0  }}
            />
          ) : (
            <Card
                content={'There are no incoming payment requests to be paid or they have already expired.'}
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
    flex: 1
}

const $contentContainer: TextStyle = {  
  padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
  marginBottom: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 2,
  paddingTop: 0,
}

const $card: ViewStyle = {
  marginBottom: 0,  
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


