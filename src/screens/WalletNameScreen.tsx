import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useState} from 'react'
import {TextStyle, View, ViewStyle } from 'react-native'
import { TabView, Route, TabBar } from 'react-native-tab-view'
import {colors, spacing, useThemeColor} from '../theme'
import {Screen, Text} from '../components'
import {RandomName} from './Contacts/RandomName'
import {OwnName} from './Contacts/OwnName'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
import {translate} from '../i18n'

type Props = StaticScreenProps<undefined>

export const WalletNameScreen = observer(function WalletNameScreen({ route }: Props) {
    const navigation = useNavigation()    
    useHeader({        
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(), 
    })

    const {walletProfileStore} = useStores()
    const {pubkey, nip05} = walletProfileStore

    const renderScene = ({route}: {route: Route}) => {
        switch (route.key) {
          case 'first':
            return <OwnName pubkey={pubkey as string} />
          case 'second':
            return <RandomName pubkey={pubkey as string} />
          default:
            return null
        }
    }
    
    const [index, setIndex] = useState(0)
    const [routes] = useState([
        { key: 'first', title: translate('walletNameScreen_ownNameTab') },
        { key: 'second', title: translate('walletNameScreen_randomNameTab') },
    ])

    const headerBg = useThemeColor('header')
    const activeTabIndicator = colors.palette.accent400    

    const renderTabBar = (props: any) => (
        <TabBar
          key={props.key}
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
                initialLayout={{ width: spacing.screenWidth}}
                pagerStyle={{flex: 1}}                
                style={{flex: 1}}
            />
        </>
    )
})


const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingHorizontal: spacing.medium,
    justifyContent: 'space-around',
}