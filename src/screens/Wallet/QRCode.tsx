import React from 'react'
import { Share, View, ViewStyle } from "react-native"
import { infoMessage } from "../../utils/utils"
import { Button, Card, Icon, ListItem } from "../../components"
import QRCode from "react-native-qrcode-svg"
import Clipboard from "@react-native-clipboard/clipboard"
import { moderateVerticalScale } from "@gocodingnow/rn-size-matters"
import { colors, spacing } from "../../theme"
import { useEffect, useState } from "react"
import { translate } from "../../i18n"
import { CashuUtils, TokenV3 } from "../../services/cashu/cashuUtils"
import { log } from "../../services"


export const QRCodeBlock = function (props: {  
    qrCodeData: string    
    title: string
    type: 'EncodedV3Token' | 'EncodedV4Token' | 'Bolt11Invoice' | 'URL' | 'NWC'
    size?: number
  }
) {
  
    const {qrCodeData, title, type, size} = props
    const [qrError, setQrError] = useState<Error | undefined>()   
    const [encodedV4Token, setEncodedV4Token] = useState<string | undefined>()
    const [decodedV3Token, setDecodedV3Token] = useState<TokenV3>()
    const [keysetFormat, setKeysetFormat] = useState<'hex' | 'base64' | undefined>()
    
    useEffect(() => {
      const detectKeysetFormat = () => {
        if(type === 'EncodedV3Token') {
          const decoded = CashuUtils.decodeToken(qrCodeData) as TokenV3
          setDecodedV3Token(decoded)
          
          if(decoded.token[0].proofs[0].id.startsWith('00')) {
            setKeysetFormat('hex')
          } else {
            setKeysetFormat('base64')
          }          
        }
      }

      detectKeysetFormat()
      return () => {}
  }, [])

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
          
          if(!decodedV3Token) {
            return false
          }

          const encodedV4 = CashuUtils.encodeToken(decodedV3Token, 4)
            
          log.trace('[v4]', encodedV4)            
          setEncodedV4Token(encodedV4)
        }
      } catch (e: any) {
        setQrError(e)
      }
    }
  
  
    const onCopy = function () {
      try {
        Clipboard.setString(encodedV4Token || qrCodeData as string)
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
            {type === 'EncodedV3Token' && keysetFormat === 'hex' && (
              <Button 
                  preset="tertiary" 
                  text={`${encodedV4Token ? 'Legacy' : 'New'} format`}
                  onPress={switchTokenEncoding}
                  LeftAccessory={() => <Icon icon='faMoneyBill1' size={spacing.small} color={colors.light.text} />}
                  textStyle={{color: colors.light.text, fontSize: 14}}
                  pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
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
  marginTop: spacing.small,
  flexDirection: 'row',
  alignSelf: 'center',
}