import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Image, Pressable, ViewStyle} from 'react-native'
import { TabBar, TabView, Route } from 'react-native-tab-view'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {Header, Icon, Screen} from '../components'
import {useStores} from '../models'
import {ContactsStackScreenProps} from '../navigation'
import { NostrClient, NostrUnsignedEvent } from '../services'
import { PrivateContacts } from './Contacts/PrivateContacts'
import { PublicContacts } from './Contacts/PublicContacts'
import { log } from '../utils/logger'
import { getImageSource } from '../utils/utils'
import { MINIBITS_NIP05_DOMAIN } from '@env'

interface ContactsScreenProps extends ContactsStackScreenProps<'Contacts'> {}

export const ContactsScreen: FC<ContactsScreenProps> = observer(function ContactsScreen({route, navigation}) {    
    const {userSettingsStore, walletProfileStore} = useStores()

    let amountToSend: string | undefined
    
    if(route.params && route.params.amountToSend) {
        amountToSend = route.params.amountToSend
    }
    
    
    useEffect(() => {
        const load = async () => {
            try {                
                log.trace(walletProfileStore)

                if(!walletProfileStore.pubkey || !walletProfileStore.picture) {
                    const {publicKey} = await NostrClient.getOrCreateKeyPair()
                    const walletId = userSettingsStore.walletId 
                    
                    // create random name, NIP05 identifier, random picture and sharable profile
                    // announce new profile to the default public and minibits relays
                    await walletProfileStore.create(publicKey, walletId as string)                    
                }
                
                // log.trace('Pic', walletProfileStore.picture)

            } catch(e: any) {
                return false // silent
            }
        }
        load()
        return () => {}        
    }, [])


    const renderScene = ({route}: {route: Route}) => {
        switch (route.key) {
          case 'first':
            return <PrivateContacts navigation={navigation} amountToSend={amountToSend} />
          case 'second':
            return <PublicContacts navigation={navigation} amountToSend={amountToSend} />
          default:
            return null
        }
    }
    
    const [index, setIndex] = useState(0)
    const [routes] = useState([
        { key: 'first', title: 'Private' },
        { key: 'second', title: 'Public' },
    ])

    const gotoProfile = function () {        
        navigation.navigate('Profile')
    }

    const headerBg = useThemeColor('header')
    const activeTabIndicator = colors.palette.accent400
    const {picture, nip05} = walletProfileStore

    const renderTabBar = (props: any) => (
        <TabBar
          {...props}
          indicatorStyle={{ backgroundColor: activeTabIndicator }}
          style={{ backgroundColor: headerBg }}
        />
    )

    return (
        <Screen contentContainerStyle={$screen}>
            <Header 
                LeftActionComponent={<LeftHeader picture={picture} gotoProfile={gotoProfile}/>}
                title={nip05}
                titleStyle={{fontFamily: typography.primary?.medium, fontSize: 16}}
                RightActionComponent={<RightHeader gotoProfile={gotoProfile}/>}
            />
            <TabView
                renderTabBar={renderTabBar}
                navigationState={{ index, routes }}
                renderScene={renderScene}
                onIndexChange={setIndex}
                initialLayout={{ width: spacing.screenWidth }}
            />
        </Screen>
    )
  })




const LeftHeader = observer(function (props: {
    picture: string
    gotoProfile: any
}) {
    const {walletProfileStore} = useStores()

    return (        
        <Pressable style={{marginHorizontal: spacing.medium}} onPress={props.gotoProfile}>                
            {props.picture ? (                    
                <Image 
                    style={
                        {
                            width: 40, 
                            height: (walletProfileStore.isOwnProfile) ? 40 : 43, 
                            borderRadius: (walletProfileStore.isOwnProfile) ? 20 : 0,                                        
                        }
                    } 
                    source={{uri: getImageSource(props.picture)}} 
                />                                    
            ) : (                
                <Icon
                    icon='faCircleUser'                                
                    size={30}                    
                    color={'white'}                
                />                
            )}                
        </Pressable>        
    )
})


const RightHeader = function (props: {    
    gotoProfile: any
}) {

    return (        
        <Pressable style={{marginHorizontal: spacing.medium}} onPress={props.gotoProfile}>
            <Icon
                icon='faEllipsisVertical'
                color={'white'}                
            />             
        </Pressable>        
    )
}


const $screen: ViewStyle = {
    flex: 1,
}

