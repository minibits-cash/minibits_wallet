import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useState} from 'react'
import {TextStyle, View, ViewStyle } from 'react-native'
import { TabView, SceneMap, Route, TabBarProps, TabBarItemProps, TabBar } from 'react-native-tab-view'
import {colors, spacing, useThemeColor} from '../theme'
import {Screen, Text} from '../components'
import {RandomName} from './Contacts/RandomName'
import {OwnName} from './Contacts/OwnName'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {ContactsStackScreenProps} from '../navigation'

interface WalletNameScreenProps extends ContactsStackScreenProps<'WalletName'>{}

export const WalletNameScreen: FC<WalletNameScreenProps> = observer(function WalletNameScreen({route, navigation}) {    
    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(), 
    })

    const {walletProfileStore} = useStores()
    const {pubkey, name, nip05} = walletProfileStore

    const renderScene = ({route}: {route: Route}) => {
        switch (route.key) {
          case 'first':
            return <RandomName navigation={navigation} pubkey={pubkey as string} />
          case 'second':
            return <OwnName navigation={navigation} pubkey={pubkey as string} />
          default:
            return null
        }
    }
    
    const [index, setIndex] = useState(0)
    const [routes] = useState([
        { key: 'first', title: 'Random name' },
        { key: 'second', title: 'Own name' },
    ])

    const headerBg = useThemeColor('header')
    const activeTabIndicator = colors.palette.accent400    

    const renderTabBar = (props: any) => (
        <TabBar
          {...props}
          indicatorStyle={{ backgroundColor: activeTabIndicator }}
          style={{ backgroundColor: headerBg }}
        />
    )

    return (
        <>
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>
                <Text size='xs' text={nip05} style={{color: 'white', marginBottom: spacing.small}}/>
            </View>
            <TabView
                renderTabBar={renderTabBar}
                navigationState={{ index, routes }}
                renderScene={renderScene}
                onIndexChange={setIndex}
                initialLayout={{ width: spacing.screenWidth }}
            />
        </>
    )
})


const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingHorizontal: spacing.medium,
    justifyContent: 'space-around',
}