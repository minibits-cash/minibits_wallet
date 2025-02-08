import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect} from 'react'
import {
  ImageStyle,
  TextStyle,
  ViewStyle,
  View,  
  FlatList,
} from 'react-native'
import {useThemeColor, spacing, typography} from '../../theme'
import {
  Screen,
  Card,
  ErrorModal,
  InfoModal,
  Loading,
} from '../../components'
import {useStores} from '../../models'
import AppError from '../../utils/AppError'
import { PaymentRequest } from '../../models/PaymentRequest'
import { StackNavigationProp } from '@react-navigation/stack'
import { PaymentRequestListItem } from './PaymentRequestListItem'
import { log } from '../../services'


export const IncomingRequests = observer(function () {        
    const {paymentRequestsStore} = useStores()

    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }

    const hintColor = useThemeColor('textDim')       

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
                        />
                    )
                }}
                keyExtractor={(item) => item.paymentHash} 
                style={{ flexGrow: 0  }}
            />
          ) : (
            <Card
                contentTx='paymentRequestScreen.incoming.noRequests'
                contentStyle={{color: hintColor, padding: spacing.small}}
                style={$card}
            />
          )}
        </View>
        {isLoading && <Loading />}
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


