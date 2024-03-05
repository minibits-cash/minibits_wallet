// import { observer } from "mobx-react-lite"
import React, {FC, useRef, useState} from 'react'
import {
  TextStyle,
  View,
  ViewStyle,
  FlatList,
  Animated,
  ScrollView
} from 'react-native'
import PagerView, { PagerViewOnPageScrollEventData } from 'react-native-pager-view'
import {
    ScalingDot,
    SlidingBorder,
  } from 'react-native-animated-pagination-dots'
// import { isRTL } from "../i18n"
import {useStores} from '../models'
import {AppStackScreenProps} from '../navigation'
import {spacing, colors, useThemeColor} from '../theme'
import {useHeader} from '../utils/useHeader'
import {useSafeAreaInsetsStyle} from '../utils/useSafeAreaInsetsStyle'
import {
  Button,
  ErrorModal,
  Icon,
  Loading,
  Screen,
  Text,
} from '../components'
import {TxKeyPath} from '../i18n'
import AppError from '../utils/AppError'
import { MintClient } from '../services'
7
const AnimatedPagerView = Animated.createAnimatedComponent(PagerView)

const PAGES = [
    {
        key: 1,
        heading: 'welcomeScreen.page1.heading',
        intro: 'welcomeScreen.page1.intro',
        bullets: [
            {id: '1', tx: 'welcomeScreen.page1.bullet1'},
            {id: '2', tx: 'welcomeScreen.page1.bullet2'},
            {id: '3', tx: 'welcomeScreen.page1.bullet3'},            
        ],
        final: 'welcomeScreen.page1.final'
    },
    {
        key: 2,
        heading: 'welcomeScreen.page2.heading',
        intro: 'welcomeScreen.page2.intro',
        bullets: [
            {id: '1', tx: 'welcomeScreen.page2.bullet1'},
            {id: '2', tx: 'welcomeScreen.page2.bullet2'},
            {id: '3', tx: 'welcomeScreen.page2.bullet3'},            
        ],
        final: 'welcomeScreen.page2.final'
    },
    {
        key: 3,
        heading: 'welcomeScreen.page3.heading',
        intro: 'welcomeScreen.page3.intro',
        bullets: [
            {id: '1', tx: 'welcomeScreen.page3.bullet1'},
            {id: '2', tx: 'welcomeScreen.page3.bullet2'},
            {id: '3', tx: 'welcomeScreen.page3.bullet3'},            
        ],
        final: 'welcomeScreen.page3.final'
    }       
] 

// const welcomeLogo = require("../../assets/images/logo.png")

export const WelcomeScreen: FC<AppStackScreenProps<'Welcome'>> =
  function WelcomeScreen(_props) {
    const {navigation} = _props

    useHeader({
      backgroundColor: colors.palette.primary500,
      //StatusBarProps: {barStyle: 'dark-content'},
    })

    const {userSettingsStore} = useStores()
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false)    

    
    const gotoWallet = async function () {
        try {
            // do not overwrite if one was set during recovery
            setIsLoading(true)
            const mnemonic = await MintClient.getOrCreateMnemonic()
            userSettingsStore.setIsOnboarded(true)
            navigation.navigate('Tabs')
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }      
    }


    const gotoRecovery = async function () {
        try {            
            navigation.navigate('RemoteRecovery')
        } catch (e: any) {
            handleError(e)
        }      
    }

    const handleError = function (e: AppError) { 
        setIsLoading(false)      
        setError(e)
    }


    const width = spacing.screenWidth
    const ref = useRef<PagerView>(null);
    const scrollOffsetAnimatedValue = React.useRef(new Animated.Value(0)).current;
    const positionAnimatedValue = React.useRef(new Animated.Value(0)).current;
    const inputRange = [0, PAGES.length];
    const scrollX = Animated.add(
      scrollOffsetAnimatedValue,
      positionAnimatedValue
    ).interpolate({
      inputRange,
      outputRange: [0, PAGES.length * width],
    })
  
    const onPageScroll = React.useMemo(
      () =>
        Animated.event<PagerViewOnPageScrollEventData>(
          [
            {
              nativeEvent: {
                offset: scrollOffsetAnimatedValue,
                position: positionAnimatedValue,
              },
            },
          ],
          {
            useNativeDriver: false,
          }
        ),
        
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    )

    const headerBg = useThemeColor('header')  

    const renderBullet = ({item}: {item: {id: string; tx: string}}) => (
        <View style={$listItem}>
            <View style={$itemIcon}>
                <Icon
                icon="faCheckCircle"
                size={spacing.large}
                color={colors.palette.primary200}
                />
            </View>
            <Text
                tx={item.tx as TxKeyPath}
                style={{paddingHorizontal: spacing.small, color: 'white'}}
                preset="default"
            />
        </View>
    )


    return (
        <Screen contentContainerStyle={$container} preset="fixed" style={{backgroundColor: headerBg}}>
            <AnimatedPagerView
                testID="pager-view"
                initialPage={0}
                ref={ref}
                style={{flex: 1}}
                // onPageSelected={onPageSelected}
                onPageScroll={onPageScroll}
            >
                {PAGES.map((page) => (
                    <View key={page.key}>
                    <View style={{alignItems: 'center'}}>
                        <Text
                            tx={page.heading as TxKeyPath}                            
                            preset="subheading"
                            style={$welcomeHeading}
                        />
                        <Text
                            tx={page.intro as TxKeyPath} 
                            preset="default"
                            style={$welcomeIntro}
                        />
                        <View style={$listContainer}>
                            <FlatList
                                data={page.bullets}
                                renderItem={renderBullet}
                                keyExtractor={item => item.id}
                                contentContainerStyle={{paddingRight: spacing.small}}
                                style={{ flexGrow: 0  }}
                            />
                        </View>
                        <Text
                            tx={page.final as TxKeyPath} 
                            preset="default"
                            style={$welcomeFinal}
                        />
                    </View>
                    {(page.key === PAGES.length) && (
                        <ScrollView style={$buttonContainer}>
                            <Button 
                                onPress={gotoWallet}
                                preset='secondary'
                                text='Got it, take me to the wallet'
                            />
                            <Button 
                                onPress={gotoRecovery}
                                preset='tertiary'
                                text='Recover lost wallet'
                                LeftAccessory={() => {return<Icon icon='faRotate'/>}}
                                style={{marginTop: spacing.medium}}
                            />
                        </ScrollView>
                    )} 
                    </View>               
                ))}
            </AnimatedPagerView>
            <View style={$dotsContainer}>               
                <View style={$dotContainer}>
                    <ScalingDot
                        testID={'sliding-border'}                        
                        data={PAGES}
                        inActiveDotColor={colors.palette.primary300}
                        activeDotColor={colors.palette.primary100}
                        activeDotScale={1.2}
                        containerStyle={{bottom: undefined, position: undefined, marginTop: -spacing.small, paddingBottom: spacing.medium}}
                        //@ts-ignore
                        scrollX={scrollX}
                        dotSize={30}
                    />
                </View>
            </View>
            {error && <ErrorModal error={error} />}
            {isLoading && <Loading statusMessage={'Creating wallet seed, this takes a while...'} style={{backgroundColor: headerBg, opacity: 1}}/>}
        </Screen>
    )
  }

const $dotsContainer: ViewStyle ={
    height: 50,
    justifyContent: 'space-evenly',
}

const $dotContainer: ViewStyle ={
    justifyContent: 'center',
    alignSelf: 'center',
}

const $container: ViewStyle = {
  // alignItems: 'center',
  flex: 1,
  paddingHorizontal: spacing.medium,  
}

const $listContainer: ViewStyle = {
    maxHeight: spacing.screenHeight * 0.38,    
}

const $listItem: ViewStyle = {
  flexDirection: 'row',
  paddingBottom: spacing.extraSmall,
  paddingRight: spacing.extraSmall,  
}

const $itemIcon: ViewStyle = {
  flexDirection: 'row',
  marginBottom: spacing.small,
}

const $buttonContainer: ViewStyle = {    
    alignSelf: 'center',
    marginTop: spacing.large,
    paddingHorizontal: spacing.large,
  }


const $welcomeHeading: TextStyle = {
  marginBottom: spacing.medium,
  color: 'white',  
}

const $welcomeIntro: TextStyle = {
  marginBottom: spacing.large,
  color: 'white',
}

const $welcomeFinal: TextStyle = {
    marginTop: spacing.large,
    color: 'white',
  }
