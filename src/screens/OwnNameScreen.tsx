import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, Image, Share, TextStyle, View, ViewStyle, InteractionManager, TextInput } from 'react-native'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import { WalletNameStackScreenProps } from '../navigation'
import { MinibitsClient, WalletProfile, NostrClient, KeyPair } from '../services'
import AppError from '../utils/AppError'
import {log} from '../utils/logger'
import {$sizeStyles} from '../components/Text'
import {getRandomUsername} from '../utils/usernames'

interface OwnNameScreenProps extends WalletNameStackScreenProps<'RandomName'> {}

export const OwnNameScreen: FC<OwnNameScreenProps> = observer(function OwnNameScreen({navigation}) {    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(), 
    })

    const ownNameInputRef = useRef<TextInput>(null)
    const {userSettingsStore} = useStores()

    const [randomNames, setRandomNames] = useState<string[]>([])
    const [selectedName, setSelectedName] = useState<string>('')
    const [ownName, setOwnName] = useState<string>('')
    const [info, setInfo] = useState('')    
    const [isOwnNameEndEditing, setIsOwnNameEndEditing] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = () => {
            setIsLoading(true)
            InteractionManager.runAfterInteractions(() => {
                let i = 0
                let names = []
                while(i < 8) {
                    const name = getRandomUsername()
                    names.push(name)
                    i++
                }
                setIsLoading(false)
                setRandomNames(names)
            })
        }
        load()
        return () => {}        
    }, [])

    const confirmSelectedName = async function () {
        if(selectedName) {
            setIsLoading(true)
            // TODO check if exists
            
            userSettingsStore.setWalletId(selectedName)
            setIsLoading(false)
            navigation.goBack()
            return
        }

        setInfo('Select one of the usernames')        
    }

    const onOwnNameEndEditing = function () {        
        setIsOwnNameEndEditing(true)
      }
  
      const onOwnNameCheck = function () {
        
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
                style={[$card, {marginTop: spacing.small}]}
                heading='Choose your own name'
                headingStyle={{textAlign: 'center'}}
                ContentComponent={                                
                <View style={$ownNameContainer}>
                    <TextInput
                        ref={ownNameInputRef}
                        onChangeText={name => setOwnName(name)}
                        onEndEditing={onOwnNameEndEditing}
                        value={`${ownName}`}
                        style={[$ownNameInput, {backgroundColor: inputBg}]}
                        maxLength={16}
                        keyboardType="default"
                        selectTextOnFocus={true}
                        placeholder="Write wallet name"
                        /* editable={
                            isPaid
                            ? true
                            : false
                        }*/
                    />
                    <Button
                        preset="secondary"
                        style={$ownNameButton}
                        text="Check"
                        onPress={onOwnNameCheck}
                        /*disabled={
                            isPaid 
                            ? true
                            : false
                        }*/
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