import React, {FC, useEffect, useState} from 'react'
import {Pressable, TextStyle, View, ViewStyle} from 'react-native'
import FastImage from 'react-native-fast-image'
import {colors, spacing, useThemeColor} from '../theme'
import {Button, Card, ErrorModal, Header, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useStores} from '../models'
import { log, MinibitsClient} from '../services'
import AppError from '../utils/AppError'
import { ProfileHeader } from '../components/ProfileHeader'
import { scale } from '@gocodingnow/rn-size-matters'
import { getImageSource } from '../utils/utils'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'


type Props = StaticScreenProps<undefined>

export const PictureScreen = (function PictureScreen({ route }: Props) {    
    const navigation = useNavigation()
    const {walletProfileStore} = useStores()

    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [selectedPicture, setSelectedPicture] = useState<string>('') // selected picture
    const [pictures, setPictures] = useState<string[]>([]) // random pictures


    useEffect(() => {
        const load = async () => {
            try {
                setIsLoading(true)
                const pngs = await MinibitsClient.getRandomPictures()
                if(pngs.length > 0) {
                    setPictures(pngs)
                }
                setIsLoading(false)
            } catch (e: any) {
                handleError(e)
            }
        }
        load()
        return () => {}        
    }, [])
 
    const onPictureSelect = function (png: string) {
        setSelectedPicture(png)
    }

    const onPictureConfirm = async function () {
        try {
            setIsLoading(true)            
            await walletProfileStore.updatePicture(selectedPicture)           
            setIsLoading(false)

            navigation.goBack()

        } catch (e: any) {
            handleError(e)
        }
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }    
    
    const selectedColor = colors.palette.success200    

    return (
      <Screen contentContainerStyle={$screen} preset='auto'> 
        <Header                
            leftIcon='faArrowLeft'
            onLeftPress={() => navigation.goBack()}                            
        />       
        <ProfileHeader />
        <View style={$contentContainer}>
            <View style={$picturesContainer}>
                {pictures.map((png, index) => {
                    // log.trace('PictureScreen', 'png', png)
                    return (
                        <Pressable
                            key={index}
                            onPress={() => onPictureSelect(png)}
                            style={(png === selectedPicture) ? [$unselected, {borderColor: selectedColor}] : $unselected}
                        >
                            <FastImage style={{width: scale(80), height: scale(85)}} source={{uri: getImageSource(png)}} />
                        </Pressable>
                    )
                })}
                {pictures.length === 0 && !isLoading && (
                    <Card
                        ContentComponent={<ListItem
                            leftIcon='faXmark'
                            tx="pictureRetrieveFail"
                        />}
                    />
                )}
            </View>
            {selectedPicture && (
                <View style={$buttonContainer}>
                    <Button
                        preset="default"
                        tx='common.confirm'
                        onPress={onPictureConfirm}
                    />
                    <Button
                        preset="secondary"
                        tx='common.cancel'
                        onPress={() => setSelectedPicture('')}
                    />
                </View>
            )}            
        </View>
        {isLoading && <Loading />}      
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
 
      </Screen>
    )
  })



const $screen: ViewStyle = { flex: 1 }

const $unselected: ViewStyle = {
    borderWidth: 5, 
    borderRadius: 10, 
    margin: spacing.extraSmall,
    borderColor: 'transparent',
}

const $contentContainer: TextStyle = {  
    flex: 1,  
    padding: spacing.small,
    minHeight: spacing.huge,
}

const $picturesContainer: TextStyle = { 
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
  
