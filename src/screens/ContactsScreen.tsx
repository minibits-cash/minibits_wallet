import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {Image, Pressable, View, ViewStyle} from 'react-native'
import { TabBar, TabView, Route } from 'react-native-tab-view'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {Header, Icon, Screen} from '../components'
import {useStores} from '../models'
import { PrivateContacts } from './Contacts/PrivateContacts'
import { PublicContacts } from './Contacts/PublicContacts'
import { log } from '../services/logService'
import { getImageSource } from '../utils/utils'
import { ReceiveOption } from './ReceiveScreen'
import { SendOption } from './SendScreen'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

type Props = StaticScreenProps<{
    paymentOption?: ReceiveOption | SendOption
}>


export const ContactsScreen = observer(function ({ route }: Props) {
    const navigation = useNavigation() 
    const {walletProfileStore} = useStores()
    
    let paymentOption: ReceiveOption | SendOption | undefined
        
    if(route.params && route.params.paymentOption) {
        paymentOption = route.params.paymentOption
    }

    const renderScene = ({route}: {route: Route}) => {
        switch (route.key) {
          case 'first':
            return <PrivateContacts paymentOption={paymentOption} />
          case 'second':
            return <PublicContacts paymentOption={paymentOption} />
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
    const {nip05} = walletProfileStore

    const renderTabBar = (props: any) => (
        <TabBar
          key={props.key}
          {...props}
          indicatorStyle={{ backgroundColor: activeTabIndicator }}
          style={{ backgroundColor: headerBg }}
        />
    )

    return (
        <Screen contentContainerStyle={$screen}>
            <Header 
                LeftActionComponent={<LeftProfileHeader gotoProfile={gotoProfile} isAvatarVisible={true} />}
                title={nip05}
                titleStyle={{fontFamily: typography.primary?.medium, fontSize: 16}}
                RightActionComponent={<RightProfileHeader gotoProfile={gotoProfile}/>}
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




export const LeftProfileHeader = observer(function (props: {    
    gotoProfile: any
    isAvatarVisible?: boolean
}) {
    const {walletProfileStore} = useStores()

    return (        
        <Pressable style={{marginHorizontal: spacing.small}} onPress={props.gotoProfile}>                
            {walletProfileStore.picture && props.isAvatarVisible ? (                    
                <Image 
                    style={
                        {
                            width: 40, 
                            height: (walletProfileStore.isOwnProfile) ? 40 : 43, 
                            borderRadius: (walletProfileStore.isOwnProfile) ? 20 : 0,                                        
                        }
                    } 
                    source={{uri: getImageSource(walletProfileStore.picture)}}                    
                />                                    
            ) : (                
                <View style={{opacity: 0.5}} >
                    <Icon
                        icon='faCircleUser'                                
                        size={verticalScale(25)}                    
                        color={'white'}                                                           
                    />                
                </View>
            )}                
        </Pressable>        
    )
})


const RightProfileHeader = function (props: {    
    gotoProfile: any
}) {

    return (        
        <Pressable style={{marginHorizontal: spacing.small}} onPress={props.gotoProfile}>
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

