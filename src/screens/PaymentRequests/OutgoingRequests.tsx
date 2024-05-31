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
import {WalletStackParamList} from '../../navigation'
import {useStores} from '../../models'
import AppError from '../../utils/AppError'
import { PaymentRequest } from '../../models/PaymentRequest'
import { StackNavigationProp } from '@react-navigation/stack'
import { PaymentRequestListItem } from './PaymentRequestListItem'
import QRCode from 'react-native-qrcode-svg'
import { infoMessage } from '../../utils/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { translate } from '../../i18n'


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


    const onShowQRModal = function(paymentRequest: PaymentRequest) {
        setSelectedRequest(paymentRequest)        
        toggleQRModal()
    }


    const onShareToApp = async () => {
        try {
          const result = await Share.share({
            message: selectedRequest?.encodedInvoice as string,
          })
  
          if (result.action === Share.sharedAction) {          
            setTimeout(
              () => infoMessage(translate("lightningInvoiceSharedWaiting")),              
              500,
            )
          } else if (result.action === Share.dismissedAction) {
              infoMessage(translate("share.cancelled"))          
          }
        } catch (e: any) {
          handleError(e)
        }
      }
  
  
    const onCopy = function () {
        try {
            Clipboard.setString(selectedRequest?.encodedInvoice as string)
        } catch (e: any) {
            setInfo(translate("common.copyFailParam", { param: e.message }))
        }
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
                            navigation={navigation}
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
        <Text tx="paymentRequestScreen.outgoing.scanAndPay" />
        <View style={$qrCodeContainer}>
          <QRCode 
              size={270} 
              value={props.invoiceToPay}
              onError={props.onError}
          />
        </View>
        <View style={$buttonContainer}>
          <Button
            tx="common.share"
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
          <Button preset="secondary" tx="common.copy" onPress={props.onCopy} />
          <Button
            preset="tertiary"
            tx="common.close"
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


