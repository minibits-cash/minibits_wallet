import React, {forwardRef, useState} from 'react'
import {View, ViewStyle, TextInput, TextStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import {spacing, typography, useThemeColor} from '../../theme'
import {Button} from '../../components/Button'
import {Card} from '../../components/Card'
import {translate} from '../../i18n'
import { ListItem, Text } from '../../components'
import AppError, { Err } from '../../utils/AppError'

interface MnemonicInputProps {  
  mnemonic: string  
  isValidMnemonic: boolean 
  setMnemonic: (memo: string) => void 
  onConfirm: () => void
  onError: (e: AppError) => void    
}

export const MnemonicInput = forwardRef<TextInput, MnemonicInputProps>((props, mnemonicInputRef) => {
    const {    
        mnemonic,
        isValidMnemonic,
        setMnemonic,        
        onConfirm,
        onError
    } = props  

    const onPaste = async function () {
        try {
            const maybeMnemonic = await Clipboard.getString()

            if(!maybeMnemonic) {
            throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicError'))
            }

            const cleaned = maybeMnemonic.replace(/\s+/g, ' ').trim()
            
            setMnemonic(cleaned)
        } catch (e: any) {
            onError(e)
        }
    }

    const numIconColor = useThemeColor('textDim')
    const textHint = useThemeColor('textDim')
    const inputBg = useThemeColor('background')  
  
  return (
    <>
    {isValidMnemonic ? (        
        <Card
            style={$card}
            ContentComponent={
                <ListItem
                    tx='backupScreen.mnemonicTitle'
                    subText={mnemonic}
                    subTextStyle={{fontFamily: typography.code?.normal}}
                    LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                    style={$item}                            
                /> 
            }        
        />
    ) : (
    <Card
        style={$card}
        ContentComponent={
            <ListItem
                tx="recoveryInsertMnemonic"
                subTx={'recoveryInsertMnemonicDescImportBackup'}
                LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                style={$item}                            
            /> 
        }
        FooterComponent={
            <>
            <TextInput
                ref={mnemonicInputRef}
                onChangeText={(mnemonic: string) => setMnemonic(mnemonic)}
                value={mnemonic}
                numberOfLines={3}
                multiline={true}
                autoCapitalize='none'
                keyboardType='default'
                maxLength={100}
                placeholder={translate("mnemonicPhrasePlaceholder")}
                selectTextOnFocus={true}                    
                style={[$mnemonicInput, {backgroundColor: inputBg, flexWrap: 'wrap'}]}
            />
            <View style={$buttonContainer}>
                {mnemonic ? (
                    <Button
                        onPress={onConfirm}
                        tx='common.confirm'                        
                    />
                ) : (
                    <Button
                        onPress={onPaste}
                        tx='common.paste'                        
                    />
                )
            }                    
            </View>
            </>
        }           
    />
    )}
</>
)})

const $card: ViewStyle = {
    marginBottom: spacing.small,
}

const $numIcon: ViewStyle = {
    width: 30, 
    height: 30, 
    borderRadius: 15, 
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.medium
}

const $mnemonicInput: TextStyle = {
    // flex: 1,    
    borderRadius: spacing.small,    
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
    fontFamily: typography.code?.normal,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.small,
}


const $item: ViewStyle = {
    paddingHorizontal: spacing.small,
    paddingLeft: 0,
}
