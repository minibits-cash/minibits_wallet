import { Share, View, ViewStyle } from "react-native"
import { infoMessage } from "../../utils/utils"
import { Button, Card, Icon, ListItem } from "../../components"
import QRCode from "react-native-qrcode-svg"
import Clipboard from "@react-native-clipboard/clipboard"
import { moderateVerticalScale } from "@gocodingnow/rn-size-matters"
import { colors, spacing } from "../../theme"
import { useState } from "react"
import { translate } from "../../i18n"

export const QRCodeBlock = function (props: {  
    qrCodeData: string
    title: string
    size?: number
  }
) {
  
    const {qrCodeData, title, size} = props
    const [qrError, setQrError] = useState<Error | undefined>()

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
            infoMessage('Sharing cancelled')          
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
        style={{backgroundColor: 'white', paddingBottom: 0}}
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
                  size={size || spacing.screenWidth - spacing.large * 2} value={qrCodeData} 
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