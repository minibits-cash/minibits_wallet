import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Share, View, ViewStyle } from "react-native"
import { HCESession, NFCTagType4NDEFContentType, NFCTagType4 } from 'react-native-hce'
import NfcManager  from 'react-native-nfc-manager'
import { UR, UREncoder } from '@gandlaf21/bc-ur';
import { infoMessage } from "../../utils/utils"
import { Button, Card, Icon, ListItem } from "../../components"
import QRCode from "react-native-qrcode-svg"
import Clipboard from "@react-native-clipboard/clipboard"
import { verticalScale } from "@gocodingnow/rn-size-matters"
import { colors, spacing } from "../../theme"
import { translate, TxKeyPath } from "../../i18n"
import { log } from "../../services"
import { Token, getDecodedToken, getEncodedToken } from '@cashu/cashu-ts'
import { NfcService } from '../../services/nfcService';


export type QRCodeBlockTypes = 'EncodedV3Token' | 'EncodedV4Token' | 'Bolt11Invoice' | 'URL' | 'NWC' | 'PUBKEY' | 'PaymentRequest'

const ANIMATED_QR_FRAGMENT_LENGTH = 150
const ANIMATED_QR_INTERVAL = 250

export const QRCodeBlock = function (props: {
    qrCodeData: string
    title?: string
    titleTx?: TxKeyPath
    type: QRCodeBlockTypes
    size?: number
    startNfcOnLoad?: boolean
  }
) {

    const { qrCodeData, title, titleTx, type, size, startNfcOnLoad = false } = props
    const [qrError, setQrError] = useState<Error | undefined>()
    const [encodedV3Token, setEncodedV3Token] = useState<string | undefined>()
    const [decodedToken, setDecodedToken] = useState<Token>()
    const [keysetFormat, setKeysetFormat] = useState<'hex' | 'base64' | undefined>()
    const [isLoadingQRCode, setIsLoadingQRCode] = useState<boolean>(false)
    const [isQRCodeError, setIsQRCodeError] = useState<boolean>(false)
    const [isAnimating, setIsAnimating] = useState<boolean>(false)
    const [isNfcSupported, setIsNfcSupported] = useState<boolean>(false)
    const [isStringSafeForNfc, setIsStringSafeForNfc] = useState<boolean>(false)
    const [isNfcEnabled, setIsNfcEnabled] = useState<boolean>(false)
    const [qrCodeChunk, setQrCodeChunk] = useState<string | undefined>()

    // NFC State
    const [nfcBroadcast, setNfcBroadcast] = useState(false)
    const simulationRef = useRef<any>(null)

    // Cleanup NFC session on unmount
    useEffect(() => {
      const nfcSupport = async () => {
        try {
          let isSafe = false
          if (['EncodedV3Token', 'EncodedV4Token', 'Bolt11Invoice', 'PaymentRequest'].includes(type)) {
            isSafe = NfcService.isStringSafeForNFC(qrCodeData)
            setIsStringSafeForNfc(isSafe)
          }

          const isSupported = await NfcManager.isSupported()
          const isEnabled = await NfcManager.isEnabled()

          setIsNfcSupported(isSupported)
          setIsNfcEnabled(isEnabled)

          // Auto-start NFC if requested and available
          if (startNfcOnLoad && Platform.OS === 'android' && isSupported && isEnabled && isSafe) {
            try {
              await startNFCSimulation()
              setNfcBroadcast(true)
            } catch (e: any) {
              log.error('NFC auto-start failed: ', e.message, {stack: e.stack})
            }
          }

        } catch (e: any) {}
      }

      nfcSupport()

      return () => {
          if (simulationRef.current) {
              simulationRef.current.setEnabled(false)
          }
      }
    }, [])

    // Stop NFC if it was active when toggling off
    /*useEffect(() => {
        if (!nfcBroadcast && simulationRef.current) {
            simulationRef.current.setEnabled(false)
            simulationRef.current = null
        }
    }, [nfcBroadcast])*/

    useEffect(() => {
      const detectKeysetFormat = () => {
        if(type === 'EncodedV4Token') {
          const decoded = getDecodedToken(qrCodeData)
          setDecodedToken(decoded)
          
          if(decoded.proofs[0].id.startsWith('00')) {
            setKeysetFormat('hex')            
          } else {
            try {
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
    }, [qrCodeData, type])


    useEffect(() => {
      let qrCodeInterval: NodeJS.Timeout | number

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
          }, ANIMATED_QR_INTERVAL)

        } catch (e: any) {
          handleQrError(e)
        }
      }

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

    /* const switchTokenEncoding = function () {
      try {
        if(encodedV3Token) {
          setEncodedV3Token(undefined)
        } else if(type === 'EncodedV4Token') {
          if(!decodedToken) return

          const encodedV3 = getEncodedToken(decodedToken, {version: 3})
          setEncodedV3Token(encodedV3)
        }
      } catch (e: any) {
        handleQrError(e)
      }
    }*/

    const startAnimatedQRcode = () => setIsAnimating(true)
    const stopAnimatedQRcode = () => setIsAnimating(false)
    const switchToAnimatedQRcodeOnError = () => {
      setIsQRCodeError(true)
      startAnimatedQRcode()
    }
    const toggleQRcodeAnimation = () => setIsAnimating(prev => !prev)
  
    const onCopy = function () {
      try {
        Clipboard.setString(encodedV3Token || qrCodeData)
      } catch (e: any) {
        handleQrError(e)
      }
    }

    // NFC Functions
    const startNFCSimulation = async () => {
        const dataToBroadcast = encodedV3Token || qrCodeData
        const tag = new NFCTagType4({
          type: NFCTagType4NDEFContentType.Text,
          content: dataToBroadcast,
          writable: false,
        })
        const session = await HCESession.getInstance()
        session.setApplication(tag)
        await session.setEnabled(true)
        log.trace('[startNFCSimulation] Session enabled')
        simulationRef.current = session
    }

    const stopNFCSimulation = async () => {
      if (simulationRef.current) {
        try {
          await simulationRef.current.setEnabled(false)
          log.trace('[stopNFCSimulation] Session closed')
        } catch (error) {
          console.warn('Failed to terminate NFC session:', error)
        }
        simulationRef.current = null
      }
    }

    const toggleNFC = async () => {
      if (nfcBroadcast) {
        // await stopNFCSimulation()
        setNfcBroadcast(prev => !prev)
      } else {
        try {
          // await startNFCSimulation()
          setNfcBroadcast(prev => !prev)
        } catch(e: any) {
          log.error('NFC simulation failed to start: ', e.message, {stack: e.stack})
          infoMessage(e.message)
        }
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
                //tx="commonShare"
                preset="tertiary" 
                onPress={onShareToApp}
                LeftAccessory={() => <Icon icon='faShareNodes' size={spacing.medium} color={colors.light.text} />}
                textStyle={{color: colors.light.text, fontSize: 14}}
                pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
                style={{ minHeight: verticalScale(40), paddingVertical: verticalScale(spacing.tiny) }}  
            />
            <Button 
                preset="tertiary" 
                //tx="commonCopy" 
                onPress={onCopy}
                LeftAccessory={() => <Icon icon='faCopy' size={spacing.medium} color={colors.light.text} />}
                textStyle={{color: colors.light.text, fontSize: 14}}
                pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
                style={{ minHeight: verticalScale(40), paddingVertical: verticalScale(spacing.tiny) }}  
            />
            {/*type === 'EncodedV4Token' && keysetFormat === 'hex' && !isAnimating && (
              <Button
                  preset="tertiary" 
                  tx={encodedV3Token ? "qrCodeNewFormatButton" : "qrCodeOldFormatButton"}
                  onPress={switchTokenEncoding}
                  LeftAccessory={() => <Icon icon='faMoneyBill1' size={spacing.small} color={colors.light.text}/>}
                  textStyle={{color: colors.light.text, fontSize: 14}}
                  pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
                  style={{ minHeight: verticalScale(40), paddingVertical: verticalScale(spacing.tiny) }}  
              /> 
            )*/}
            {type === 'EncodedV4Token' && !isQRCodeError && (
              <Button
                  preset="tertiary" 
                  //tx={isAnimating ? "qrCodeStaticButton" : "qrCodeAnimateButton"}
                  onPress={toggleQRcodeAnimation}
                  LeftAccessory={() => <Icon icon='faQrcode' size={spacing.medium} color={colors.light.text} />}
                  textStyle={{color: colors.light.text, fontSize: 14}}
                  pressedStyle={{backgroundColor: colors.light.buttonTertiaryPressed}}
                  style={{ minHeight: verticalScale(40), paddingVertical: verticalScale(spacing.tiny) }}  
              /> 
            )}
            {/* NFC HCE share button - only on Android */}
            {Platform.OS === 'android' && isStringSafeForNfc && isNfcSupported && (
              <Button
                  preset="tertiary"
                  //text={nfcBroadcast ? "NFC active" : "NFC"}
                  onPress={isNfcEnabled ? toggleNFC : () => Alert.alert('Enable NFC in device settings')}
                  LeftAccessory={() => (
                    <Icon 
                      icon='faNfcSymbol' 
                      size={spacing.medium} 
                      color={nfcBroadcast ? colors.palette.success300 : colors.light.text}
                    />
                  )}
                  textStyle={{ 
                    color: nfcBroadcast ? colors.palette.success300 : colors.light.text, 
                    fontSize: 14,
                    fontWeight: nfcBroadcast ? 'bold' : 'normal'
                  }}
                  pressedStyle={{ backgroundColor: colors.light.buttonTertiaryPressed }}
                  style={{
                    minHeight: verticalScale(40),
                    paddingVertical: verticalScale(spacing.tiny),
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
  borderRadius: spacing.small
}

const $buttonContainer: ViewStyle = {
  marginTop: spacing.small,
  flexDirection: 'row',
  alignSelf: 'center',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: spacing.small
}