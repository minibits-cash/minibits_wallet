import React, { useState } from 'react'
import { View } from 'react-native'
import type { TextStyle } from 'react-native';

import { BottomModal } from './BottomModal';
import { Text } from './Text';
import { QRCodeBlock, QRCodeBlockTypes } from '../screens/Wallet/QRCode';
import { spacing, useThemeColor } from '../theme';
import { translate, TxKeyPath } from '../i18n';

interface QRShareModalProps {
  url: string,
  isVisible?: boolean,
  onClose?: () => void,
  type: QRCodeBlockTypes
  shareModalTitle?: string,
  shareModalTx?: TxKeyPath,
  subHeading?: string,
  label?: string
  labelTx?: TxKeyPath,
  size?: number,
}

export const QRShareModal = (props: QRShareModalProps) => {
  const labelText = useThemeColor('textDim')
  const {
    url,
    isVisible = true,
    onClose = () => {},
    shareModalTitle,
    shareModalTx,
    subHeading,
    type,
    label,
    labelTx,
    size
  } = props

  let finalTx: TxKeyPath | undefined = shareModalTx
  if (!shareModalTx && !shareModalTitle) finalTx = 'common.share'

  return (
    <BottomModal
      isVisible={isVisible}
      ContentComponent={
        <>
          <Text
            tx={finalTx}
            text={shareModalTitle}
            preset="subheading"
            style={{alignSelf: 'center', marginBottom: spacing.small}}
          />
          <View style={$newContainer}>
            <QRCodeBlock
              qrCodeData={url.toString()}
              title={subHeading || shareModalTitle || translate('common.share')}
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