import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Image, Pressable, ViewStyle} from 'react-native'
import { TabBar, TabView, Route } from 'react-native-tab-view'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {Header, Icon, Screen} from '../components'
import {useStores} from '../models'
import {ContactsStackScreenProps} from '../navigation'
import { KeyChain, MintClient, NostrClient } from '../services'
import { PrivateContacts } from './Contacts/PrivateContacts'
import { PublicContacts } from './Contacts/PublicContacts'
import { log } from '../services/logService'
import { getImageSource } from '../utils/utils'
import { ReceiveOption } from './ReceiveOptionsScreen'
import { SendOption } from './SendOptionsScreen'
import { WalletProfile } from '../models/WalletProfileStore'
import { Err } from '../utils/AppError'
import { getRandomUsername } from '../utils/usernames'

interface ContactsScreenProps extends ContactsStackScreenProps<'Contacts'> {}

export const ContactsScreen: FC<ContactsScreenProps> = observer(function ContactsScreen({route, navigation}) {    
    const {userSettingsStore, walletProfileStore} = useStores()
    
    let paymentOption: ReceiveOption | SendOption | undefined
        
    if(route.params && route.params.paymentOption) {
        paymentOption = route.params.paymentOption
    }

    
    useEffect(() => {
        const load = async () => {            
            try {                
                log.trace(walletProfileStore)

                if(!walletProfileStore.pubkey || !walletProfileStore.picture) { // pic check needed to be sure profile does not exists on the server                    
                    // create random name, NIP05 identifier, random picture and sharable profile
                    // announce new profile to the added default public and minibits relays
                    const walletId = userSettingsStore.walletId
                    await walletProfileStore.create(walletId as string)                    
                }

            } catch(e: any) {
                log.error(e.name, e.message)
                
                // in case we somehow hit the existing name we silently retry TBD
                /* if(e.name && e.name === Err.ALREADY_EXISTS_ERROR) {
                    const randomName = getRandomUsername()
                    await walletProfileStore.create(randomName as string) 
                } */

                return false // silent
            }
        }
        load()
        return () => {}        
    }, [])


    const renderScene = ({route}: {route: Route}) => {
        switch (route.key) {
          case 'first':
            return <PrivateContacts navigation={navigation} paymentOption={paymentOption} />
          case 'second':
            return <PublicContacts navigation={navigation} paymentOption={paymentOption} />
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

