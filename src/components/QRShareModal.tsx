import React, { useState } from 'react'
import { View } from 'react-native'
import type { TextStyle, ViewStyle } from 'react-native';

import { BottomModal } from './BottomModal';
import { Text } from './Text';
import { QRCodeBlock, QRCodeBlockTypes } from '../screens/Wallet/QRCode';
import { spacing, useThemeColor } from '../theme';
import { translate, TxKeyPath } from '../i18n';
import { Button } from './Button';

interface QRShareModalProps {
  data: string,
  isVisible?: boolean,
  onClose?: () => void,
  type: QRCodeBlockTypes
  shareModalTitle?: string,
  shareModalTx?: TxKeyPath,
  subHeading?: string,
  subHeadingTx?: TxKeyPath,
  label?: string
  labelTx?: TxKeyPath,
  size?: number,
}

export const QRShareModal = (props: QRShareModalProps) => {
  const labelText = useThemeColor('textDim')
  const {
    data,
    isVisible = true,
    onClose = () => {},
    shareModalTitle,
    shareModalTx,
    subHeading,
    subHeadingTx,
    type,
    label,
    labelTx,
    size
  } = props

  let finalTx: TxKeyPath | undefined = shareModalTx


  return (
    <BottomModal
      isVisible={isVisible}
      ContentComponent={
        <> 
          {shareModalTx || shareModalTitle && (
            <Text
              tx={shareModalTx}
              text={shareModalTitle}            
              style={{alignSelf: 'center', marginBottom: spacing.small}}
            />
          )
          }
          <View style={$newContainer}>
            <QRCodeBlock
              qrCodeData={data.toString()}
              title={subHeading}
              titleTx={subHeadingTx}
              type={type}
              size={size}
            />
            {(label || labelTx) &&
              <Text
                size="xxs"
                style={{
                  color: labelText,
                  marginTop: spacing.medium,
                  alignSelf: 'center',
                }}
                text={label}
                tx={labelTx && !label ? labelTx : undefined}
              />
            }
            <View style={$buttonContainer}>
              <Button 
                onPress={props.onClose}
                tx='common.close'
                preset='tertiary'
              />
            </View>
          </View>
        </>
      }
      onBackButtonPress={onClose}
      onBackdropPress={onClose}
    />
  )
}

const $newContainer: TextStyle = {
  alignSelf: 'stretch',
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',    
  marginTop: spacing.medium,
  justifyContent: 'center',  
}