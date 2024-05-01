import {observer} from 'mobx-react-lite'
import React, {useEffect, useRef, useState} from 'react'
import {FlatList, Image, InteractionManager, LayoutAnimation, Platform, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import Clipboard from '@react-native-clipboard/clipboard'
import {colors, spacing, typography, useThemeColor} from '../../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import {NostrClient, NostrEvent, NostrFilter, NostrProfile} from '../../services'
import AppError, { Err } from '../../utils/AppError'
import { log } from '../../services/logService'
import { Contact, ContactType } from '../../models/Contact'
import { StackNavigationProp } from '@react-navigation/stack'
import { ContactsStackParamList } from '../../navigation'
import { SendOption } from '../SendOptionsScreen'
import { ReceiveOption } from '../ReceiveOptionsScreen'
import { useSafeAreaInsetsStyle } from '../../utils/useSafeAreaInsetsStyle'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IncomingDataType, IncomingParser } from '../../services/incomingParser'
import { RouteProp } from '@react-navigation/native'


// const defaultPublicNpub = 'npub14n7frsyufzqsxlvkx8vje22cjah3pcwnnyqncxkuj2243jvt9kmqsdgs52'
const defaultPublicNpub = 'npub1kvaln6tm0re4d99q9e4ma788wpvnw0jzkz595cljtfgwhldd75xsj9tkzv'
const maxContactsToLoad = 20

if (Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const PublicContacts = observer(function (props: {    
    navigation: StackNavigationProp<ContactsStackParamList, "Contacts", undefined>,    
    paymentOption: ReceiveOption | SendOption |undefined}
) { 
    const {contactsStore, relaysStore} = useStores()
    const {navigation} = props
    
    const npubInputRef = useRef<TextInput>(null)    
    const relayInputRef = useRef<TextInput>(null)
        
    const [info, setInfo] = useState('')
    const [newPublicPubkey, setNewPublicPubkey] = useState<string>('')
    const [newPublicRelay, setNewPublicRelay] = useState<string>('')    
    
    const [ownProfile, setOwnProfile] = useState<NostrProfile | undefined>(undefined)    
    const [followingPubkeys, setFollowingPubkeys] = useState<string[]>([])
    const [followingProfiles, setFollowingProfiles] = useState<NostrProfile[]>([])
    const [isOwnProfileVisible, setIsOwnProfileVisible] = useState<boolean>(true)
    
    const [isLoading, setIsLoading] = useState(false)        
    const [isNpubModalVisible, setIsNpubModalVisible] = useState(false)
    const [isNpubActionsModalVisible, setIsNpubActionsModalVisible] = useState(false)
    const [isRelayModalVisible, setIsRelayModalVisible] = useState(false)
    const [shouldReload, setShouldReload] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
       
    useEffect(() => {
        const focus = () => {
            npubInputRef && npubInputRef.current
            ? npubInputRef.current.focus()
            : false
        }
  
        if (isNpubModalVisible) {
          setTimeout(() => focus(), 100)
        }
    }, [isNpubModalVisible])


    useEffect(() => {
        const focus = () => {
            relayInputRef && relayInputRef.current
            ? relayInputRef.current.focus()
            : false
        }
  
        if (isRelayModalVisible) {
          setTimeout(() => focus(), 100)
        }
    }, [isRelayModalVisible])

    // Kick-off subscriptions to relay
    useEffect(() => {
        if(!contactsStore.publicPubkey) {
            return
        }

        setOwnProfile({
            pubkey: contactsStore.publicPubkey,
            npub: NostrClient.getNpubkey(contactsStore.publicPubkey),
            name: '',
            nip05: ''
        }) // set backup profile w/o name

        if(relaysStore.allPublicRelays.length === 0) {
            relaysStore.addDefaultRelays()
        }

        InteractionManager.runAfterInteractions(async () => {        
            subscribeToOwnProfileAndPubkeys()
        })
    }, [])


    useEffect(() => {
        if(!shouldReload) {
            return
        }
        log.trace('Reloading...')        
        InteractionManager.runAfterInteractions(async () => {        
            subscribeToOwnProfileAndPubkeys()
            setShouldReload(false)
        })
        
    }, [shouldReload])


    const subscribeToOwnProfileAndPubkeys = async function () {
        log.trace('subscribeToOwnProfileAndPubkeys start')
        if(!contactsStore.publicPubkey) {
            return
        }
        
         const filters: NostrFilter = [{
            authors: [contactsStore.publicPubkey],
            kinds: [0, 3],            
        }]        
          
        log.trace('subscribeToOwnProfileAndPubkeys getEvents')
        const events: NostrEvent[] = await NostrClient.getEvents(relaysStore.allPublicUrls, filters)
        log.trace(events)

        for (const event of events) {
            if(ownProfile && ownProfile.name && followingPubkeys && followingPubkeys.length > 0) {
                continue
            }

            if(event.kind === 0) {
                try {
                    const profile: NostrProfile = JSON.parse(event.content)
                    profile.pubkey = contactsStore.publicPubkey as string // pubkey might not be in ev.content
        
                    log.trace('Updating own profile', profile)    
                    setOwnProfile(profile)                
                } catch(e: any) {
                    continue
                }
            }
            
            if(event.kind === 3) {
                const pubkeys = event.tags
                    .filter((item: [string, string]) => item[0] === "p")
                    .map((item: [string, string]) => item[1])
                
                log.trace('Following pubkeys:', pubkeys.length)
                setFollowingPubkeys(pubkeys)                
            }
        }
    }


    useEffect(() => {
        const loadProfiles = async () => {
            if(followingPubkeys.length === 0) {            
                return
            }

            const filters: NostrFilter[] = [{
                authors: followingPubkeys,
                kinds: [0],
                limit: maxContactsToLoad,            
            }]

            log.trace('Starting following profiles subscription...')
                                    
            setIsLoading(true)

            const events: NostrEvent[] = await NostrClient.getEvents(relaysStore.allPublicUrls, filters)   

            let following: NostrProfile[] = []

            for (const event of events) {
                try {
                    const profile: NostrProfile = JSON.parse(event.content)
    
                    profile.pubkey = event.pubkey
                    profile.npub = NostrClient.getNpubkey(event.pubkey)
                    
                    if (!following.some(f => f.pubkey === profile.pubkey)) {
                        following.push(profile)
                    } else {
                        log.trace('[loadProfiles]', 'Got duplicate profile from relays', profile.pubkey)
                    }
                    
                } catch(e: any) {
                    continue
                }
            }
    
            log.trace('Updating following profiles', following.length)    
            setFollowingProfiles(following)
            setIsLoading(false)
        }

        InteractionManager.runAfterInteractions(async () => { 
            loadProfiles()
        })

        
    }, [followingPubkeys])

    
    const onPastePublicPubkey = async function () {
        const key = await Clipboard.getString()
        if (!key) {
          setInfo('Copy your NPUB key first, then paste')
          return
        }  
        setNewPublicPubkey(key)        
    }


    const resetContactsState = function () {
        setFollowingProfiles([])
        setFollowingPubkeys([])        
    }


    const onSavePublicPubkey = function () {        
        try {
            if(newPublicPubkey && newPublicPubkey.startsWith('npub')) {
                const hexKey = NostrClient.getHexkey(newPublicPubkey)                
                contactsStore.setPublicPubkey(hexKey)                
                resetContactsState()
                setOwnProfile({
                    pubkey: hexKey,
                    npub: newPublicPubkey,
                    name: '',
                    nip05: ''
                })
                toggleNpubModal()

                setTimeout(() => setShouldReload(true), 1000)
                return
            } else {
                throw new AppError(Err.VALIDATION_ERROR, 'Invalid npub key')
            }
        } catch(e: any) {
            handleError(e)
        }
    }


    const onRemovePublicPubKey = function () {
        contactsStore.setPublicPubkey('')
        setNewPublicPubkey('')
        setOwnProfile(undefined)
        resetContactsState()        
        toggleNpubActionsModal()            
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
            if(newPublicRelay) {                
                if(relaysStore.alreadyExists(newPublicRelay)) {
                    setInfo('Relay already exists.')
                    return
                }

                relaysStore.addRelay({
                    url: newPublicRelay,
                    status: WebSocket.CLOSED
                })

                setOwnProfile({
                    pubkey: contactsStore.publicPubkey as string,
                    npub: NostrClient.getNpubkey(contactsStore.publicPubkey as string),
                    name: '',
                    nip05: ''
                })
                resetContactsState()
                toggleRelayModal()
                
                setTimeout(() => setShouldReload(true), 1000)
                return
            }
        } catch(e: any) {
            handleError(e)
        }
    }


    const onRemovePublicRelay = function () {        
        relaysStore.removeRelay(newPublicRelay)

        setOwnProfile({
            pubkey: contactsStore.publicPubkey as string,
            npub: NostrClient.getNpubkey(contactsStore.publicPubkey as string),
            name: '',
            nip05: ''
        }) 

        resetContactsState()     
        toggleRelayModal()

        setTimeout(() => setShouldReload(true), 1000)
    }


    const toggleNpubModal = () => {
        setIsNpubModalVisible(previousState => !previousState)
        if(isNpubActionsModalVisible) {
            toggleNpubActionsModal()
        }
    }


    const toggleNpubActionsModal = () => {
        setIsNpubActionsModalVisible(previousState => !previousState)
    }


    const toggleRelayModal = () => {
        setIsRelayModalVisible(previousState => !previousState)
        if(isNpubActionsModalVisible) {
            toggleNpubActionsModal()
        }
    }


    const gotoContactDetail = async function (contact: Contact) {
        const {paymentOption} = props
        contact.type = ContactType.PUBLIC
        
        
        if(paymentOption && paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST) { // Topup tx contact selection                     
            /*if(contact.nip05) {     // test ifworks and makes sense           
                await NostrClient.verifyNip05(contact.nip05 as string, contact.pubkey) // throws
            }*/
            
            if(paymentOption === ReceiveOption.SEND_PAYMENT_REQUEST) {
                navigation.navigate('WalletNavigator', { 
                    screen: 'Topup',
                    params: {
                        paymentOption, 
                        contact                            
                    },                                            
                })
            }
           
            return
        }


        if(paymentOption && paymentOption === SendOption.SEND_TOKEN) {            

            navigation.navigate('WalletNavigator', { 
                screen: 'Send',
                params: {   
                    paymentOption,                  
                    contact                    
                },
            })
            
            return
        }


        if(paymentOption && paymentOption === SendOption.LNURL_ADDRESS) {
            if(!contact.lud16) {
                setInfo('This contact does not have a Lightning address, send ecash instead.')
                //reset
                navigation.setParams({
                    paymentOption: undefined,
                })
                return
            }
            setIsLoading(true)
            await IncomingParser.navigateWithIncomingData({
                type: IncomingDataType.LNURL_ADDRESS,
                encoded: contact.lud16
            }, navigation)
            setIsLoading(false)

            //reset
            navigation.setParams({
                paymentOption: undefined,
            })
            
            return
        }

        log.trace('[gotoContactDetail]', contact)

        navigation.navigate('ContactDetail', {
            contact            
        })
    }


    const collapseProfile = function () {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)        
        setIsOwnProfileVisible(false)
        
    }

    const expandProfile = function () {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
        setIsOwnProfileVisible(true)
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const insets = useSafeAreaInsets()
    const inputBg = useThemeColor('background')
    
    return (
    <Screen contentContainerStyle={$screen}>
        <View style={[$contentContainer, !isOwnProfileVisible && {marginTop: -100}]}>
        {!contactsStore.publicPubkey && (
            <Card
                ContentComponent={
                    <ListItem
                        leftIcon='faComment'
                        leftIconInverse={true}
                        leftIconColor={colors.palette.iconViolet200}
                        text='Tip the people you follow'
                        subText={'Add your NOSTR social network public key (npub) and tip or donate to your favourite people and projects directly from the minibits wallet.'}
                        onPress={toggleNpubModal}
                    />                
                }
                style={$card}                
            />                   
        )}
        {ownProfile && (            
            <Card
                ContentComponent={
                    <ListItem                        
                        LeftComponent={
                            <View style={{marginRight: spacing.medium, borderRadius: 20, overflow: 'hidden' }}>
                                {ownProfile.picture ? (
                                    <Image 
                                        source={{uri: ownProfile.picture}}
                                        style={{width: 40, height: 40}}
                                    />
                                ) : (
                                    <Icon icon='faCircleUser' size={35} color={inputBg} />
                                )}
                            </View>
                        }
                        text={ownProfile.name}
                        subText={isOwnProfileVisible ? relaysStore.allPublicUrls.toString() : undefined}
                        onPress={toggleNpubActionsModal}
                        rightIcon={'faEllipsisVertical'}                                                                            
                    />
                }
                style={$card}           
            />            
        )}
        {followingProfiles.length > 0 && (                           
            <Card
                ContentComponent={
                <>
                    <FlatList<NostrProfile>
                        data={followingProfiles}
                        renderItem={({ item, index }) => {
                            const isFirst= index === 0
                            return(
                                <ListItem 
                                    key={item.picture}
                                    LeftComponent={
                                        <View style={{marginRight: spacing.medium, borderRadius: 20, overflow: 'hidden'}}>
                                            {item.picture ? (
                                                <Image 
                                                    source={{uri: item.picture}}
                                                    style={{width: 40, height: 40}}
                                                />
                                            ) : (
                                                <Icon icon='faCircleUser' size={35} color={inputBg} />
                                            )}
                                        </View>}
                                    text={item.name}
                                    subText={(item.nip05) ? item.nip05 : undefined}
                                    topSeparator={isFirst ? false : true}
                                    onPress={() => gotoContactDetail(item as Contact)}                                  
                                />
                            ) 
                        }}
                        onScrollBeginDrag={collapseProfile}                                                
                        onStartReached={expandProfile}                        
                        keyExtractor={(item) => item.pubkey}
                        contentInset={insets}
                        style={{ maxHeight: spacing.screenHeight * 0.72 }}
                        // contentContainerStyle={{paddingBottom: 200}}
                    />
                </>
                }
                style={$card}                
            />
        )}        
        </View>
        {isLoading && <Loading />}
        <BottomModal
          isVisible={isNpubActionsModalVisible}
          style={{alignItems: 'stretch'}}
          ContentComponent={
            <>
                <ListItem
                    leftIcon='faKey'
                    text='Set your public key'
                    subText={'Add or change your NOSTR social network public key (npub).'}
                    onPress={toggleNpubModal}
                    bottomSeparator={true}
                />
                <ListItem
                    leftIcon='faCircleNodes'
                    text='Set relay'
                    subText={'Add or change your own relay if your profile and follows are not hosted on the default relays.'}
                    onPress={toggleRelayModal}
                    bottomSeparator={true}
                />
                <ListItem
                    leftIcon='faBan'
                    text='Remove your public key'
                    subText={'Remove your npub key and stop loading public contacts.'}
                    onPress={onRemovePublicPubKey}
                /> 
            </>
          }
          onBackButtonPress={toggleNpubActionsModal}
          onBackdropPress={toggleNpubActionsModal}
        />      
        <BottomModal
          isVisible={isNpubModalVisible}          
          ContentComponent={
            <View style={$newContainer}>
                <Text text='Add your npub key' preset="subheading" />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                    <TextInput
                        ref={npubInputRef}
                        onChangeText={(key) => setNewPublicPubkey(key)}
                        value={newPublicPubkey}
                        autoCapitalize='none'
                        keyboardType='default'
                        maxLength={64}
                        placeholder='npub...'
                        selectTextOnFocus={true}
                        style={[$npubInput, {backgroundColor: inputBg}]}                        
                    />
                    <Button
                        tx={'common.paste'}
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPastePublicPubkey}
                    />
                    <Button
                        tx={'common.save'}
                        style={$saveButton}
                        onPress={onSavePublicPubkey}
                    />
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
                    <Button preset='tertiary' onPress={() => setNewPublicPubkey(defaultPublicNpub)} text='Paste demo key'/>
                    <Button preset='tertiary' onPress={toggleNpubModal} text='Cancel'/>                    
                </View>                
            </View>
          }
          onBackButtonPress={toggleNpubModal}
          onBackdropPress={toggleNpubModal}
        />
        <BottomModal
          isVisible={isRelayModalVisible ? true : false}          
          ContentComponent={
            <View style={$newContainer}>
                <Text text='Set your own relay' preset="subheading" />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                    <TextInput
                        ref={relayInputRef}
                        onChangeText={(url) => setNewPublicRelay(url)}
                        value={newPublicRelay}
                        autoCapitalize='none'
                        keyboardType='default'
                        maxLength={64}
                        placeholder='wss://...'
                        selectTextOnFocus={true}
                        style={[$npubInput, {backgroundColor: inputBg}]}                        
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
                    {newPublicRelay && (                   
                        <Button preset='tertiary' onPress={onRemovePublicRelay} text='Reset to default'/>                    
                    )}
                    <Button preset='tertiary' onPress={toggleRelayModal} text='Cancel'/>                    
                </View>                
            </View>
          }
          onBackButtonPress={toggleRelayModal}
          onBackdropPress={toggleRelayModal}
        />  
        {info && <InfoModal message={info} />}
        {error && <ErrorModal error={error} />}
    </Screen>
    )
  })


const $screen: ViewStyle = {
    flex: 1,
    // paddingBottom: 200,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingBottom: spacing.medium,
    // height: spacing.screenHeight * 0.18,
}

const $pasteButton: ViewStyle = {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    alignSelf: 'stretch',
    justifyContent: 'center', 
}

const $saveButton: ViewStyle = {
    borderRadius: spacing.extraSmall,
    marginLeft: spacing.small,
}

const $contentContainer: TextStyle = {
    //flex: 0.85,
    padding: spacing.extraSmall,
  }

const $card: ViewStyle = {
    marginBottom: spacing.small,
    // flex: 1,  
}

const $bottomModal: ViewStyle = {
  // flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
    paddingHorizontal: spacing.small,
    paddingLeft: 0,
}

const $newContainer: TextStyle = {
    padding: spacing.small,
    alignItems: 'center',
}

const $npubInput: TextStyle = {
    flex: 1,    
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
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
    minWidth: verticalScale(130),    
  }  
