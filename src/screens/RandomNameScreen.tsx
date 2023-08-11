import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, Image, Share, TextStyle, View, ViewStyle, InteractionManager, TextInput } from 'react-native'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {WalletNameStackScreenProps} from '../navigation'
import { MinibitsClient, WalletProfile, NostrClient, KeyPair } from '../services'
import AppError, { Err } from '../utils/AppError'
import {log} from '../utils/logger'
import {$sizeStyles} from '../components/Text'
import {getRandomUsername} from '../utils/usernames'
import { createPublicKey } from 'crypto'

interface RandomNameScreenProps extends WalletNameStackScreenProps<'RandomName'> {}

export const RandomNameScreen: FC<RandomNameScreenProps> = observer(function RandomNameScreen({navigation}) {    
    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(), 
    })
    
    const {userSettingsStore} = useStores()

    const [randomNames, setRandomNames] = useState<string[]>([])
    const [selectedName, setSelectedName] = useState<string>('')    
    const [npubKey, setNpubKey] = useState<string>('')    
    const [info, setInfo] = useState('')        
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => {
            setIsLoading(true)
            InteractionManager.runAfterInteractions(async () => {
                let i = 0
                let names = []
                while(i < 8) {
                    const name = getRandomUsername()
                    names.push(name)
                    i++
                }
                const keyPair = await NostrClient.getOrCreateKeyPair()               

                setNpubKey(keyPair.publicKey)
                setRandomNames(names)
                setIsLoading(false)                
            })
        }
        load()
        return () => {}        
    }, [])

    const confirmSelectedName = async function () {
        if(!selectedName) {
            setInfo('Select one of the usernames')
            return
        }
        
        try {
            setIsLoading(true)
            
            await MinibitsClient.updateWalletProfile(
                npubKey,
                selectedName as string,
                undefined                
            )
                                    
            userSettingsStore.setWalletId(selectedName)
            setIsLoading(false)
            navigation.goBack()
            return
        } catch (e: any) {
            handleError(e)
        }                       
    }
    

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const currentNameColor = colors.palette.primary200
    const inputBg = useThemeColor('background')

    return (
      <Screen style={$screen} preset='auto'>
        <View style={$contentContainer}>
            <Card
                style={$card}
                heading='Choose a random name'
                headingStyle={{textAlign: 'center'}}
                ContentComponent={
                <View style={$namesContainer}>                
                    {randomNames.map((name, index) => (
                        <Button
                            key={index}
                            preset={selectedName === name ? 'default' : 'secondary'}
                            onPress={() => setSelectedName(name)}
                            text={`${name}`}
                            style={{minWidth: 150, margin: spacing.extraSmall}}
                            textStyle={$sizeStyles.xs}
                        />)
                    )}
                    {isLoading && <Loading />}                               
                </View>
                }
                FooterComponent={
                    <View style={{alignItems: 'center'}}>
                        <Button                        
                            onPress={() => confirmSelectedName()}
                            text={'Confirm'}
                            style={{margin: spacing.extraSmall, minWidth: 120}}                        
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
    paddingHorizontal: spacing.medium,
    height: spacing.screenHeight * 0.08,
    justifyContent: 'space-around',
}

const $contentContainer: TextStyle = {    
    padding: spacing.extraSmall,  
}

const $namesContainer: ViewStyle = {
    // flex: 1,
    height: spacing.screenHeight * 0.35,    
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.medium,
    paddingTop: spacing.medium,    
}

const $card: ViewStyle = {
    marginBottom: 0,
}

const $ownNameContainer: ViewStyle = {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.extraSmall,
  }
  
  const $ownNameInput: TextStyle = {
    flex: 1,
    borderRadius: spacing.small,
    fontSize: 16,
    textAlignVertical: 'center',
    marginRight: spacing.small,    
  }

  const $ownNameButton: ViewStyle = {
    maxHeight: 50,
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

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
}
  
const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    padding: spacing.small,
    margin: spacing.small,
}