import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {Image, Share, TextStyle, View, ViewStyle} from 'react-native'
import { SvgUri, SvgXml } from 'react-native-svg'
import {colors, spacing, useThemeColor} from '../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import { TabScreenProps } from '../navigation'
import { MinibitsClient, WalletProfile, NostrClient, KeyPair } from '../services'
import AppError from '../utils/AppError'
import { log } from '../utils/logger'

interface AvatarScreenProps extends TabScreenProps<'ContactsNavigator'> {}

export const AvatarScreen: FC<AvatarScreenProps> = observer(function AvatarScreen({navigation}) {    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(), 
    })


    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => {
        }
        load()
        return () => {}        
    }, [])
 

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')

    return (
      <Screen style={$screen} preset='auto'>
        <View style={[$headerContainer, {backgroundColor: headerBg, justifyContent: 'space-around'}]}>         
            
        </View>
        <View style={$contentContainer}>
 
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
  height: spacing.screenHeight * 0.18,
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