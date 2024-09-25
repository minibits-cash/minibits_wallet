import {observer} from 'mobx-react-lite'
import { Observer } from 'mobx-react-lite'
import Clipboard from '@react-native-clipboard/clipboard'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Loading} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import { log } from '../services'
import { moderateVerticalScale, verticalScale } from '@gocodingnow/rn-size-matters'
import { NwcConnection } from '../models/NwcStore'
import { QRCodeBlock } from './Wallet/QRCode'
import { CollapsibleText } from '../components/CollapsibleText'
import { isSameDay } from 'date-fns/isSameDay'

interface SettingsScreenProps extends SettingsStackScreenProps<'Nwc'> {}

export const NwcScreen: FC<SettingsScreenProps> = observer(
  function NwcScreen(_props) {

    const {navigation} = _props
    const connectionNameInputRef = useRef<TextInput>(null)
    const dailyLimitInputRef = useRef<TextInput>(null)
    const {nwcStore, walletProfileStore} = useStores()   
    
    const [selectedConnection, setSelectedConnection] = useState<NwcConnection | undefined>()
    const [isAddConnectionModalVisible, setIsAddConnectionModalVisible] = useState(false)
    const [isShareConnectionModalVisible, setIsShareConnectionModalVisible] = useState(false)
    const [isMenuConnectionModalVisible, setIsMenuConnectionModalVisible] = useState(false)
    const [newConnectionName, setNewConnectionName] = useState<string>('')
    const [newConnectionDailyLimit, setNewConnectionDailyLimit] = useState<string>('0')
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isRemoteDataPushEnabled, setIsRemoteDataPushEnabled] = useState<boolean>(false)

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        rightIcon: isRemoteDataPushEnabled ? 'faRotate' : undefined,
        onRightPress: () => isRemoteDataPushEnabled ? onConnect() : false
    })
    
    useEffect(() => {
        const getNotificationPermission = async () => {
            try {                
                const remoteEnabled = walletProfileStore.device ? true : false
                setIsRemoteDataPushEnabled(remoteEnabled)              
            } catch (e: any) {
                log.warn(e.name, e.message)
                return false // silent
            }
        } 
        getNotificationPermission()
    }, [])


    useEffect(() => {
        const resetDailyLimits = async () => {
            // reset daily limits if day changed            
            for (const c of nwcStore.nwcConnections) {
                if(!isSameDay(c.currentDay, new Date())) {
                    c.setRemainingDailyLimit(c.dailyLimit)
                    c.setCurrentDay()
                }
            }
        } 
        resetDailyLimits()
    }, [])
    
    const toggleAddConnectionModal = () => {
        setIsAddConnectionModalVisible(previousState => !previousState)
        setIsShareConnectionModalVisible(false)
        setIsMenuConnectionModalVisible(false)
        if(selectedConnection) {
          setSelectedConnection(undefined)
        }
    }

    const toggleShareConnectionModal = () => {
        setIsShareConnectionModalVisible(previousState => !previousState)
        setIsAddConnectionModalVisible(false)
        setIsMenuConnectionModalVisible(false)
        if(selectedConnection) {
          setSelectedConnection(undefined)
        }
    }

    const toggleMenuConnectionModal = () => {
        setIsMenuConnectionModalVisible(previousState => !previousState)
        setIsAddConnectionModalVisible(false)
        setIsShareConnectionModalVisible(false)
        if(selectedConnection) {
          setSelectedConnection(undefined)
        }
    }

    const onConnectionSelect = function (conn: NwcConnection) {
        setSelectedConnection(conn)
        toggleMenuConnectionModal()        
    }
  

    const removeConnection = function () {
        nwcStore.removeConnection(selectedConnection as NwcConnection)
        setSelectedConnection(undefined)
        toggleMenuConnectionModal()        
    }

    const onConnect = async function () {
        log.trace('onConnect') 
        
        if(!isRemoteDataPushEnabled) {
            setSelectedConnection(undefined)        
            nwcStore.receiveNwcEvents()   
            setInfo(`
                Your device can not receive background push messages. This is essential to recieve NWC commands. 
                As a fallback, Minibits subscribed to Nostr relays to receive the commands. 
                However, this will stop working when app is in the background or off.
            `)
        }
    }

    const gotoAdd = function () {        
        toggleAddConnectionModal()
    }

    const gotoShare = function (conn: NwcConnection) {
        setSelectedConnection(conn)     
        toggleShareConnectionModal()
    } 

    const onSaveConnection = async function () {        
        try {

            if(!newConnectionName || !newConnectionDailyLimit) {
                setInfo('Insert name or daily limit')
                return
            }

            if(parseInt(newConnectionDailyLimit) === 0) {
                setInfo('Daily limit must be above zero')
                return
            }

            if(nwcStore.alreadyExists(newConnectionName)) {
                setInfo('Connection with this name already exists.')
                return
            }

            setIsLoading(true)
            toggleAddConnectionModal()            
            await nwcStore.addConnection(newConnectionName, parseInt(newConnectionDailyLimit))
            setIsLoading(false)
            setNewConnectionName('')
            setNewConnectionDailyLimit('0')
            onConnect()
        } catch(e: any) {
          handleError(e)
        }
    }

    const handleError = function (e: AppError): void {        
        setIsAddConnectionModalVisible(false)
        setError(e)
    }    
    
    const iconColor = useThemeColor('textDim')
    const headerBg = useThemeColor('header')
    const inputBg = useThemeColor('background')    
    const mainButtonColor = useThemeColor('card')
    const screenBg = useThemeColor('background')
    const mainButtonIcon = useThemeColor('button')
    const labelText = useThemeColor('textDim')
    const $subText = {color: useThemeColor('textDim'), fontSize: 14}
    
    return (
      <Screen contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset='heading'
            text='NWC'
            style={{color: 'white'}}
          />
        </View>
        <View style={$contentContainer}>            
            <Card
                style={$card}
                ContentComponent={
                    <ListItem 
                        text='Nostr Wallet Connect'                        
                        BottomComponent={                            
                            <CollapsibleText
                                collapsed={true}
                                summary='NWC lets you control your wallet from another application, such as your favourite Nostr app.'                                
                                text={'NWC lets you control your wallet from another application, such as your favourite Nostr app. Allow access only to the apps you trust. Your device must have push notifications enabled and stay online.'}
                                textProps={{style: $subText}}
                            />
                        }
                    />                    
                }
            />
            {nwcStore.nwcConnections.length > 0 && (
                <Card
                    style={[$card, {marginTop: spacing.medium, flexShrink: 1}]}
                    ContentComponent={
                    <>   
                        <FlatList<NwcConnection>
                            data={nwcStore.all}
                            extraData={nwcStore.all}
                            renderItem={({ item, index }) => {                                
                                return <Observer>{() => (
                                    <ListItem
                                        text={item.name}
                                        subText={''}
                                        leftIcon='faWallet'
                                        leftIconColor={iconColor as string}
                                        topSeparator={index === 0 ? false : true}                                
                                        RightComponent={
                                            <View style={$rightContainer}>
                                                {/*<Button
                                                    onPress={() => onCopy(item)}
                                                    preset='tertiary'
                                                    LeftAccessory={() => <Icon icon='faCopy' color={iconColor} />}
                                                />*/}
                                                <Button
                                                    onPress={() => gotoShare(item)}
                                                    preset='secondary'
                                                    LeftAccessory={() => <Icon icon='faQrcode' color={iconColor} />}
                                                />                                                
                                            </View>
                                        }
                                        BottomComponent={
                                        <View style={{flexDirection: 'column'}}>
                                            <Text 
                                                text={`Daily limit ${item.dailyLimit} SAT`} 
                                                style={$subText}
                                            />
                                            <Text 
                                                text={`Remaining ${item.remainingDailyLimit} SAT`} 
                                                style={$subText}
                                            />
                                        </View>}
                                        style={$item}
                                        onPress={() => onConnectionSelect(item)}
                                    />
                                )}</Observer>
                            }}                
                            keyExtractor={(item) => item.connectionSecret} 
                            style={{}}
                        />
                    </>
                }
            />
            )}
        </View>
        <View style={$bottomContainer}>
            <View style={$buttonContainer}>
                <Button
                    LeftAccessory={() => (
                        <Icon
                            icon='faPlus'
                            size={spacing.large}
                            color={mainButtonIcon}
                        />
                    )}
                    onPress={gotoAdd}                        
                    style={[{backgroundColor: mainButtonColor, borderWidth: 1, borderColor: screenBg}, $buttonNew]}
                    preset='tertiary'
                    text='Add connection'
                />
            </View>
        </View>
        
        <BottomModal
          isVisible={isMenuConnectionModalVisible ? true : false}
          style={{alignItems: 'stretch'}}          
          ContentComponent={
            <View>         
                <ListItem
                    leftIcon="faXmark"
                    onPress={removeConnection}
                    text="Remove connection"
                    style={{paddingHorizontal: spacing.medium}}
                />
            </View>
          }
          onBackButtonPress={toggleMenuConnectionModal}
          onBackdropPress={toggleMenuConnectionModal}
        />
        <BottomModal
          isVisible={isShareConnectionModalVisible ? true : false}          
          ContentComponent={
            <>
            <Text text={selectedConnection?.name} preset="subheading" style={{alignSelf: 'center', marginBottom: spacing.small}} />            
            <View style={$newContainer}>                
                <QRCodeBlock
                    qrCodeData={selectedConnection?.connectionString as string}
                    title='Share NWC connection'
                    type='NWC'
                />
                <Text
                    size="xxs"
                    style={{color: labelText, marginTop: spacing.medium, alignSelf: 'center'}}
                    text="Scan or copy this connection string to another application to allow it to connect to your wallet. Use only with apps you trust."
                />
            </View>
            </>
          }
          onBackButtonPress={toggleShareConnectionModal}
          onBackdropPress={toggleShareConnectionModal}
        />
        <BottomModal
          isVisible={isAddConnectionModalVisible ? true : false}          
          ContentComponent={
            <>
            <Text text='Create NWC connection' preset="subheading" style={{alignSelf: 'center'}} />
            <View style={$newContainer}>                
                <Text
                    size="xxs"
                    style={{color: labelText, marginTop: spacing.medium}}
                    text="Name your connection by the app you will use it with"
                />              
                <View style={{                  
                    flexDirection: 'row',                    
                    marginTop: spacing.small,
                }}> 
                  
                    <TextInput
                        ref={connectionNameInputRef}
                        onChangeText={(name) => setNewConnectionName(name)}
                        value={newConnectionName}
                        autoCapitalize='sentences'
                        keyboardType='default'
                        maxLength={64}
                        placeholder='My NWC application'
                        selectTextOnFocus={true}
                        style={[$connInput, {backgroundColor: inputBg}]}
                    />
                </View>
                <Text
                    size="xxs"
                    style={{color: labelText, marginTop: spacing.medium}}
                    text="Set maximal daily limit to spend"
                />  
                <View style={{                    
                    flexDirection: 'row',
                    marginTop: spacing.small
                }}>
                    <TextInput
                        ref={dailyLimitInputRef}
                        onChangeText={(limit) => setNewConnectionDailyLimit(limit)}
                        value={newConnectionDailyLimit}                        
                        keyboardType='numeric'
                        maxLength={8}
                        placeholder='Enter daily limit in satoshi'
                        selectTextOnFocus={true}
                        style={[$connInput, {backgroundColor: inputBg, borderBottomRightRadius: 0, borderTopRightRadius: 0}]}
                    />
                    <Button
                        preset='secondary'
                        text="SAT"
                        style={{
                            borderTopLeftRadius: 0,
                            borderBottomLeftRadius: 0,  
                            marginHorizontal: 1,                                
                        }}                        
                    />
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    <Button
                        tx={'common.save'}
                        style={$saveButton}
                        onPress={onSaveConnection}
                    />
                    <Button preset='tertiary' onPress={toggleAddConnectionModal} style={{marginLeft: spacing.small}} text='Cancel'/>
                </View>                
            </View>
            </>
          }
          onBackButtonPress={toggleAddConnectionModal}
          onBackdropPress={toggleAddConnectionModal}
        />
        {isLoading && <Loading/>}
        {info && <InfoModal message={info} />}
        {error && <ErrorModal error={error} />}
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    padding: spacing.extraSmall,    
    height: spacing.screenHeight * 0.20, 
}

const $contentContainer: TextStyle = {
    flex: 1,
    padding: spacing.extraSmall,
    marginTop: -spacing.extraLarge * 2
}

const $newContainer: TextStyle = {
    alignSelf: 'stretch',
    // padding: spacing.small,
    // alignItems: 'center',
}


const $saveButton: ViewStyle = {
    borderRadius: spacing.small,
    marginLeft: spacing.small,
}

const $connInput: TextStyle = {
    flex: 1,    
    borderRadius: spacing.extraSmall,    
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $card: ViewStyle = {
  // marginVertical: 0,
}

const $item: ViewStyle = {
  // paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
    flexDirection: 'row',
    padding: spacing.extraSmall,
    alignSelf: 'center',
    marginLeft: spacing.small,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    marginBottom: spacing.tiny,
    justifyContent: 'center',
    alignItems: 'center',    
}

  const $bottomContainer: ViewStyle = {
    /*position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,*/
    alignSelf: 'center',
    // opacity: 0,
  }
  
  const $buttonNew: ViewStyle = {
    borderRadius: moderateVerticalScale(60 / 2),
    height: moderateVerticalScale(60),
    minWidth: verticalScale(120),  
  } 

