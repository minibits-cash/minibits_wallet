import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect} from 'react'
import {
  ImageStyle,
  TextStyle,
  ViewStyle,
  View,  
  FlatList,
  Share,
} from 'react-native'
import {useThemeColor, spacing, typography} from '../../theme'
import {
  Screen,
  Text,
  Card,  
  ErrorModal,
  InfoModal,
  Loading,
  Button,
  Icon,
  BottomModal,
} from '../../components'
import {useStores} from '../../models'
import AppError from '../../utils/AppError'
import { PaymentRequest } from '../../models/PaymentRequest'
import { StackNavigationProp } from '@react-navigation/stack'
import { PaymentRequestListItem } from './PaymentRequestListItem'
import { QRCodeBlock } from '../Wallet/QRCode'
import { useNavigation } from '@react-navigation/native'


export const OutgoingRequests = observer(function () {
    const navigation = useNavigation()
    const {paymentRequestsStore} = useStores()
   
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [selectedRequest, setSelectedRequest] = useState<PaymentRequest | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)   

    useEffect(() => {
        onDeleteExpired()
    }, [])
      
    const onDeleteExpired = function() {
        paymentRequestsStore.removeExpired()
    }

    const toggleQRModal = () => {   
        if(isQRModalVisible) {
            setSelectedRequest(undefined)
        }     
        setIsQRModalVisible(previousState => !previousState)
    }


    const onShowQRModal = function(paymentRequest: PaymentRequest) {
        setSelectedRequest(paymentRequest)        
        toggleQRModal()
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }

    const iconColor = useThemeColor('textDim')
    const hintColor = useThemeColor('textDim')
    const activeIconColor = useThemeColor('button')
    

    return (
      <Screen contentContainerStyle={$screen}>
        <View style={$contentContainer}>
          {paymentRequestsStore.allOutgoing.length > 0 ? (
           
            <FlatList<PaymentRequest>
                data={paymentRequestsStore.allOutgoing}
                renderItem={({ item, index }) => {                                
                    return(
                        <PaymentRequestListItem                                        
                            pr={item}
                            isFirst={index === 0}                            
                            onShowQRModal={onShowQRModal}                                                       
                        />
                    )
                }}
                keyExtractor={(item) => item.paymentHash} 
                style={{ flexGrow: 0  }}
            />               
               
          ) : (
            <Card
              contentTx="paymentRequestScreen.outgoing.noRequests"
              contentStyle={{color: hintColor, padding: spacing.small}}
              style={$card}
            />
          )}          
        </View>
        <BottomModal
            isVisible={isQRModalVisible}
            ContentComponent={
              <QRCodeBlock
                qrCodeData={selectedRequest?.encodedInvoice as string}
                title="Scan and pay to topup"
                type='Bolt11Invoice'
                size={270}
              />
            }
            onBackButtonPress={toggleQRModal}
            onBackdropPress={toggleQRModal}
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
        {isLoading && <Loading />}
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
  marginBottom: spacing.small,  
}

const $bottomModal: ViewStyle = {  
    alignItems: 'center',
    paddingVertical: spacing.large,  
}

const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    padding: spacing.small,
    margin: spacing.small,
    borderRadius: spacing.small
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


