import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, Image, Share, TextStyle, View, ViewStyle, InteractionManager } from 'react-native'
import { SvgUri, SvgXml } from 'react-native-svg'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import { TabScreenProps } from '../navigation'
import { MinibitsClient, WalletProfile, NostrClient, KeyPair } from '../services'
import AppError from '../utils/AppError'
import {log} from '../utils/logger'
import {$sizeStyles} from '../components/Text'
import {getRandomUsername} from '../utils/usernames'

interface WalletnameScreenProps extends TabScreenProps<'ContactsNavigator'> {}

export const WalletnameScreen: FC<WalletnameScreenProps> = observer(function WalletnameScreen({navigation}) {    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(), 
    })

    const {userSettingsStore} = useStores()

    const [randomNames, setRandomNames] = useState<string[]>([])
    const [selectedName, setSelectedName] = useState<string>('')
    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = () => {
            InteractionManager.runAfterInteractions(() => {
                let i = 0
                let names = []
                while(i < 8) {
                    const name = getRandomUsername()
                    names.push(name)
                    i++
                }
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
            
            userSettingsStore.setUserId(selectedName)
            setIsLoading(false)
            navigation.goBack()
            return
        }

        setInfo('Select one of the usernames')        
    }
 

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const currentNameColor = colors.palette.primary200

    return (
      <Screen style={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>         
            <Text preset='subheading' text='Change wallet name' style={{color: 'white'}}/>
            <Text size='xxs' text={`${userSettingsStore.userId}@minibits.cash`} style={{color: currentNameColor, marginBottom: spacing.small}}/>
        </View>
        <View style={$contentContainer}>
            <Card
                style={$card}
                heading='Choose random name'
                headingStyle={{textAlign: 'center'}}
                ContentComponent={
                <>                
                    <FlatList
                        data={randomNames}
                        renderItem={({ item }) => {
                                
                            return (
                                <Button
                                    preset={selectedName === item ? 'default' : 'secondary'}
                                    onPress={() => setSelectedName(item)}
                                    text={`${item}`}
                                    style={{minWidth: 150, margin: spacing.extraSmall}}
                                    textStyle={$sizeStyles.xs}
                                />
                            )
                        }}
                        numColumns={2}
                        keyExtractor={(item) => item}
                    />                                  
                </>
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
            <Card
                style={[$card, {marginTop: spacing.small}]}
                heading='Choose your own name'
                ContentComponent={
                <>                
                                                  
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
  paddingHorizontal: spacing.medium,
  height: spacing.screenHeight * 0.08,
  justifyContent: 'space-around',
}

const $contentContainer: TextStyle = {  
  // marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,  
}

const $card: ViewStyle = {
  marginBottom: 0,
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