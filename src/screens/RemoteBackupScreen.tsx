import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {FlatList, TextStyle, View, ViewStyle} from 'react-native'
import {validateMnemonic} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
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
import { KeyChain, log, MintClient } from '../services'
import { scale } from '@gocodingnow/rn-size-matters'
import Clipboard from '@react-native-clipboard/clipboard'


export const RemoteBackupScreen: FC<SettingsStackScreenProps<'RemoteBackup'>> = observer(function RemoteBackupScreen(_props) {
    const {navigation, route} = _props    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {            
            navigation.goBack()
        },
    })

    // const {userSettingsStore} = useStores()

    const [info, setInfo] = useState('')
    const [mnemonic, setMnemonic] = useState<string>()
    const [mnemonicArray, setMnemonicArray] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isNewMnemonic, setIsNewMnemonic] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const getmnemonic = async () => {  
            try {
                setIsLoading(true)
                let mnemonic: string | undefined = undefined

                mnemonic = await MintClient.getMnemonic()

                if(!mnemonic) {
                    // wallets upgraded from 0.1.4 with no generated seed                    
                    mnemonic = await MintClient.getOrCreateMnemonic() // expensive, derives seed
                    MintClient.resetCachedWallets() // force all cached wallet instances to be recreated with seed
                    setIsNewMnemonic(true)
                }

                if (!validateMnemonic(mnemonic, wordlist)) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Corrupted or invalid mnemonic. Please move funds and reinstall this wallet.')
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

                if(isNewMnemonic) {
                    setInfo('To apply backup to your existing funds, send your entire balance to yourself. Otherwise, only funds from this point onward can be restored.')
                }

                return
            }
            throw new AppError(Err.VALIDATION_ERROR, 'Missing mnemonic.')          
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
        }
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')

    return (
      <Screen style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Off-device backup" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
                <ListItem
                    text='Your mnemonic phrase'
                    subText='This 12 word sequence allows you to recover your ecash balance in case of device loss. Keep them in safe place.'
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
                        text="Copy"
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
  padding: spacing.medium,
  height: spacing.screenHeight * 0.20,
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
