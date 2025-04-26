import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useState} from 'react'
import {TextStyle, View, ViewStyle} from 'react-native'
import { TabBar, TabView, Route } from 'react-native-tab-view'
import {colors, spacing, useThemeColor} from '../theme'
import {Screen, Text} from '../components'
import { IncomingRequests } from './PaymentRequests/IncomingRequests'
import { OutgoingRequests } from './PaymentRequests/OutgoingRequests'
import { useHeader } from '../utils/useHeader'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
import { useStores } from '../models'
import { log } from '../services'

type Props = StaticScreenProps<undefined>

export const PaymentRequestsScreen = observer(function PaymentRequestsScreen({ route } : Props) {
    const navigation = useNavigation()
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })
    const {paymentRequestsStore} = useStores()
    
    useEffect(() => {
        onDeletePaidOrExpired()
    }, [])
      
    const onDeletePaidOrExpired = function() {
        log.trace('[onDeletePaidOrExpired] start')
        paymentRequestsStore.removePaidOrExpired()
    }
    
    const renderScene = ({route}: {route: Route}) => {
        switch (route.key) {
          case 'first':
            return <IncomingRequests/>
          case 'second':
            return <OutgoingRequests/>
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
          key={props.key}
          {...props}
          indicatorStyle={{ backgroundColor: activeTabIndicator }}
          style={{ backgroundColor: headerBg }}
        />
    )

    const headerBg = useThemeColor('header')
    const activeTabIndicator = colors.palette.accent400
    const headerTitle = useThemeColor('headerTitle')  

    return (
        <Screen contentContainerStyle={$screen}>
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>
                <Text preset="heading" tx="payCommon.paymentRequests" style={{color: headerTitle}} />
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
    height: spacing.screenHeight * 0.15,
  }

