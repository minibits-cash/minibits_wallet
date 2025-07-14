import React from 'react'
import { ActivityIndicator, Share, View, ViewStyle } from "react-native"
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { infoMessage } from "../../utils/utils"
import { Button, Card, Icon, ListItem, Loading } from "../../components"
import QRCode from "react-native-qrcode-svg"
import Clipboard from "@react-native-clipboard/clipboard"
import { moderateScale, verticalScale } from "@gocodingnow/rn-size-matters"
import { colors, spacing } from "../../theme"
import { useEffect, useState } from "react"
import { translate, TxKeyPath } from "../../i18n"
import { CashuUtils, CashuProof } from "../../services/cashu/cashuUtils"
import { log } from "../../services"
import { Token, getDecodedToken, getEncodedToken } from '@cashu/cashu-ts';

export type QRCodeBlockTypes = 'EncodedV3Token' | 'EncodedV4Token' | 'Bolt11Invoice' | 'URL' | 'NWC' | 'PUBKEY' | 'PaymentRequest'

const ANIMATED_QR_FRAGMENT_LENGTH = 150
const ANIMATED_QR_INTERVAL = 250

export const QRCodeBlock = function (props: {  
    qrCodeData: string    
    title?: string
    titleTx?: TxKeyPath
    type: QRCodeBlockTypes
    size?: number
  }
) {
  
    const {qrCodeData, title, titleTx, type, size} = props
    const [qrError, setQrError] = useState<Error | undefined>()
    const [encodedV3Token, setEncodedV3Token] = useState<string | undefined>()
    const [decodedToken, setDecodedToken] = useState<Token>()
    const [keysetFormat, setKeysetFormat] = useState<'hex' | 'base64' | undefined>()
    const [isLoadingQRCode, setIsLoadingQRCode] = useState<boolean>(false)
    const [isQRCodeError, setIsQRCodeError] = useState<boolean>(false)
    const [isAnimating, setIsAnimating] = useState<boolean>(false)
    const [qrCodeChunk, setQrCodeChunk] = useState<string | undefined>()
    
    useEffect(() => {
      const detectKeysetFormat = () => {
        if(type === 'EncodedV4Token') {
          const decoded = getDecodedToken(qrCodeData)
          setDecodedToken(decoded)
          
          if(decoded.proofs[0].id.startsWith('00')) {
            setKeysetFormat('hex')            
          } else {
            try {
              // make v3 legacy format
              const encodedV3 = getEncodedToken(decoded, {version: 3})
              setEncodedV3Token(encodedV3)
            } catch (e: any) {
              handleQrError(e)
            }
            setKeysetFormat('base64')
          }          
        }
      }

      detectKeysetFormat()
      return () => {}
    }, [])


    useEffect(() => {
      let qrCodeInterval: NodeJS.Timeout

      if (isAnimating) {
        setIsLoadingQRCode(true)
        try {          
          const buffer = Buffer.from(qrCodeData)
          const ur = UR.fromBuffer(buffer)
          const firstSeqNum = 0

          const encoder = new UREncoder(ur, ANIMATED_QR_FRAGMENT_LENGTH, firstSeqNum)        
          
          qrCodeInterval = setInterval(() => {
            setIsLoadingQRCode(false)            
            setQrCodeChunk(encoder.nextPart())
            // log.trace(encoder.nextPart())            
          }, ANIMATED_QR_INTERVAL)

          
        } catch (e: any) {
          handleQrError(e)
        }
      }

      // Cleanup function that runs on component unmount or when the interval needs to stop
      return () => {
        if (qrCodeInterval) {
          clearInterval(qrCodeInterval)
        }
      }
    }, [isAnimating, qrCodeData])



    const handleQrError = function (error: Error) {
        stopAnimatedQRcode()
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
            infoMessage(translate('share_cancelled'))          
        }
      } catch (e: any) {
        handleQrError(e)
      }
    }


    const switchTokenEncoding = function () {
      try {
        if(encodedV3Token) {
          setEncodedV3Token(undefined)
        } else if(type === 'EncodedV4Token') {
          log.trace('[v4]', qrCodeData)
          
          if(!decodedToken) {
            return false
          }

          const encodedV3 = getEncodedToken(decodedToken, {version: 3})
            
          log.trace('[v3]', encodedV3)            
          setEncodedV3Token(encodedV3)
        }
      } catch (e: any) {
        handleQrError(e)
      }
    }


    const startAnimatedQRcode = () => {
      setIsAnimating(true)
    }


    const stopAnimatedQRcode = () => {
      setIsAnimating(false)
    }


    const switchToAnimatedQRcodeOnError = () => {
      setIsQRCodeError(true)
      startAnimatedQRcode()
    }


    const toggleQRcodeAnimation = () => setIsAnimating(previousState => !previousState)
  
  
    const onCopy = function () {
      try {
        Clipboard.setString(encodedV3Token || qrCodeData as string)
      } catch (e: any) {
        handleQrError(e)
      }
    }

    const qrCodeSize = size || spacing.screenWidth - spacing.large * 2
      
    return (
      <Card
        heading={title}
        headingTx={titleTx}
        headingStyle={{textAlign: 'center', color: colors.light.text, marginBottom: spacing.extraSmall}}
        style={{backgroundColor: 'white', paddingBottom: spacing.small}}
        ContentComponent={qrError ? (
          <ListItem 
              text={translate("qr_fail")}
              subText={qrError ? qrError.message : ''}
              leftIcon='faTriangleExclamation'
              containerStyle={{marginVertical: spacing.large}}
              leftIconColor={colors.palette.angry500}
              textStyle={{color: colors.light.text}}
          />
        ) : (
          <View style={$qrCodeContainer}>
            {isLoadingQRCode ? (
              <View style={{
                width: qrCodeSize,
                height: qrCodeSize,
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <ActivityIndicator color={colors.palette.neutral300} animating size="large" />
              </View>
            ) : (
              <>
              {isAnimating ? (
                <QRCode 
                  size={qrCodeSize} value={qrCodeChunk} 
                  onError={handleQrError}
                />
              ) : (
                <QRCode 
                    size={qrCodeSize} value={encodedV3Token || qrCodeData} 
                    onError={switchToAnimatedQRcodeOnError}
                />
              )}
              </>
            )}
            
          </View>              
        )}
        FooterComponent={
          <View style={$buttonContainer}>
            <Button
                tx="commonShare"
                preset="tertiary" 
                onPress={onShareToApp}
                LeftAccessory={() => <Icon icon='faShareNodes' size={spacing.small} color={colors.light.text} />}
                textStyle={{color: colors.light.text, fontSize: 14}}
                pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
                style={{                    
                    minHeight: verticalScale(40), 
                    paddingVertical: verticalScale(spacing.tiny)                    
                }}  
            />
            <Button 
                preset="tertiary" 
                tx="commonCopy" 
                onPress={onCopy}
                LeftAccessory={() => <Icon icon='faCopy' size={spacing.small} color={colors.light.text} />}
                textStyle={{color: colors.light.text, fontSize: 14}}
                pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
                style={{                     
                    minHeight: verticalScale(40),                    
                    paddingVertical: verticalScale(spacing.tiny)                    
                }}  
            />
            {type === 'EncodedV4Token' && keysetFormat === 'hex' && !isAnimating && (
              <Button
                  preset="tertiary" 
                  tx={encodedV3Token ? "qrCodeNewFormatButton" : "qrCodeOldFormatButton"}
                  onPress={switchTokenEncoding}
                  LeftAccessory={() => <Icon icon='faMoneyBill1' size={spacing.small} color={colors.light.text}/>}
                  textStyle={{color: colors.light.text, fontSize: 14}}
                  pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
                  style={{                       
                      minHeight: verticalScale(40),                    
                      paddingVertical: verticalScale(spacing.tiny),                      
                  }}  
              /> 
            )}
            {type === 'EncodedV4Token' && !isQRCodeError && (
              <Button
                  preset="tertiary" 
                  tx={isAnimating ? "qrCodeStaticButton" : "qrCodeAnimateButton"}
                  onPress={toggleQRcodeAnimation}
                  LeftAccessory={() => <Icon icon='faQrcode' size={spacing.small} color={colors.light.text} />}
                  textStyle={{color: colors.light.text, fontSize: 14}}
                  pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
                  style={{                      
                      minHeight: verticalScale(40),                    
                      paddingVertical: verticalScale(spacing.tiny),
                      paddingHorizontal: spacing.tiny                     
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