import {observer} from 'mobx-react-lite'
import { Observer } from 'mobx-react-lite'
import Clipboard from '@react-native-clipboard/clipboard'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import { Relay } from '../models/Relay'
import AppError, { Err } from '../utils/AppError'
import { log, WalletTask } from '../services'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { translate } from '../i18n'
import { NotificationService } from '../services/notificationService'

interface SettingsScreenProps extends SettingsStackScreenProps<'Relays'> {}

export const RelaysScreen: FC<SettingsScreenProps> = observer(
  function RelaysScreen(_props) {
    const {navigation} = _props

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        rightIcon: 'faRotate',
        onRightPress: () => onConnect()
    })

    const newRelayInputRef = useRef<TextInput>(null)
    const {relaysStore, nwcStore, walletProfileStore} = useStores()
    
    const [selectedRelay, setSelectedRelay] = useState<Relay | undefined>()
    const [isAddRelayModalVisible, setIsAddRelayModalVisible] = useState(false)
    const [newPublicRelay, setNewPublicRelay] = useState<string>('')
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isRemoteDataPushEnabled, setIsRemoteDataPushEnabled] = useState<boolean>(false)

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
    
    const toggleAddRelayModal = () => {
        setIsAddRelayModalVisible(previousState => !previousState)
        if(selectedRelay) {
            setSelectedRelay(undefined)
        }
    }

    const onRelaySelect = function (relay: Relay) {
        setSelectedRelay(relay)
    }
  
    const onRelayUnselect = function () {
        setSelectedRelay(undefined)
    }

    const removeRelay = function () {
        relaysStore.removeRelay(selectedRelay?.url as string)
        setSelectedRelay(undefined)        
    }

    const onConnect = async function () {
        log.trace('onConnect')    
        
        // Full force re-subscription, not just reconnect
        WalletTask.receiveEventsFromRelays().catch(e => false)

        // Subscribe to NWC events if we have some connections
        if(!isRemoteDataPushEnabled) {          
          nwcStore.receiveNwcEvents()  
        }
        setSelectedRelay(undefined)        
    }

    const gotoAdd = function () {        
        toggleAddRelayModal()
    }
    
    const onPastePublicRelay = async function () {
        const url = await Clipboard.getString()
        if (!url) {
            setInfo(translate('relayurlPasteError'))
            return
        }  
        setNewPublicRelay(url)        
    }

    const onSavePublicRelay = function () {        
        try {
          if(!newPublicRelay.startsWith('ws')) {
            throw new AppError(
              Err.VALIDATION_ERROR, 
              translate("invalidRelayUrl"), 
              newPublicRelay
            )
          }

          if(relaysStore.alreadyExists(newPublicRelay)) {
            setInfo(translate('relayExists'))
            return
          }

          relaysStore.addRelay({
            url: newPublicRelay,
            status: WebSocket.CLOSED
          })
          
          toggleAddRelayModal()
          onConnect()

        } catch(e: any) {
          handleError(e)
        }
    }


    const resetDefaultRelays = function () {
        try {
            for (const relay of relaysStore.allPublicRelays) {
              relaysStore.removeRelay(relay.url)
            }

            relaysStore.addDefaultRelays()

            toggleAddRelayModal()
            onConnect()
        } catch (e: any) {
            handleError(e)
        }
    }

    const handleError = function (e: AppError): void {        
        setIsAddRelayModalVisible(false)
        setError(e)
    }
    
    const $itemRight = {color: useThemeColor('textDim')}
    const iconColor = useThemeColor('textDim')
    const headerBg = useThemeColor('header')
    const inputBg = useThemeColor('background')
    const iconBottom = useThemeColor('button')
    const mainButtonColor = useThemeColor('card')
    const screenBg = useThemeColor('background')
    const mainButtonIcon = useThemeColor('button')
    const headerTitle = useThemeColor('headerTitle') 
    
    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset='heading'
            text='Relays'
            style={{color: headerTitle}}
          />
        </View>
        <View style={$contentContainer}>          
            <Card
                style={[$card, {marginTop: spacing.medium}]}
                ContentComponent={
                <>   
                    <FlatList<Relay>
                        data={relaysStore.allRelays}
                        extraData={relaysStore.allRelays}
                        renderItem={({ item, index }) => {                                
                            return <Observer>{() => (
                                <ListItem
                                    text={item.hostname}
                                    subText={item.error ? item.error : item.url}
                                    leftIcon='faCircleNodes'
                                    leftIconColor={iconColor as string}
                                    topSeparator={index === 0 ? false : true}                                
                                    RightComponent={
                                        <View style={$rightContainer}>
                                            {item.status === WebSocket.OPEN ? (
                                                <Icon icon='faCheckCircle' color={colors.palette.success200} />
                                            ) : (item.status === WebSocket.CLOSED ? (
                                                <Icon icon='faBan' color={colors.palette.angry500} />
                                            ) : (
                                                <Icon icon='faRotate' color={colors.palette.accent300} />
                                            ))}
                                        </View>
                                    }
                                    style={$item}
                                    onPress={() => onRelaySelect(item)}
                                />
                            )}</Observer>
                        }}                
                        keyExtractor={(item) => item.url} 
                        style={{ flexGrow: 0 }}
                    />  
                    
                </>
            }
            />
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
                    text='Add'
                />
            </View>
        </View>
        <BottomModal
          isVisible={selectedRelay ? true : false}
          style={{alignItems: 'stretch'}}          
          ContentComponent={
            <View style={{}}>
                {selectedRelay?.status === WebSocket.CLOSED && (
                    <ListItem
                        leftIcon="faCloudArrowUp"
                        onPress={onConnect}
                        tx="common.reconnect"
                        bottomSeparator={true}
                        style={{paddingHorizontal: spacing.medium}}
                    />    
                )}         
                <ListItem
                leftIcon="faXmark"
                    onPress={removeRelay}
                    tx="removeRelay"
                    style={{paddingHorizontal: spacing.medium}}
                />
            </View>
          }
          onBackButtonPress={onRelayUnselect}
          onBackdropPress={onRelayUnselect}
        />
        <BottomModal
          isVisible={isAddRelayModalVisible ? true : false}          
          ContentComponent={
            <View style={$newContainer}>
                <Text text='Set your own relay' preset="subheading" />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                    <TextInput
                        ref={newRelayInputRef}
                        onChangeText={(url) => setNewPublicRelay(url)}
                        value={newPublicRelay}
                        autoCapitalize='none'
                        keyboardType='default'
                        maxLength={128}
                        placeholder='wss://...'
                        selectTextOnFocus={true}
                        style={[$relayInput, {backgroundColor: inputBg}]}
                    />
                    <Button
                        tx={'common.paste'}
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPastePublicRelay}
                    />
                    <Button
                        tx={'common.save'}
                        style={$saveButton}
                        onPress={onSavePublicRelay}
                    />
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    <Button preset='tertiary' onPress={resetDefaultRelays} tx='common.resetDefault' />
                    <Button preset='tertiary' onPress={toggleAddRelayModal} style={{marginLeft: spacing.small}} text='Cancel'/>
                </View>                
            </View>
          }
          onBackButtonPress={toggleAddRelayModal}
          onBackdropPress={toggleAddRelayModal}
        />
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
  padding: spacing.medium,
  height: spacing.screenHeight * 0.1,
}

const $contentContainer: TextStyle = {
  flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $newContainer: TextStyle = {
    padding: spacing.small,
    alignItems: 'center',
}


const $pasteButton: ViewStyle = {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    alignSelf: 'stretch',
    justifyContent: 'center', 
}

const $saveButton: ViewStyle = {
    borderRadius: spacing.small,
    marginLeft: spacing.small,
}

const $relayInput: TextStyle = {
    flex: 1,    
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
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
    // alignSelf: 'center',
    // opacity: 0,
  }
  
  const $buttonNew: ViewStyle = {
    borderRadius: verticalScale(60 / 2),
    height: verticalScale(60),
    minWidth: verticalScale(120),  
  } 

