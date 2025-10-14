import {observer} from 'mobx-react-lite'
import { Observer } from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Loading, Header} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import { log, NotificationService } from '../services'
import { translate } from '../i18n'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { NwcConnection } from '../models/NwcStore'
import { QRCodeBlock } from './Wallet/QRCode'
import { CollapsibleText } from '../components/CollapsibleText'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

type Props = StaticScreenProps<{}>

export const NwcScreen = observer(function NwcScreen(_props) {

    const navigation = useNavigation()
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
    const [isRemoteDataPushEnabled, setIsRemoteDataPushEnabled] = useState<boolean>(walletProfileStore.device ? true : false)
    const [areNotificationsEnabled, setAreNotificationsEnabled] = useState<boolean>(false)


    useEffect(() => {
        const setNotificationsStatus = async () => {
            const enabled = await NotificationService.areNotificationsEnabled()
            if(enabled) {
                setAreNotificationsEnabled(true)
            } 
        } 
        setNotificationsStatus()
    }, [])


    useEffect(() => {
        const resetDailyLimits = () => {
            nwcStore.resetDailyLimits()
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
        log.trace('[onConnect]') 
        
        // if device does not support firebase notifications, but notifications are enabled, 
        // use foreground service to listen for NWC events
        if(!isRemoteDataPushEnabled && areNotificationsEnabled) {
            setSelectedConnection(undefined)
            
            await NotificationService.stopForegroundService() // stop previous if any
            await NotificationService.createNwcListenerNotification()
               
            setInfo(translate('nwcScreen_pushNotificationWarning'))
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
                setInfo(translate('nwcScreen_missingNameOrLimit'))
                return
            }

            if(parseInt(newConnectionDailyLimit) === 0) {
                setInfo(translate('nwcScreen_limitMustBePositive'))
                return
            }

            if(nwcStore.alreadyExists(newConnectionName)) {
                setInfo(translate('nwcScreen_connectionExists'))
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
    const inputText = useThemeColor('text')      
    const mainButtonColor = useThemeColor('card')
    const screenBg = useThemeColor('background')
    const mainButtonIcon = useThemeColor('button')
    const labelText = useThemeColor('textDim')
    const $subText = {color: useThemeColor('textDim'), fontSize: verticalScale(14)}
    const headerTitle = useThemeColor('headerTitle')
    const buttonBorder = useThemeColor('card')
    const placeholderTextColor = useThemeColor('textDim')
    
    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
        <Header 
            leftIcon='faArrowLeft'
            onLeftPress={() => navigation.goBack()}
            rightIcon={!isRemoteDataPushEnabled && areNotificationsEnabled ? 'faCircleNodes' : undefined}
            onRightPress={() => !isRemoteDataPushEnabled && areNotificationsEnabled ? onConnect() : false}
        />
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset='heading'
            text='NWC'
            style={{color: headerTitle}}
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
                                summary={translate('nwcScreen_nwcSummary')}                                
                                text={translate('nwcScreen_nwcDescription')}
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
                                                text={translate("nwcScreen_dailyLimit", {limit: item.dailyLimit, currency: 'SAT'})}
                                                style={$subText}
                                            />
                                            <Text 
                                                text={translate("nwcScreen_remainingLimit", {remaining: item.remainingDailyLimit, currency: 'SAT'})}
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
                {areNotificationsEnabled ? (
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
                    tx='nwcScreen_addConnection'
                />
                ) : ( 
                    <Text
                        text={'Enable app notifications in Settings first.'}
                        style={{textAlign: 'center'}} 
                    />
                )}
                
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
                    tx="nwcScreen_removeConnection"
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
                    titleTx='nwcScreen_shareNwcConnection'
                    type='NWC'
                />
                <Text
                    size="xxs"
                    style={{color: labelText, marginTop: spacing.medium, alignSelf: 'center'}}
                    tx="nwcScreen_shareDescription"
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
            <Text tx='nwcScreen_createNwcConnection' preset="subheading" style={{alignSelf: 'center'}} />
            <View style={$newContainer}>                
                <Text
                    size="xxs"
                    style={{color: labelText, marginTop: spacing.medium}}
                    tx="nwcScreen_nameConnectionHint"
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
                        placeholder={translate('nwcScreen_appNamePlaceholder')}
                        placeholderTextColor={placeholderTextColor}
                        selectTextOnFocus={true}
                        style={[$connInput, {backgroundColor: inputBg, color: inputText}]}
                    />
                </View>
                <Text
                    size="xxs"
                    style={{color: labelText, marginTop: spacing.medium}}
                    tx="nwcScreen_dailyLimitHint"
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
                        placeholder={translate('nwcScreen_dailyLimitPlaceholder')}
                        placeholderTextColor={placeholderTextColor}
                        selectTextOnFocus={true}
                        style={[$connInput, {backgroundColor: inputBg, color: inputText}]}
                    />
                    <Button
                        preset='secondary'
                        text="SAT"
                        style={{
                            borderTopLeftRadius: 0,
                            borderBottomLeftRadius: 0,
                            marginLeft: -spacing.small,
                            borderLeftWidth: 1,
                            borderLeftColor: buttonBorder,                            
                        }}                        
                    />
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    <Button
                        tx={'commonSave'}
                        style={$saveButton}
                        onPress={onSaveConnection}
                    />
                    <Button preset='tertiary' onPress={toggleAddConnectionModal} style={{marginLeft: spacing.small}} tx='commonCancel'/>
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
    paddingBottom: spacing.extraSmall,    
    height: spacing.screenHeight * 0.15, 
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
    fontSize: verticalScale(16),
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
    borderRadius: verticalScale(60 / 2),
    height: verticalScale(60),
    minWidth: verticalScale(120),  
  } 

