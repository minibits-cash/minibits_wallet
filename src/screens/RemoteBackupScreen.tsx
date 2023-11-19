import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {FlatList, Linking, Platform, Switch, TextStyle, View, ViewStyle} from 'react-native'
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
import AppError from '../utils/AppError'
import { log, RestoreClient } from '../services'
import { scale } from '@gocodingnow/rn-size-matters'


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
    const [seed, setSeed] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const getSeed = async () => {  
            try {
                setIsLoading(true)          
                const seed = await RestoreClient.getOrCreateSeed()
                setSeed(seed.split(/\s+/))
                setIsLoading(false) 
            } catch (e: any) {
                handleError(e)
            } 
        }
        getSeed()
    }, [])

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')

    return (
      <Screen style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Remote backup" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
                <ListItem
                    text='Your seed phrase'
                    subText='These 12 words allow you to recover your ecash balance in case of device loss. Write them down and keep safe outside of the device.'
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
                <FlatList
                    data={seed}
                    numColumns={2}
                    renderItem={({ item, index }) => {                                
                        return(
                            <Button
                                key={index}
                                preset={'secondary'}
                                onPress={() => false}
                                text={`${index + 1}. ${item}`}
                                style={{minWidth: scale(150), margin: spacing.tiny}}
                                textStyle={$sizeStyles.xs}
                             />
                        )
                    }}
                    keyExtractor={(item) => item} 
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={{alignItems: 'center'}}
                />
                </> 
            }            
          />
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
