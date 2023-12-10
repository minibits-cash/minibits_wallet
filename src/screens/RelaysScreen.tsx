import {observer} from 'mobx-react-lite'
import { Observer } from 'mobx-react-lite'
import Clipboard from '@react-native-clipboard/clipboard'
import React, {FC, useCallback, useEffect, useRef, useState} from 'react'
import {FlatList, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, useThemeColor} from '../theme'
import {SettingsStackScreenProps} from '../navigation' // @demo remove-current-line
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import { Relay } from '../models/Relay'
import AppError, { Err } from '../utils/AppError'
import { log, Wallet } from '../services'
import { verticalScale } from '@gocodingnow/rn-size-matters'

interface SettingsScreenProps extends SettingsStackScreenProps<'Relays'> {}


export const RelaysScreen: FC<SettingsScreenProps> = observer(
  function RelaysScreen(_props) {
    const {navigation} = _props

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const newRelayInputRef = useRef<TextInput>(null)
    const {relaysStore} = useStores()
    
    const [selectedRelay, setSelectedRelay] = useState<Relay | undefined>()
    const [isAddRelayModalVisible, setIsAddRelayModalVisible] = useState(false)
    const [newPublicRelay, setNewPublicRelay] = useState<string>('')
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    
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

    const onConnect = function () {
        log.trace('onConnect')
        Wallet.checkPendingReceived().catch(handleError)
        setSelectedRelay(undefined)        
    }

    const gotoAdd = function () {        
        toggleAddRelayModal()
    }
    
    const onPastePublicRelay = async function () {
        const url = await Clipboard.getString()
        if (!url) {
          setInfo('Copy your relay URL key first, then paste')
          return
        }  
        setNewPublicRelay(url)        
    }


    const onSavePublicRelay = function () {        
        try {
            if(newPublicRelay && newPublicRelay.startsWith('wss://')) {
                if(relaysStore.alreadyExists(newPublicRelay)) {
                    setInfo('Relay already exists.')
                    return
                }

                relaysStore.addOrUpdateRelay({
                    url: newPublicRelay,
                    status: WebSocket.CLOSED
                })
                
                toggleAddRelayModal()
                onConnect()
            } else {
                throw new AppError(Err.VALIDATION_ERROR, 'Invalid relay URL.', newPublicRelay)
            }
        } catch(e: any) {
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
    
    return (
      <Screen contentContainerStyle={$screen} preset='fixed'>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset='heading'
            text='Relays'
            style={{color: 'white'}}
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
                    tx={'contactsScreen.new'}
                    LeftAccessory={() => (
                        <Icon
                        icon='faCircleNodes'
                        color='white'
                        size={spacing.medium}                  
                        />
                    )}
                    onPress={gotoAdd}
                    style={$buttonNew}
                />                
            </View>
        </View>
        <BottomModal
          isVisible={selectedRelay ? true : false}
          style={{alignItems: 'stretch'}}          
          ContentComponent={
            <View style={{}}> 
              <ListItem
                leftIcon="faCloudArrowUp"
                onPress={onConnect}
                text={'Reconnect'}
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />             
              <ListItem
                leftIcon="faXmark"
                onPress={removeRelay}
                text={'Remove relay'}
                bottomSeparator={true}
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
                        maxLength={64}
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
                    <Button preset='tertiary' onPress={toggleAddRelayModal} text='Cancel'/>                    
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
  // flex: 1,
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
    alignSelf: 'center',
}

const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: spacing.medium,
    alignSelf: 'stretch',
    // opacity: 0,
  }
  
  const $buttonNew: ViewStyle = {
    borderRadius: 30,    
    minWidth: verticalScale(110),    
  } 

