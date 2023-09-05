import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useRef, useState} from 'react'
import {ColorValue, Share, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {ContactsStackScreenProps} from '../navigation'
import {Icon, ListItem, Screen, Text, Card, BottomModal, Button, InfoModal, ErrorModal, Header, Loading} from '../components'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import AppError, { Err } from '../utils/AppError'
import { ProfileHeader } from './Contacts/ProfileHeader'
import Clipboard from '@react-native-clipboard/clipboard'
import { log } from '../utils/logger'
import { NostrClient } from '../services'

interface OwnKeysScreenProps extends ContactsStackScreenProps<'OwnKeys'> {}

export const OwnKeysScreen: FC<OwnKeysScreenProps> = observer(function OwnKeysScreen({navigation}) {    

    const {walletProfileStore} = useStores() 

    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
        title: walletProfileStore.nip05,
        titleStyle: {fontFamily: typography.primary?.medium}      
    })

    const ownNip05InputRef = useRef<TextInput>(null)
    const ownNsecInputRef = useRef<TextInput>(null) 
    const {npub, name, picture, nip05} = walletProfileStore    

    const [ownNip05, setOwnNip05] = useState<string>('')
    const [ownNsec, setOwnNsec] = useState<string>('')
    const [serverPubkey, setServerPubkey] = useState<string | undefined>(undefined)
    const [serverRelays, setServerRelays] = useState<string[]>([])    
    const [info, setInfo] = useState('')    
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false)    

    const onPasteOwnNip05 = async function () {
        const name = await Clipboard.getString()
        if (!name) {
          setInfo('Copy your nip05 name first, then paste.')
          return
        }  
        setOwnNip05(name)        
    }


    const onConfirmOwnNip05 = async function () {
        try {
            setIsLoading(true)
            const nip05Record = await NostrClient.getNip05Record(ownNip05)
            const nip05Name = NostrClient.getNameFromNip05(ownNip05)
            let pubkey: string = ''
            let relays: string[] = []

            if (nip05Record && nip05Record.names[nip05Name as string].length > 0) {
                pubkey = nip05Record.names[nip05Name as string]
                setServerPubkey(pubkey)

                log.trace('Got pubkey from server', pubkey, 'onConfirmOwnNip05')

                if(nip05Record && nip05Record.relays[pubkey].length > 0) {
                    relays = nip05Record.relays[pubkey]
                    setServerRelays(relays)

                    log.trace('Got relays from server', relays, 'onConfirmOwnNip05')
                }                
            }
            setIsLoading(false)
        } catch(e: any) {
            handleError(e)
        }
    }


    const onPasteOwnNsec = async function () {
        const key = await Clipboard.getString()
        if (!key) {
          setInfo('Copy your nsec key first, then paste.')
          return
        }  
        setOwnNsec(key)        
    }


    const onConfirmOwnNsec = async function () {
        try {
            setIsLoading(true)
            

            
            setIsLoading(false)
        } catch(e: any) {
            handleError(e)
        }
    }


    const handleError = function (e: AppError): void {        
        setError(e)
    }

    const iconNip05 = useThemeColor('textDim')
    const textPubkey = useThemeColor('textDim')
    const inputBg = useThemeColor('background')
    
    return (
      <Screen contentContainerStyle={$screen} preset='auto'>
        <View style={$contentContainer}>
          <Card
            style={$card}
            ContentComponent={
                <>
                {!serverPubkey ? (
                    <View style={$nip05Container}>e                        
                        <ListItem
                            LeftComponent={<View style={[$numIcon, {backgroundColor: iconNip05}]}><Text text='1'/></View>}
                            text='Enter your nip05 identifier'
                            subText={'Minibits uses nip05 as a sharable contact to send and receive coins. You need to provide one linked to your NOSTR key that you will add next.'}                        
                            bottomSeparator={true}
                            style={{}}
                        />                    
                        <View style={{flexDirection: 'row', alignItems: 'center', marginVertical: spacing.medium}}>
                        
                            <TextInput
                                ref={ownNip05InputRef}
                                onChangeText={(name) => setOwnNip05(name)}
                                value={ownNip05}
                                autoCapitalize='none'
                                keyboardType='default'
                                maxLength={30}
                                placeholder='name@domain.com'
                                selectTextOnFocus={true}
                                style={[$nip05Input, {backgroundColor: inputBg}]}
                                editable={serverPubkey ? false : true}                        
                            />
                            <Button
                                tx={'common.paste'}
                                preset='secondary'
                                style={$pasteButton}
                                disabled={serverPubkey ? true : false}
                                onPress={onPasteOwnNip05}
                            />
                            <Button
                                tx={'common.confirm'}
                                style={$saveButton}
                                onPress={onConfirmOwnNip05}
                                disabled={serverPubkey ? true : false}
                            />                        
                        </View>     
                    </View>
                ) : (
                    <>
                        <ListItem
                            LeftComponent={<View style={[$numIcon, {backgroundColor: iconNip05}]}><Text text='1'/></View>}
                            text={ownNip05}
                        />
                        <ListItem
                            leftIcon='faKey'
                            text='Public key'
                            subText={NostrClient.getNpubkey(serverPubkey)}                        
                            topSeparator={true}
                            style={{}}
                        />
                        {serverRelays.length > 0 && (
                            <ListItem
                                leftIcon='faCircleNodes'
                                text='Relays'
                                subText={serverRelays.toString()}                        
                                topSeparator={true}
                                style={{}}
                            />
                        )}
                    </>
                )} 


                </>
            }
          />
          {serverPubkey && (
            <Card
                style={[$card, {marginTop: spacing.medium}]}
                ContentComponent={
                    <View style={$nip05Container}>                       
                        <ListItem
                            LeftComponent={<View style={[$numIcon, {backgroundColor: iconNip05}]}><Text text='2'/></View>}
                            text='Enter your private key'
                            subText={'Minibits needs your private key in nsec format in order to decrypt messages containing incoming payments. Your key will be stored in your device secure key vault.'}                        
                            bottomSeparator={true}
                            style={{}}
                        />
                        <View style={{flexDirection: 'row', alignItems: 'center', marginVertical: spacing.medium}}>
                        
                        <TextInput
                            ref={ownNsecInputRef}
                            onChangeText={(name) => setOwnNsec(name)}
                            value={ownNsec}
                            autoCapitalize='none'
                            keyboardType='default'
                            maxLength={64}
                            placeholder='nsec...'
                            selectTextOnFocus={true}
                            style={[$nip05Input, {backgroundColor: inputBg}]}                                                
                        />
                        <Button
                            tx={'common.paste'}
                            preset='secondary'
                            style={$pasteButton}                            
                            onPress={onPasteOwnNsec}
                        />
                        <Button
                            tx={'common.confirm'}
                            style={$saveButton}
                            onPress={onConfirmOwnNsec}                            
                        />                        
                    </View>
                    </View>
                }
            />
          )}

        </View>
        <View style={$bottomContainer}>
    
        </View>
        {isLoading && <Loading />}
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
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
    height: spacing.screenHeight * 0.18,
}

const $numIcon: ViewStyle = {
    width: 30, 
    height: 30, 
    borderRadius: 15, 
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.medium
}

const $contentContainer: TextStyle = {
    // flex: 1,
    padding: spacing.extraSmall,
    // alignItems: 'center',
}

const $nip05Container: TextStyle = {
    // padding: spacing.small,
    // alignItems: 'center',
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

const $nip05Input: TextStyle = {
    flex: 1,    
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $bottomModal: ViewStyle = {
    // flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,
}

const $bottomContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flex: 1,
    justifyContent: 'flex-end',    
    alignSelf: 'stretch',    
  }

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
}

const $qrCodeContainer: ViewStyle = {
    backgroundColor: 'white',
    padding: spacing.small,
    margin: spacing.small,
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

