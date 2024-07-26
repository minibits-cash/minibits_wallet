import { Share, View, ViewStyle } from "react-native"
import { infoMessage } from "../../utils/utils"
import { Button, Card, Icon, ListItem } from "../../components"
import QRCode from "react-native-qrcode-svg"
import Clipboard from "@react-native-clipboard/clipboard"
import { moderateVerticalScale } from "@gocodingnow/rn-size-matters"
import { colors, spacing } from "../../theme"
import { useState } from "react"
import { translate } from "../../i18n"
import { CashuUtils } from "../../services/cashu/cashuUtils"
import { log } from "../../services"

export const QRCodeBlock = function (props: {  
    qrCodeData: string    
    title: string
    type: 'EncodedV3Token' | 'EncodedV4Token' | 'Bolt11Invoice' | 'URL'
    size?: number
  }
) {
  
    const {qrCodeData, title, type, size} = props
    const [qrError, setQrError] = useState<Error | undefined>()   
    const [encodedV4Token, setEncodedV4Token] = useState<string | undefined>()  

    const handleQrError = function (error: Error) {
        setQrError(error)
    }
  
    const onShareToApp = async () => {
      try {
        const result = await Share.share({
          message: qrCodeData as string,
        })
  
        if (result.action === Share.sharedAction) {          
          setTimeout(
            () => infoMessage(translate('lightningInvoiceSharedWaiting')),              
            500,
          )
        } else if (result.action === Share.dismissedAction) {
            infoMessage(translate('share.cancelled'))          
        }
      } catch (e: any) {
        setQrError(e)
      }
    }


    const switchTokenEncoding = function () {
      try {
        if(encodedV4Token) {
          setEncodedV4Token(undefined)
        } else if(type === 'EncodedV3Token') {
          log.trace('[v3]', qrCodeData)

          const decoded = CashuUtils.decodeToken(qrCodeData)
          const encodedV4 = CashuUtils.encodeToken(decoded, 4)

          log.trace('[v4]', encodedV4)
          
          setEncodedV4Token(encodedV4)
        }
      } catch (e: any) {
        setQrError(e)
      }
    }
  
  
    const onCopy = function () {
      try {
        Clipboard.setString(qrCodeData as string)
      } catch (e: any) {
        setQrError(e)
      }
    }
  
    return (
      <Card
        heading={title}
        headingStyle={{textAlign: 'center', color: colors.light.text, marginBottom: spacing.extraSmall}}
        style={{backgroundColor: 'white', paddingBottom: spacing.small}}
        ContentComponent={qrError ? (
          <ListItem 
              text={translate("qr.fail")}
              subText={qrError ? qrError.message : ''}
              leftIcon='faTriangleExclamation'
              containerStyle={{marginVertical: spacing.large}}
              leftIconColor={colors.palette.angry500}
              textStyle={{color: colors.light.text}}
          />
        ) : (
          <View style={$qrCodeContainer}>
              <QRCode 
                  size={size || spacing.screenWidth - spacing.large * 2} value={encodedV4Token || qrCodeData} 
                  onError={(error: any) => handleQrError(error)}
              />
          </View>              
        )}
        FooterComponent={
          <View style={$buttonContainer}>
            <Button
                text="Share"
                preset="tertiary" 
                onPress={onShareToApp}
                LeftAccessory={() => <Icon icon='faShareFromSquare' size={spacing.small} color={colors.light.text} />}
                textStyle={{color: colors.light.text, fontSize: 14}}
                style={{
                    minWidth: 60, 
                    minHeight: moderateVerticalScale(40), 
                    paddingVertical: moderateVerticalScale(spacing.tiny),
                    marginRight: spacing.small
                }}  
            />
            <Button 
                preset="tertiary" 
                text="Copy" 
                onPress={onCopy}
                LeftAccessory={() => <Icon icon='faCopy' size={spacing.small} color={colors.light.text} />}
                textStyle={{color: colors.light.text, fontSize: 14}}
                style={{
                    minWidth: 60, 
                    minHeight: moderateVerticalScale(40),                    
                    paddingVertical: moderateVerticalScale(spacing.tiny),
                    marginRight: spacing.small
                }}  
            />
            {type === 'EncodedV3Token' && (
              <Button 
                  preset="tertiary" 
                  text={`Show ${encodedV4Token ? 'v3' : 'v4'} format`}
                  onPress={switchTokenEncoding}
                  LeftAccessory={() => <Icon icon='faMoneyBill1' size={spacing.small} color={colors.light.text} />}
                  textStyle={{color: colors.light.text, fontSize: 14}}
                  style={{
                      minWidth: 60, 
                      minHeight: moderateVerticalScale(40),                    
                      paddingVertical: moderateVerticalScale(spacing.tiny),
                      marginRight: spacing.small
                  }}  
              /> 
            )}          
        </View>
        }
      />
        
    )
  }
  

  const $qrCodeContainer: ViewStyle = {
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: spacing.small,    
    marginHorizontal: spacing.small,
    // marginBottom: spacing.small,
    borderRadius: spacing.small
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}