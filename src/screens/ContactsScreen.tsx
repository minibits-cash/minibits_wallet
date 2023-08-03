import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Share, TextStyle, View, ViewStyle} from 'react-native'
import * as nostrTools from 'nostr-tools'
import { SvgUri, SvgXml } from 'react-native-svg'
import {colors, spacing, useThemeColor} from '../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../components'
import {useHeader} from '../utils/useHeader'
import { TabScreenProps } from '../navigation'
import {getRandomAvatar} from '../services'
import AppError from '../utils/AppError'
import { log } from '../utils/logger'
import QRCode from 'react-native-qrcode-svg'

interface ContactsScreenProps extends TabScreenProps<'Contacts'> {}

export const ContactsScreen: FC<ContactsScreenProps> = observer(function ContactsScreen(_props) {    
    useHeader({
        leftIcon: 'faShareFromSquare',
        leftIconColor: colors.palette.primary100,
        onLeftPress: () => onShareContact(),    
        rightIcon: 'faQrcode',
        rightIconColor: colors.palette.primary100,
        onRightPress: () => toggleQRModal(),        
    })

    const [privateKey, setPrivateKey] = useState<string>('')
    const [publicKey, setPublicKey] = useState<string>('')
    const [avatarSvg, setAvatarSvg] = useState<string>('')

    const [info, setInfo] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isQRModalVisible, setIsQRModalVisible] = useState(false)    
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => {
            try {            
                // const sk = nostrTools.generatePrivateKey() // `sk` is a hex string
                // const pk = nostrTools.getPublicKey(sk)

                const svg = await getRandomAvatar()

                // setPrivateKey(sk)
                // setPublicKey(pk)
                setAvatarSvg(svg)
            } catch(e: any) {
                return false // silent
            }
        }

        load()
        return () => {
            // this now gets called when the component unmounts
        }
        
    }, [])

    const toggleQRModal = () =>
      setIsQRModalVisible(previousState => !previousState)


    const onShareContact = async () => {
        try {
            const result = await Share.share({
                message: 'contact',
            })

            if (result.action === Share.sharedAction) {                
                setTimeout(
                    () =>
                    setInfo(
                        'Contact has been shared',
                    ),
                    500,
                )
            } else if (result.action === Share.dismissedAction) {
                setInfo(
                    'Contact sharing cancelled',
                )
            }
        } catch (e: any) {
            handleError(e)
        }
    }    

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const rightIcon = useThemeColor('textDim')

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
            <Text preset='subheading' text="sam55" style={{color: 'white', marginBottom: spacing.small}} />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
            <>                
                <ListItem
                    text={'sam55@minibits.cash'}
                    subText={`${publicKey.substring(0, 10)}...`}
                    LeftComponent={<></>

                    }
                    leftIconInverse={true}
                    rightIcon='faQrcode'
                    rightIconColor={rightIcon as string}                  
                    style={$item}
                />                                    
            </>
            }
            FooterComponent={/*
             <View style={{flexDirection:'row'}}>
                
                <Button
                    preset='secondary'
                    onPress={() => false}                        
                    text='Share as QR'
                    LeftAccessory={() => (
                        <Icon
                          icon='faQrcode'
                          // color='white'
                          size={spacing.medium}                  
                        />
                    )}
                    style={{alignSelf: 'center', marginTop: spacing.medium}}
                />
                <Button
                    preset='secondary'
                    onPress={() => false}                        
                    text='Share as QR'
                    LeftAccessory={() => (
                        <Icon
                          icon='faQrcode'
                          // color='white'
                          size={spacing.medium}                  
                        />
                    )}
                    style={{alignSelf: 'center', marginTop: spacing.medium}}
                />                              
             </View>   
                    */ <></>}
          />
          {isLoading && <Loading />}
        </View>        
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
        <BottomModal
            isVisible={isQRModalVisible ? true : false}
            top={spacing.screenHeight * 0.25}
            // style={{marginHorizontal: spacing.extraSmall}}
            ContentComponent={
                <View style={[$bottomModal, {marginHorizontal: spacing.small}]}>
                <Text text={'Scan to share your contact'} />
                <View style={$qrCodeContainer}>        
                    <QRCode size={spacing.screenWidth - spacing.extraLarge * 2} value={'contact to share'} />          
                </View>
                <View style={$buttonContainer}>
                <Button preset="secondary" text="Close" onPress={toggleQRModal} />
                </View>
            </View>
            }
            onBackButtonPress={toggleQRModal}
            onBackdropPress={toggleQRModal}
        />     
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