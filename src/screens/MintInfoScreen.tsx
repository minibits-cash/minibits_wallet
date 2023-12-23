import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Alert, FlatList, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation'
import {
    APP_ENV,    
    NATIVE_VERSION_ANDROID,
    JS_BUNDLE_VERSION,
    COMMIT,
    MINIBITS_MINT_URL,
    MINIBITS_RELAY_URL,
    MINIBITS_NIP05_DOMAIN,
    MINIBITS_SERVER_API_HOST 
} from '@env'
import packageJson from '../../package.json'
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
} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {translate} from '../i18n'
import AppError, { Err } from '../utils/AppError'
import {Database, KeyChain, log, MintClient, NostrClient} from '../services'
import {MMKVStorage} from '../services'
import {maxTransactionsInModel} from '../models/TransactionsStore'
import { LogLevel } from '../services/log/logTypes'
import { GetInfoResponse } from '@cashu/cashu-ts'
import { delay } from '../utils/utils'
import JSONTree from 'react-native-json-tree'
import { getSnapshot } from 'mobx-state-tree'
import { Mint } from '../models/Mint'
import useColorScheme from '../theme/useThemeColor'

// refresh

export const MintInfoScreen: FC<SettingsStackScreenProps<'MintInfo'>> = observer(function MintInfoScreen(_props) {
    const {navigation, route} = _props
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () =>  navigation.navigate('Settings'),
    })

    const {mintsStore} = useStores()

    const [isLoading, setIsLoading] = useState(false)
    const [mintInfo, setMintInfo] = useState<GetInfoResponse | undefined>()
    
    const [error, setError] = useState<AppError | undefined>()
    const [info, setInfo] = useState('')

    useEffect(() => {
        const getInfo = async () => {            
            try {
                if(!route.params || !route.params.mintUrl) {
                    throw new AppError(Err.VALIDATION_ERROR, 'Missing mintUrl')
                }

                log.trace('useEffect', {mintUrl: route.params.mintUrl})

                setIsLoading(true)                    
                const info = await MintClient.getMintInfo(route.params.mintUrl)                
                await delay(1000)
                setMintInfo(info)
                setIsLoading(false)
            } catch (e: any) {
                handleError(e)
            }
        }
        getInfo()
    }, [])

    

    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const iconSelectedColor = useThemeColor('button')
    const iconColor = useThemeColor('textDim')
    const labelColor = useThemeColor('textDim')
    const colorScheme = useColorScheme()

    return (
      <Screen style={$screen} preset="scroll">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            text="Mint info"
            style={{color: 'white'}}
          />
        </View>
        <View style={$contentContainer}>

                <>
                    <Card
                        ContentComponent={mintInfo ? (
                                Object.entries(mintInfo).map(([key, value], index) => (
                                    <ListItem
                                        text={key}
                                        RightComponent={<Text text={value.toString().slice(0,20)}/>}
                                        topSeparator={index === 0 ? false : true}
                                        key={key}
                                    />
                                ))
                            ) : (
                                isLoading && <Loading style={{backgroundColor: 'transparent'}} statusMessage='Loading public info' />
                            )}                            
                        style={$card}
                    />
                    <Card
                        style={[$card, {marginTop: spacing.small}]}
                        ContentComponent={
                        <>
                            <Text
                            style={{color: labelColor, fontSize: 14}}
                            text="Internal information"
                            />
                            <JSONTree
                                hideRoot                        
                                data={getSnapshot(mintsStore.findByUrl(route.params?.mintUrl) as Mint)}
                                theme={{
                                    scheme: 'default',
                                    base00: '#eee',
                                }}
                                invertTheme={colorScheme === 'light' ? false : true}
                            />
                        </>
                        }                  
                    />
                </>

            
            
            {error && <ErrorModal error={error} />}
            {info && <InfoModal message={info} />}
        </View>
      </Screen>
    )
  })

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.1,
}

const $contentContainer: TextStyle = {
  flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $card: ViewStyle = {
  marginBottom: 0,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    marginTop: spacing.large,
}
