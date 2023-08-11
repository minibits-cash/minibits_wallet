import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useRef, useState} from 'react'
import {Image, Pressable, Share, TextStyle, View, ViewStyle} from 'react-native'
import Svg, { SvgUri, SvgXml } from 'react-native-svg'
import {colors, spacing, useThemeColor} from '../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {ContactsStackScreenProps} from '../navigation'
import { MinibitsClient, WalletProfile, NostrClient, KeyPair } from '../services'
import AppError from '../utils/AppError'
import { log } from '../utils/logger'
import { useFocusEffect } from '@react-navigation/native'

interface AvatarScreenProps extends ContactsStackScreenProps<'Avatar'> {}

export const AvatarScreen: FC<AvatarScreenProps> = observer(function AvatarScreen({route, navigation}) {    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(), 
    })
    const {userSettingsStore} = useStores()

    const [info, setInfo] = useState('')
    const [pubkey, setPubkey] = useState<string>('')  
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [avatarSvg, setAvatarSvg] = useState<string>('')
    const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string>('')
    const [avatarUrls, setAvatarUrls] = useState<string[]>([])

    useFocusEffect(
        useCallback(() => {
          const svg = route.params?.avatarSvg
          const key = route.params?.pubkey
          
          setAvatarSvg(svg)
          setPubkey(key)          
          
        }, [route.params?.avatarSvg]),
    )

    useEffect(() => {
        const load = async () => {
            try {
                setIsLoading(true)
                const urls = await MinibitsClient.getRandomAvatars()
                if(urls.length > 0) {
                    setAvatarUrls(urls)
                }
                setIsLoading(false)
            } catch (e: any) {
                handleError(e)
            }
        }
        load()
        return () => {}        
    }, [])
 
    const onAvatarSelect = function (url: string) {
        setSelectedAvatarUrl(url)
    }

    const onAvatarConfirm = async function () {
        try {
            setIsLoading(true)            
            await MinibitsClient.updateWalletProfile(
                pubkey,
                undefined,
                selectedAvatarUrl
            )                                    
            
            setIsLoading(false)
            navigation.navigate('Contacts', {selectedAvatarUrl})
        } catch (e: any) {
            handleError(e)
        }
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const selectedColor = colors.palette.success200   

    return (
      <Screen style={$screen} preset='auto'>
        <View style={[$headerContainer, {backgroundColor: headerBg, justifyContent: 'space-around'}]}>
            
            {avatarSvg ? (
                <SvgXml xml={avatarSvg} width="90" height="90" />
            ) : (
                <Icon
                    icon='faCircleUser'                                
                    size={80}                    
                    color={'white'}                
                />
            )}
            <Text preset='bold' text='Change your avatar' style={{color: 'white', marginBottom: spacing.small}} />          
        </View>
        <View style={$contentContainer}>
            {avatarUrls.map(url => {
                return (
                    <Pressable
                        key={url}
                        onPress={() => onAvatarSelect(url)}
                        style={(url === selectedAvatarUrl) ? {borderColor: selectedColor, borderWidth: 5, borderRadius: 10, margin: spacing.extraSmall} : {borderColor: 'transparent', borderWidth: 5, margin: spacing.extraSmall}}
                    >
                        <SvgUri key={url} uri={url} width="90" height="90" />
                    </Pressable>
                )
            })}
        </View>
        {selectedAvatarUrl && (
            <View style={$buttonContainer}>
                <Button
                    preset="default"
                    tx={'common.confirm'}
                    onPress={onAvatarConfirm}
                />
                <Button
                    preset="secondary"
                    tx={'common.cancel'}
                    onPress={() => setSelectedAvatarUrl('')}
                />
            </View>
        )}
        {isLoading && <Loading />}        
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
  padding: spacing.small,
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  flexWrap: 'wrap',
}


const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    // alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.medium,
}
  
