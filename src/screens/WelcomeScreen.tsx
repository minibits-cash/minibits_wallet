// import { observer } from "mobx-react-lite"
import React, {FC} from 'react'
import {
  ImageStyle,
  TextStyle,
  View,
  ViewStyle,
  useColorScheme,
  FlatList,
} from 'react-native'
import Carousel, { ICarouselInstance } from 'react-native-reanimated-carousel'
// import { isRTL } from "../i18n"
import {useStores} from '../models'
import {AppStackScreenProps} from '../navigation'
import {useThemeColor, spacing, typography, colors} from '../theme'
import {useHeader} from '../utils/useHeader'
import {useSafeAreaInsetsStyle} from '../utils/useSafeAreaInsetsStyle'
import {
  Button,
  Icon,
  Screen,
  Text,
  TextField,
  TextFieldAccessoryProps,
} from '../components'
import {TxKeyPath} from '../i18n'

// const welcomeLogo = require("../../assets/images/logo.png")

export const WelcomeScreen: FC<AppStackScreenProps<'Welcome'>> =
  function WelcomeScreen(_props) {
    const {navigation} = _props

    useHeader({
      backgroundColor: colors.palette.primary500,
      StatusBarProps: {barStyle: 'dark-content'},
    })

    const {userSettingsStore} = useStores()

    const gotoWallet = function () {
      userSettingsStore.setIsOnboarded(true)
      navigation.navigate('Tabs', {})
    }

    const $bottomContainerInsets = useSafeAreaInsetsStyle(['bottom'])

    const pages = [
        {heading: 'welcomeScreen.page1.heading', intro: 'welcomeScreen.page1.intro', bullets: [
            {id: '1', tx: 'welcomeScreen.page1.bullet1'},
            {id: '2', tx: 'welcomeScreen.page1.bullet2'},
            {id: '3', tx: 'welcomeScreen.page1.bullet3'},            
        ], final: 'welcomeScreen.page1.final', go: 'welcomeScreen.page1.go'},
        {heading: 'welcomeScreen.heading', intro: 'welcomeScreen.intro', bullets: [
            {id: '1', tx: 'welcomeScreen.bullet1'},
            {id: '2', tx: 'welcomeScreen.bullet2'},
            {id: '3', tx: 'welcomeScreen.bullet3'},
            {id: '4', tx: 'welcomeScreen.bullet4'}
        ], go: 'welcomeScreen.page1.go'}      
    ]

    const ref = React.useRef<ICarouselInstance>(null);

    const renderWarningItem = ({item}: {item: {id: string; tx: string}}) => (
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
                style={{paddingHorizontal: spacing.small}}
                preset="default"
            />
        </View>
    )

    const baseOptions = {
        vertical: false,
        width: spacing.screenWidth,
        height: spacing.screenHeight,
      } as const

    return (
        <Screen style={$container} preset="fixed">
            <Carousel
                {...baseOptions}
                // style={{ width: '100%'}}
                ref={ref}
                pagingEnabled={true}
                // autoPlay={true}
                data={pages}
                // scrollAnimationDuration={1000}
                // onSnapToItem={(index) => console.log('current index:', index)}
                renderItem={({ item }) => (

                    <View style={{flexGrow: 0.6, padding: spacing.medium, alignItems: 'center'}}>
                        <Text
                            tx={item.heading as TxKeyPath}                            
                            preset="subheading"
                            style={$welcomeHeading}
                        />
                        <Text
                            tx={item.intro as TxKeyPath} 
                            preset="default"
                            style={$welcomeIntro}
                        />
                        <View style={$listContainer}>
                            <FlatList
                                data={item.bullets}
                                renderItem={renderWarningItem}
                                keyExtractor={item => item.id}
                                contentContainerStyle={{paddingRight: spacing.small}}
                            />
                        </View>
                        <Text
                            tx={item.final as TxKeyPath} 
                            preset="default"
                            style={$welcomeIntro}
                        />
                        <View style={[$bottomContainer]}>
                            <View style={$buttonContainer}>
                            <Button
                                testID="login-button"
                                tx={item.go as TxKeyPath}
                                preset="default"
                                onPress={gotoWallet}
                            />
                            </View>
                        </View>
                    </View>

                 
                )}
            />
            {/*<View>
                <Text
                tx="welcomeScreen.heading"
                testID="welcome-heading"
                preset="heading"
                style={$welcomeHeading}
                />
                <Text
                tx="welcomeScreen.intro"
                preset="default"
                style={$welcomeIntro}
                />
                <View style={$listContainer}>
                    <FlatList
                        data={bullets}
                        renderItem={renderWarningItem}
                        keyExtractor={item => item.id}
                        contentContainerStyle={{paddingRight: spacing.small}}
                    />
                </View>
            </View>
            <View style={[$bottomContainer, $bottomContainerInsets]}>
                <Button
                testID="login-button"
                tx="welcomeScreen.go"
                preset="default"
                onPress={gotoWallet}
                />
            </View>*/}
        </Screen>
    )
  }

const $container: ViewStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  backgroundColor: colors.palette.primary500
}

const $listContainer: ViewStyle = {
    maxHeight: spacing.screenHeight * 0.35,    
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
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.medium,
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

const $welcomeHeading: TextStyle = {
  marginBottom: spacing.medium,
}

const $welcomeIntro: TextStyle = {
  marginBottom: spacing.large,
}
