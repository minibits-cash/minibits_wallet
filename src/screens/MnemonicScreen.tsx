import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {FlatList, TextStyle, View, ViewStyle} from 'react-native'
import {validateMnemonic} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import {colors, spacing, useThemeColor} from '../theme'

import {
  Icon,
  ListItem,
  Screen,
  Text,
  Card,
  Loading,
  ErrorModal,
  InfoModal,
  BottomModal,
  Button,
  $sizeStyles,
} from '../components'
import {useHeader} from '../utils/useHeader'
import AppError, { Err } from '../utils/AppError'
import { scale } from '@gocodingnow/rn-size-matters'
import Clipboard from '@react-native-clipboard/clipboard'
import { translate } from '../i18n'
import { useStores } from '../models'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

type Props = StaticScreenProps<{}>

export const MnemonicScreen = observer(function MnemonicScreen({ route }: Props) {
    const navigation = useNavigation()    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {            
            navigation.goBack()
        },
    })

    const {walletStore} = useStores()    

    const [info, setInfo] = useState('')
    const [mnemonic, setMnemonic] = useState<string>()
    const [mnemonicArray, setMnemonicArray] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false)    
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const getmnemonic = async () => {  
            try {
                setIsLoading(true)
                let mnemonic: string | undefined = undefined

                mnemonic = await walletStore.getCachedMnenomic()

                if (!validateMnemonic(mnemonic, wordlist)) {
                  throw new AppError(
                    Err.VALIDATION_ERROR, 
                    translate("backupScreen.invalidMnemonicError")
                  )
                }

                setMnemonic(mnemonic)
                setMnemonicArray(mnemonic.split(/\s+/))
                setIsLoading(false) 
            } catch (e: any) {
                handleError(e)
            } 
        }
        getmnemonic()
    }, [])


    const onCopy = function (): void {
        try {
            if(mnemonic) {
                Clipboard.setString(mnemonic)
                return
            }
            throw new AppError(
              Err.VALIDATION_ERROR, 
              translate("backupScreen.missingMnemonicError")
            )          
        } catch (e: any) {
          setInfo(translate('common.copyFailParam', { param: e.message }))
        }
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const headerTitle = useThemeColor('headerTitle')

    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" tx='backupScreen.seedBackup' style={{color: headerTitle}} />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
                <ListItem
                    tx="backupScreen.mnemonicTitle"
                    subTx="backupScreen.mnemonicDescription"
                    leftIcon='faInfoCircle'
                    leftIconColor={colors.palette.iconYellow300}
                    leftIconInverse={true}                  
                    style={$item}                    
                /> 
            }            
          />
          <Card
            style={$card}
            ContentComponent={
                <>
                {isLoading && <Loading />} 
                <FlatList
                    data={mnemonicArray}
                    numColumns={2}
                    renderItem={({ item, index }) => {                                
                        return(
                            <Button
                                key={index}
                                preset={'secondary'}
                                onPress={() => false}
                                text={`${index + 1}. ${item}`}
                                style={{minWidth: scale(150), margin: spacing.tiny, minHeight: scale(25)}}
                                textStyle={[$sizeStyles.xs, {padding: 0, margin: 0, lineHeight: 16}]}
                             />
                        )
                    }}
                    keyExtractor={(item) => item} 
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={{alignItems: 'center'}}
                />
                </> 
            }
            FooterComponent={
                <View style={$buttonContainer}>                            
                    <Button
                        preset="default"
                        style={{margin: spacing.small}}
                        tx='common.copy'
                        onPress={onCopy}                            
                    />       
                </View>
            }
          />          
        </View>      
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}      
      </Screen>
    )
  })

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
}

const $contentContainer: TextStyle = {  
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,  
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
}

const $bottomModal: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  alignSelf: 'center',
  //marginLeft: spacing.small,
}
