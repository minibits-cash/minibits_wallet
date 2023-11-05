import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
import { TabBar, TabView, Route } from 'react-native-tab-view'
import {colors, spacing, useThemeColor} from '../theme'
import {Screen, Text} from '../components'
import { IncomingRequests } from './PaymentRequests/IncomingRequests'
import { OutgoingRequests } from './PaymentRequests/OutgoingRequests'
import { log } from '../services/logService'
import { useHeader } from '../utils/useHeader'
import { WalletStackScreenProps } from '../navigation'

interface PaymentRequestsScreenProps extends WalletStackScreenProps<'PaymentRequests'> {}

export const PaymentRequestsScreen: FC<PaymentRequestsScreenProps> = observer(function PaymentRequestsScreen({route, navigation}) {
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })    
    
    const renderScene = ({route}: {route: Route}) => {
        switch (route.key) {
          case 'first':
            return <IncomingRequests navigation={navigation}/>
          case 'second':
            return <OutgoingRequests navigation={navigation}/>
          default:
            return null
        }
    }
    
    const [index, setIndex] = useState(0)
    const [routes] = useState([
        { key: 'first', title: 'Incoming' },
        { key: 'second', title: 'Outgoing' },
    ])

 

    const renderTabBar = (props: any) => (
        <TabBar
          {...props}
          indicatorStyle={{ backgroundColor: activeTabIndicator }}
          style={{ backgroundColor: headerBg }}
        />
    )

    const headerBg = useThemeColor('header')
    const activeTabIndicator = colors.palette.accent400   

    return (
        <Screen contentContainerStyle={$screen}>
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>
                <Text preset="heading" text="Payment requests" style={{color: 'white'}} />
            </View>
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

const $screen: ViewStyle = {
    flex: 1,
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingBottom: spacing.medium,
    paddingTop: 0,
    height: spacing.screenHeight * 0.1,
  }

