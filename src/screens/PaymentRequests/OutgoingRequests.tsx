import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {
  ImageStyle,
  TextStyle,
  ViewStyle,
  View,
  Image,
  FlatList,
  Share,
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
  Button,
  Icon,
  BottomModal,
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
import QRCode from 'react-native-qrcode-svg'
import { infoMessage } from '../../utils/utils'
import Clipboard from '@react-native-clipboard/clipboard'


export const OutgoingRequests = observer(function (props: {
    navigation: StackNavigationProp<WalletStackParamList, "PaymentRequests", undefined>,       
}) {
    const {navigation} = props
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


    const onShareToApp = async () => {
        try {
          const result = await Share.share({
            message: selectedRequest?.encodedInvoice as string,
          })
  
          if (result.action === Share.sharedAction) {          
            setTimeout(
              () => infoMessage('Lightning invoice has been shared, waiting to be paid by receiver.'),              
              500,
            )
          } else if (result.action === Share.dismissedAction) {
              infoMessage('Sharing cancelled')          
          }
        } catch (e: any) {
          handleError(e)
        }
      }
  
  
      const onCopy = function () {
        try {
          Clipboard.setString(selectedRequest?.encodedInvoice as string)
        } catch (e: any) {
          setInfo(`Could not copy: ${e.message}`)
        }
      }

     

    const onPressPaymentRequest = function(paymentRequest: PaymentRequest) {
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
                            onPressPaymentRequest={() => onPressPaymentRequest(item)}                                                
                        />
                    )
                }}
                keyExtractor={(item) => item.paymentHash} 
                style={{ flexGrow: 0  }}
            />               
               
          ) : (
            <Card
              content={'There are no outgoing payment requests to be paid or they have already expired.'}
              contentStyle={{color: hintColor, padding: spacing.small}}
              style={$card}
            />
          )}
          {isLoading && <Loading />}
        </View>
        <BottomModal
            isVisible={isQRModalVisible}
            ContentComponent={
                <ShareAsQRCodeBlock
                    toggleQRModal={toggleQRModal}
                    invoiceToPay={selectedRequest?.encodedInvoice as string}
                    onShareToApp={onShareToApp}
                    onCopy={onCopy}
                    onError={handleError}
                />
            }
            onBackButtonPress={toggleQRModal}
            onBackdropPress={toggleQRModal}
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)


const ShareAsQRCodeBlock = observer(function (props: {
    toggleQRModal: any
    invoiceToPay: string
    onShareToApp: any  
    onCopy: any
    onError: any
  }) {
    return (
      <View style={[$bottomModal, {marginHorizontal: spacing.small}]}>
        <Text text={'Scan and pay to top-up'} />
        <View style={$qrCodeContainer}>
          <QRCode 
              size={270} 
              value={props.invoiceToPay}
              onError={props.onError}
          />
        </View>
        <View style={$buttonContainer}>
          <Button
            text="Share"
            onPress={props.onShareToApp}
            style={{marginRight: spacing.medium}}
            LeftAccessory={() => (
              <Icon
                icon="faShareFromSquare"
                color="white"
                size={spacing.medium}
                // containerStyle={{marginRight: spacing.small}}
              />
            )}
          />
          <Button preset="secondary" text="Copy" onPress={props.onCopy} />
          <Button
            preset="tertiary"
            text="Close"
            onPress={props.toggleQRModal}
          />
        </View>
      </View>
    )
  })

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


