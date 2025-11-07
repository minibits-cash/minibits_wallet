import {observer} from 'mobx-react-lite'
import React, {useEffect, useRef, useState} from 'react'
import {FlatList, Image, InteractionManager, LayoutAnimation, Platform, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {verticalScale} from '@gocodingnow/rn-size-matters'
import { Metadata, Contacts } from 'nostr-tools/kinds'
import Clipboard from '@react-native-clipboard/clipboard'
import {colors, spacing, useThemeColor} from '../../theme'
import useCallbackState from '../../utils/useCallbackState'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import {NostrClient, NostrEvent, NostrFilter, NostrProfile} from '../../services'
import AppError, { Err } from '../../utils/AppError'
import { log } from '../../services/logService'
import { Contact, ContactType } from '../../models/Contact'
import { SendOption } from '../SendScreen'
import { ReceiveOption } from '../ReceiveScreen'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IncomingDataType, IncomingParser } from '../../services/incomingParser'
import { translate } from '../../i18n'
import { useNavigation } from '@react-navigation/native'
import { set, toJS } from 'mobx'
import FastImage from 'react-native-fast-image'
import { TransferOption } from '../TransferScreen'
import numbro from 'numbro'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'


// const defaultPublicNpub = 'npub14n7frsyufzqsxlvkx8vje22cjah3pcwnnyqncxkuj2243jvt9kmqsdgs52'
const defaultPublicNpub = 'npub1kvaln6tm0re4d99q9e4ma788wpvnw0jzkz595cljtfgwhldd75xsj9tkzv'
const maxContactsToLoad = 20

export const PublicContactsNew = observer(function (props: {
    paymentOption: ReceiveOption | SendOption | TransferOption | undefined}
) {
    const {contactsStore, relaysStore, userSettingsStore, walletProfileStore} = useStores()
    const navigation = useNavigation()
    
    const npubInputRef = useRef<TextInput>(null)    
    const relayInputRef = useRef<TextInput>(null)
    const searchInputRef = useRef<TextInput>(null)
        
    const [info, setInfo] = useState('')
    const [newPublicPubkey, setNewPublicPubkey] = useState<string>('')
    const [newPublicRelay, setNewPublicRelay] = useState<string>('')    
    
    const [maybeOwnProfile, setMaybeOwnProfile] = useState<NostrProfile | undefined>(undefined)
    const [ownProfile, setOwnProfile] = useState<NostrProfile | undefined>(undefined)    
    const [followingPubkeys, setFollowingPubkeys] = useState<string[]>([])
    const [followingProfiles, setFollowingProfiles] = useState<NostrProfile[]>([])
    
    const [isLoading, setIsLoading] = useState(false)        
    const [isNpubModalVisible, setIsNpubModalVisible] = useState(false)
    const [isMaybeOwnProfileVisible, setIsMaybeOwnProfileVisible] = useState(false)
    const [isNpubActionsModalVisible, setIsNpubActionsModalVisible] = useState(false)
    const [isRelayModalVisible, setIsRelayModalVisible] = useState(false)
    const [shouldReload, setShouldReload] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [searchQuery, setSearchQuery] = useState('dev@minibits.cash')
    const [searchProfiles, setSearchProfiles] = useState<NostrProfile[]>([])

           
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
        // deafult search for Minibits profile
        onSearchProfiles()        
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
        log.trace('[subscribeToOwnProfileAndPubkeys] start')
        if(!contactsStore.publicPubkey) {
            return
        }
        
         const filter: NostrFilter = {
            authors: [contactsStore.publicPubkey],
            kinds: [Metadata, Contacts],            
        }
          
        log.trace('[subscribeToOwnProfileAndPubkeys] getEvents')
        const events: NostrEvent[] = await NostrClient.getEvents(relaysStore.allPublicUrls, filter)
        log.trace(events)

        for (const event of events) {
            if(ownProfile && ownProfile.name && followingPubkeys && followingPubkeys.length > 0) {
                continue
            }

            if(event.kind === Metadata) {
                try {
                    const profile: NostrProfile = JSON.parse(event.content)
                    profile.pubkey = contactsStore.publicPubkey as string // pubkey might not be in ev.content
        
                    log.trace('[subscribeToOwnProfileAndPubkeys] Updating own profile', profile)    
                    setOwnProfile(profile)                
                } catch(e: any) {
                    continue
                }
            }
            
            if(event.kind === Contacts) {
                const pubkeys = event.tags
                    .filter((item) => item[0] === "p")
                    .map((item) => item[1])
                
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

            const filter: NostrFilter = {
                authors: followingPubkeys,
                kinds: [Metadata],
                limit: maxContactsToLoad,            
            }

            log.trace('[loadProfiles] Starting following profiles subscription...')
                                    
            setIsLoading(true)

            const events: NostrEvent[] = await NostrClient.getEvents(relaysStore.allPublicUrls, filter)   

            let following: NostrProfile[] = []

            for (const event of events) {
                try {
                    const profile: NostrProfile = JSON.parse(event.content)
    
                    profile.pubkey = event.pubkey
                    profile.npub = NostrClient.getNpubkey(event.pubkey)
                    
                    // fix potentially invalid types
                    if(profile.nip05) profile.nip05 = String(profile.nip05)
                    if(profile.picture) profile.picture = String(profile.picture)
                    if(profile.name) profile.name = String(profile.name)
                    
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

    const onChangeSerchQuery = async function (text: string) {
        setSearchQuery(text)
    }

    const onSearchOwnProfile = async function () {
        // attempt to search for nostr profile that has wallet address set as lud16
        // and default such profile as own public profile
        setIsLoading(true)
        try {
            const filter: NostrFilter = {
                kinds: [Metadata],
                search: walletProfileStore.nip05,
                limit: 5
            }

            const events = await NostrClient.getEvents(NostrClient.getSearchRelays(), filter)
            let maybeProfile: NostrProfile | undefined = undefined

            for (const event of events) {
                const profile: NostrProfile = JSON.parse(event.content)

                log.trace('[onPreloadOwnPubkey]', 'Checking profile from search', profile)

                // filter out minibits wallet profiles
                if(profile.nip05 && profile.nip05 !== walletProfileStore.nip05) {                    
                    
                    // make sure search returned a profile where lud16 matches wallet address
                    if(profile.lud16 && profile.lud16 === walletProfileStore.nip05) {
                        log.trace('[onPreloadOwnPubkey]', 'Got matching profile', {name: profile.name, nip05: profile.nip05, lud16: profile.lud16})

                        const npub = NostrClient.getNpubkey(event.pubkey)
                        profile.pubkey = event.pubkey
                        profile.npub = npub                        
                        maybeProfile = profile
                        break                        
                    }
                }
            }

            setIsLoading(false)
            log.trace('[onPreloadOwnPubkey]', 'Found maybe own profile', maybeProfile)            
            if(maybeProfile) {
                
                setMaybeOwnProfile(maybeProfile)
                toggleMaybeOwnProfileModal()
            } else {
                toggleNpubModal()
            }
            
        } catch (e: any) {
            // silent
            log.error('[onPreloadOwnPubkey] error:', e.message)
            setIsLoading(false)
            toggleNpubModal()
        }
    }
    
    const onPastePublicPubkey = async function () {
        const key = await Clipboard.getString()
        if (!key) {
          setInfo(translate("contactsScreen_publicContacts_npubPasteError"))
          return
        }  
        setNewPublicPubkey(key.trim())        
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
                onClearSearch()

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
          setInfo(translate("relayurlPasteError"))
          return
        }  
        setNewPublicRelay(url)        
    }


    const onMaybeOwnProfileConfirm = () => {
        if(!maybeOwnProfile) {
            toggleMaybeOwnProfileModal()
            return
        }

        try {            
            const hexKey = NostrClient.getHexkey(maybeOwnProfile.npub)                
            contactsStore.setPublicPubkey(hexKey)                
            resetContactsState()
            setOwnProfile({
                pubkey: hexKey,
                npub: maybeOwnProfile.npub,
                name: '',
                nip05: ''
            })
            toggleMaybeOwnProfileModal()
            onClearSearch()

            setTimeout(() => setShouldReload(true), 1000)            

        } catch(e: any) {
            handleError(e)
        }
    }


    const onMaybeOwnProfileCancel = () => {
        setMaybeOwnProfile(undefined)
        toggleMaybeOwnProfileModal()
        toggleNpubModal()
    }


    const onSavePublicRelay = function () {        
        try {
            if(newPublicRelay) {                
                if(relaysStore.alreadyExists(newPublicRelay)) {
                    setInfo(translate("relayExists"))
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

    const toggleMaybeOwnProfileModal = () => {
        setIsMaybeOwnProfileVisible(previousState => !previousState)
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
                //@ts-ignore
                navigation.navigate('WalletNavigator', {
                    screen: 'Topup',
                    params: {
                      paymentOption, 
                      contact: toJS(contact),
                      unit: userSettingsStore.preferredUnit                       
                    }                  
                })
           
                return
            }
        }


        if(paymentOption && paymentOption === SendOption.SEND_TOKEN) {
            //@ts-ignore
            navigation.navigate('WalletNavigator', {
                screen: 'Send',
                params: {
                    paymentOption, 
                    contact: toJS(contact),
                    unit: userSettingsStore.preferredUnit                       
                }                  
            })

            return
        }


        if(paymentOption && paymentOption === TransferOption.LNURL_ADDRESS) {
            if(!contact.lud16) {
                setInfo(translate('contactHasNoLightningAddrUseEcash'))
                //reset
                //@ts-ignore
                navigation.setParams({
                    paymentOption: undefined,
                })
                return
            }
            setIsLoading(true)
            await IncomingParser.navigateWithIncomingData({
                type: IncomingDataType.LNURL_ADDRESS,
                encoded: contact.lud16
            }, navigation, userSettingsStore.preferredUnit)
            
            setIsLoading(false)

            //reset
            //@ts-ignore
            navigation.setParams({
                paymentOption: undefined,
            })
            
            return
        }

        log.trace('[gotoContactDetail]', contact)
        //@ts-ignore
        navigation.navigate('ContactDetail', {contact: toJS(contact)})
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }

    const onSearchProfiles = async function () {
        if (!searchQuery.trim()) return
        setSearchProfiles([])
        setIsLoading(true)
        try {
            let results: NostrProfile[] = []
            if (searchQuery.includes('@')) {
                // NIP05 exact match search
                const profile = await NostrClient.getNormalizedNostrProfile(searchQuery.toLowerCase(), relaysStore.allPublicUrls)
                
                if (profile) {       
                    const followersFilter = {
                        kinds: [Contacts],
                        "#p": [profile.pubkey],
                    }

                    /*const count = await NostrClient.getCount([followersFilter])

                    log.trace('[onSearchProfiles] Followers count', {pubkey: profile.pubkey, count})

                    if(count !== null) {
                        profile.followersCount = count
                    }*/

                    results.push(profile)
                }
            } else {
                // Username search
                const filter: NostrFilter = {
                    kinds: [Metadata],
                    search: searchQuery,
                    limit: 10
                }

                const events = await NostrClient.getEvents(NostrClient.getSearchRelays(), filter)
                const profiles: NostrProfile[] = []
                for (const event of events) {
                    try {
                        const profile: NostrProfile = JSON.parse(event.content)
                        if(!profile.name) {
                            profile.name = NostrClient.getNameFromNip05(profile.nip05) as string
                        }
                    
                        if(!profile.pubkey) {
                            profile.pubkey = event.pubkey
                        }            
                        
                        const npub = NostrClient.getNpubkey(profile.pubkey)
                        profile.npub = npub

                        const followersFilter = {
                            kinds: [Contacts],
                            "#p": [profile.pubkey],
                        }

                        /*const count = await NostrClient.getCount([followersFilter])

                        log.trace('[onSearchProfiles] Followers count', {pubkey: profile.pubkey, count})

                        if(count !== null) {
                            profile.followersCount = count
                        }*/

                        profiles.push(profile)

                    } catch (e) {
                        continue
                    }
                }
                results = profiles
            }

            // 🧠 Sort results: prioritize matches in `profile.name`
            const queryLower = searchQuery.toLowerCase()
            results.sort((a, b) => {
                if(a.followersCount && b.followersCount) {
                    if (b.followersCount !== a.followersCount) return b.followersCount - a.followersCount
                }

                const aName = a.name?.toLowerCase() || ''
                const bName = b.name?.toLowerCase() || ''

                const aExact = aName === queryLower
                const bExact = bName === queryLower
                if (aExact && !bExact) return -1
                if (!aExact && bExact) return 1

                const aIncludes = aName.includes(queryLower)
                const bIncludes = bName.includes(queryLower)
                if (aIncludes && !bIncludes) return -1
                if (!aIncludes && bIncludes) return 1

                // fallback: alphabetical by nip05 (optional)
                const aNip = a.nip05?.toLowerCase() || ''
                const bNip = b.nip05?.toLowerCase() || ''
                return aNip.localeCompare(bNip)
            })


            if (results.length === 0) {
                setInfo(translate('contactsScreen_publicContacts_searchNoResults'))
            }

            log.trace('Search results:', results)
            setSearchProfiles(results)

        } catch (e: any) {
            setIsLoading(false)
            handleError(e)
        } finally {
            setIsLoading(false)
        }
    }

    const onClearSearch = function () {
        setSearchQuery('')
        setSearchProfiles([])
    }
    
    const insets = useSafeAreaInsets()
    const inputBg = useThemeColor('background')
    const inputText = useThemeColor('text')
    const placeholderTextColor = useThemeColor('textDim')
    const buttonBorder = useThemeColor('card')


    const isOwnProfileVisible = useSharedValue(true)
    const profileHeight = useSharedValue(100)
    const followsListHeight = useSharedValue(spacing.screenHeight * 0.55)

    const collapseProfile = () => {
        profileHeight.value = 0
        isOwnProfileVisible.value = false
        followsListHeight.value = spacing.screenHeight * 0.68
    }
    
    const expandProfile = () => {
        profileHeight.value = 100
        isOwnProfileVisible.value = true
        followsListHeight.value = spacing.screenHeight * 0.55
    }

    const animatedOwnProfile = useAnimatedStyle(() => {
        return {
            height: withTiming(profileHeight.value, { duration: 300 }),
            marginBottom: withTiming(isOwnProfileVisible.value ? spacing.medium : 0, { duration: 300 })
        }
    })

    const animatedFollowsListHeight = useAnimatedStyle(() => {
        return {
            maxHeight: withTiming(followsListHeight.value, { duration: 300 }),
        }
    })
    
    return (
    <Screen contentContainerStyle={$screen}>
        <View style={[$contentContainer]}>
        {!contactsStore.publicPubkey && (
            <Card
                heading='Find Nostr users'
                headingStyle={{marginBottom: spacing.small, marginLeft: spacing.tiny}}
                ContentComponent={
                    <>
                    <View style={{flexDirection: 'row', alignItems: 'center', overflow: 'hidden'}}>
                        <TextInput
                            ref={searchInputRef}
                            onChangeText={onChangeSerchQuery}
                            value={searchQuery}
                            autoCapitalize='none'
                            placeholder={translate('contactsScreen_publicContacts_searchPlaceholder')}
                            placeholderTextColor={placeholderTextColor}
                            style={[$npubInput, {backgroundColor: inputBg, color: inputText}]}
                        />
                        {searchQuery.length > 0 && (
                        <Button
                            LeftAccessory={() => <Icon icon='faXmark' size={14} containerStyle={{padding: 0}} color={placeholderTextColor} />}
                            preset='tertiary'
                            onPress={onClearSearch}
                            style={{ borderRadius: 0, marginLeft: -spacing.small, marginRight: spacing.small, backgroundColor: inputBg}}
                        />)}
                        <Button
                            // preset='secondary'
                            tx='contactsScreen_publicContacts_search'
                            style={{
                                borderRadius: 0,                                
                                marginLeft: -spacing.small,
                                borderLeftWidth: 1,
                                borderLeftColor: buttonBorder,
                                borderTopRightRadius: spacing.small,
                                borderBottomRightRadius: spacing.small,
                            }}
                            onPress={onSearchProfiles}
                        />
                    </View>
                    <Button
                        preset="tertiary"
                        tx={
                            'nostr_tip'
                        }
                        onPress={onSearchOwnProfile}
                        style={{alignSelf: 'flex-start', minHeight: verticalScale(30)}}
                        textStyle={{lineHeight: verticalScale(16), fontSize: 12}}
                    />
                    </>
                }
                style={$card}
                FooterComponent={
                    <>
                    {!contactsStore.publicPubkey && searchProfiles.length > 0 && (
                        <FlatList<NostrProfile>
                            data={searchProfiles}
                            renderItem={({ item, index }) => {
                                const isFirst = index === 0
                                return(
                                    <ListItem 
                                        key={item.pubkey}
                                        LeftComponent={
                                            <View style={{marginRight: spacing.medium, borderRadius: 20, overflow: 'hidden'}}>
                                                {item.picture ? (
                                                    <FastImage 
                                                        source={{uri: item.picture}}
                                                        style={{width: 40, height: 40}}
                                                    />
                                                ) : (
                                                    <Icon icon='faCircleUser' size={35} color={inputBg} />
                                                )}
                                            </View>}
                                        text={item.name}                                        
                                        subText={item.nip05 || item.lud16 || undefined}
                                        RightComponent={item.followersCount ? (                                        
                                            <View style={{paddingBottom: spacing.extraSmall}}>                                                
                                                <Text text={numbro(item.followersCount).format({average: true})} size='sm'/>
                                                <Text text={'followers'} style={{color: placeholderTextColor}} size='xxs'/>
                                            </View>
                                        ) : undefined}
                                        topSeparator={!isFirst}
                                        onPress={() => gotoContactDetail(item as Contact)}                                  
                                    />
                                ) 
                            }}
                            keyExtractor={(item) => item.pubkey}
                            contentInset={insets}
                            style={{ maxHeight: spacing.screenHeight * 0.55}}
                            //contentContainerStyle={{paddingBottom: 70}}                           
                        />
                    )}
                    </>
                }
            />
        )}        
        {ownProfile && (
            <Animated.View style={[animatedOwnProfile]}>           
                <Card
                    ContentComponent={
                        <ListItem                        
                            LeftComponent={
                                <View style={{marginRight: spacing.medium, borderRadius: 20, overflow: 'hidden' }}>
                                    {ownProfile.picture ? (
                                        <FastImage 
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
                    style={[$card]}           
                />
            </Animated.View>            
        )}
        {followingProfiles.length > 0 && (                           
            <Card
                ContentComponent={
                <>
                    <Animated.FlatList<NostrProfile>
                        data={followingProfiles}
                        renderItem={({ item, index }) => {
                            const isFirst= index === 0
                            return(
                                <ListItem 
                                    key={item.pubkey}
                                    LeftComponent={
                                        <View style={{marginRight: spacing.medium, borderRadius: 20, overflow: 'hidden'}}>
                                            {item.picture ? (
                                                <FastImage 
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
                        onEndReached={collapseProfile}
                        onStartReached={expandProfile}                       
                        keyExtractor={(item) => item.pubkey}
                        contentInset={insets}
                        style={animatedFollowsListHeight}
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
                    tx="nostr_setPublicKey"
                    subTx='nostr_setPublicKeySubText'
                    onPress={toggleNpubModal}
                    bottomSeparator={true}
                />
                <ListItem
                    leftIcon='faCircleNodes'
                    tx='nostr_setRelay'
                    subTx='nostr_setRelaySubText'
                    onPress={toggleRelayModal}
                    bottomSeparator={true}
                />
                <ListItem
                    leftIcon='faBan'
                    tx="nostr_removePub"
                    subTx="nostr_removePubSubText"
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
                <Text tx="contactsScreen_publicContacts_addNpub" preset="subheading" />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                    <TextInput
                        ref={npubInputRef}
                        onChangeText={(key) => setNewPublicPubkey(key)}
                        value={newPublicPubkey}
                        autoCapitalize='none'
                        keyboardType='default'
                        maxLength={64}
                        placeholder='npub...'
                        placeholderTextColor={placeholderTextColor}
                        selectTextOnFocus={true}
                        style={[$npubInput, {backgroundColor: inputBg, color: inputText, borderLeftWidth: 1, borderLeftColor: buttonBorder}]}                        
                    />
                    <Button
                        tx={'commonPaste'}
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPastePublicPubkey}
                    />
                    <Button
                        tx={'commonSave'}
                        style={{
                            borderRadius: 0,                                
                            // marginLeft: -spacing.small,
                            borderLeftWidth: 1,
                            borderLeftColor: buttonBorder,
                            borderTopRightRadius: spacing.small,
                            borderBottomRightRadius: spacing.small,
                        }}
                        onPress={onSavePublicPubkey}
                    />
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
                    {!newPublicPubkey && (<Button preset='tertiary' onPress={() => setNewPublicPubkey(defaultPublicNpub)} tx="contactsScreen_publicContacts_pasteDemoKey"/>)}
                    <Button preset='tertiary' onPress={toggleNpubModal} tx="commonCancel"/>                    
                </View>                
            </View>
          }
          onBackButtonPress={toggleNpubModal}
          onBackdropPress={toggleNpubModal}
        />
        <BottomModal
          isVisible={isMaybeOwnProfileVisible}          
          ContentComponent={
            <View style={{padding: spacing.small}}>
                <Text text="Is this your public profile?" preset="subheading" />
                {maybeOwnProfile && (
                    <View>
                        <ListItem 
                            key={maybeOwnProfile.pubkey}
                            LeftComponent={
                                <View style={{marginRight: spacing.medium, borderRadius: 20, overflow: 'hidden'}}>
                                    {maybeOwnProfile.picture ? (
                                        <FastImage 
                                            source={{uri: maybeOwnProfile.picture}}
                                            style={{width: 40, height: 40}}
                                        />
                                    ) : (
                                        <Icon icon='faCircleUser' size={35} color={inputBg} />
                                    )}
                                </View>}
                            text={maybeOwnProfile.name}
                            subText={maybeOwnProfile.nip05 || maybeOwnProfile.lud16 || ''}                            
                            onPress={() => {false}}                                  
                        />
                        <View style={[$buttonContainer, {marginTop: spacing.medium}]}>
                            <Button preset='default' onPress={onMaybeOwnProfileConfirm} tx="commonConfirm"/>
                            <Button preset='tertiary' onPress={onMaybeOwnProfileCancel} tx="commonCancel"/>                    
                        </View> 
                    </View> 
                )} 
            </View>
          }
          onBackButtonPress={toggleMaybeOwnProfileModal}
          onBackdropPress={toggleMaybeOwnProfileModal}
        />
        <BottomModal
          isVisible={isRelayModalVisible ? true : false}          
          ContentComponent={
            <View style={$newContainer}>
                <Text tx="contactsScreen_publicContacts_setOwnRelay" preset="subheading" />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                    <TextInput
                        ref={relayInputRef}
                        onChangeText={(url) => setNewPublicRelay(url)}
                        value={newPublicRelay}
                        autoCapitalize='none'
                        keyboardType='url'
                        maxLength={64}
                        placeholder={translate('placeholderRelay')}
                        placeholderTextColor={placeholderTextColor}
                        selectTextOnFocus={true}
                        style={[$npubInput, {backgroundColor: inputBg, color: inputText},]}                        
                    />
                    <Button
                        tx={'commonPaste'}
                        preset='secondary'
                        style={$pasteButton}
                        onPress={onPastePublicRelay}
                    />
                    <Button
                        tx={'commonSave'}
                        style={$saveButton}
                        onPress={onSavePublicRelay}
                    />
                </View>
                <View style={[$buttonContainer, {marginTop: spacing.medium}]}> 
                    {newPublicRelay && (                   
                        <Button preset='tertiary' onPress={onRemovePublicRelay} tx="commonResetDefault"/>                    
                    )}
                    <Button preset='tertiary' onPress={toggleRelayModal} tx="commonCancel"/>                    
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
    // height: spacing.screenHeight * 0.20,
}

const $pasteButton: ViewStyle = {
    borderRadius: 0,
    alignSelf: 'stretch',
    justifyContent: 'center', 
}

const $saveButton: ViewStyle = {
    borderRadius: 0,
    borderTopRightRadius: spacing.extraSmall,
    borderBottomRightRadius: spacing.extraSmall,
    // marginLeft: spacing.small,
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