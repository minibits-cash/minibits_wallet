import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, Linking, Platform, Switch, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {AppStackScreenProps, SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
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
import { log, RestoreClient } from '../services'
import { scale } from '@gocodingnow/rn-size-matters'
import Clipboard from '@react-native-clipboard/clipboard'


export const RemoteRecoveryScreen: FC<AppStackScreenProps<'RemoteRecovery'>> = observer(function RemoteRecoveryScreen(_props) {
    const {navigation, route} = _props    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {            
            navigation.goBack()
        },
    })

    // const {userSettingsStore} = useStores()
    const seedInputRef = useRef<TextInput>(null)

    const [info, setInfo] = useState('')
    const [seed, setSeed] = useState<string>()        
    const [seedExists, setSeedExists] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const getSeed = async () => {  
            try {
                setIsLoading(true)          
                const existing = await RestoreClient.getSeed()

                if(existing) {
                    setSeedExists(true)
                }
                setIsLoading(false) 
            } catch (e: any) {
                handleError(e)
            } 
        }
        getSeed()
    }, [])


    const onPaste = async function () {
        try {
            const maybeSeed = await Clipboard.getString()

            if(!maybeSeed) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing seed phrase.')
            }

            setSeed(maybeSeed)
        } catch (e: any) {
            handleError(e)
        }
    }


    const onConfirm = function (): void {
        try {
            setIsLoading(true)
            if(!seed) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing seed.')
            }
            
            const seedArray: string[] = seed.split(/\s+/)
            if(seedArray.length !== 12) {
                throw new AppError(Err.VALIDATION_ERROR, 'Invalid seed phrase. Provide 12 word sequence separated by blank spaces.')  
            }

            // WIP

            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const numIconColor = useThemeColor('textDim')
    const textResult = useThemeColor('textDim')
    const inputBg = useThemeColor('background')

    return (
      <Screen style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Wallet recovery" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
            {seedExists ? (
            <Card
                style={$card}
                ContentComponent={
                    <ListItem
                        text='Seed exists'
                        subText='Your wallet already has generated its own seed. Recovery process works only with freshly installed wallet to avoid loss of your funds.'
                        leftIcon='faTriangleExclamation'
                        leftIconColor={colors.palette.accent400}                  
                        style={$item}                    
                    /> 
                }          
                />
            ) : (
            <Card
                style={$card}
                ContentComponent={
                    <ListItem
                        text='Insert backup seed phrase'
                        subText='Paste or rewrite 12 words phrase to recover your ecash balance on new device. Separate words by blank spaces.'
                        LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                        style={$item}
                        bottomSeparator={true}
                    /> 
                }
                FooterComponent={
                    <>
                    <TextInput
                        ref={seedInputRef}
                        onChangeText={(seed: string) => setSeed(seed.trim())}
                        value={seed}
                        numberOfLines={3}
                        multiline={true}
                        autoCapitalize='none'
                        keyboardType='default'
                        maxLength={150}
                        placeholder='Seed phrase...'
                        selectTextOnFocus={true}                    
                        style={[$seedInput, {backgroundColor: inputBg, flexWrap: 'wrap'}]}
                    />
                    <View style={$buttonContainer}>
                        {seed ? (
                            <Button
                                onPress={onConfirm}
                                text='Confirm'                        
                            />
                        ) : (
                            <Button
                                onPress={onPaste}
                                text='Paste'                        
                            />
                        )
                    }                    
                    </View>
                    </>
                }           
            />
            )}     
            {isLoading && <Loading />}
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
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {  
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,  
}

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

const $seedInput: TextStyle = {
    // flex: 1,    
    borderRadius: spacing.small,    
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.small,
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
