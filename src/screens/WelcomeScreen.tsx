import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {
  TextStyle,
  View,
  ViewStyle,
  Animated,
  ScrollView,
  Linking,
  ActivityIndicator,
} from 'react-native'
import PagerView, { PagerViewOnPageScrollEventData } from 'react-native-pager-view'
import { ScalingDot } from 'react-native-animated-pagination-dots'
import {useStores} from '../models'
import {spacing, colors, useThemeColor, typography} from '../theme'
import {
  Button,
  ErrorModal,
  InfoModal,
  Loading,
  Screen,
  Text,
  Toggle,
} from '../components'
import {translate} from '../i18n'
import AppError from '../utils/AppError'
import { MINIBITS_MINT_URL } from '@env'
import useIsInternetReachable from '../utils/useIsInternetReachable'
import { KeyChain, log } from '../services'
import { delay } from '../utils/utils'
import { htmlToBlocks, Block, InlineSegment } from '../utils/htmlToBlocks'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView)

const TERMS_URL = 'https://minibits.cash/terms'
const PRIVACY_URL = 'https://minibits.cash/privacy'
const TERMS_FETCH_TIMEOUT = 5000

// Two-dot page indicator (hero + terms).
const PAGE_INDICATORS = [{ key: 1 }, { key: 2 }]

type Props = StaticScreenProps<undefined>

export const WelcomeScreen = function ({ route }: Props) {
    const navigation = useNavigation()
    const headerBg = useThemeColor('header')
    const bgColor = useThemeColor('background')

    useLayoutEffect(() => {
      navigation.setOptions({ headerShown: false })
    }, [])

    const {
      authStore,
      userSettingsStore,
      relaysStore,
      walletProfileStore,
      walletStore,
      mintsStore
    } = useStores()

    const isInternetReachable = useIsInternetReachable()

    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [statusMessage, setStatusMessage] = useState<string>('')
    const [info, setInfo] = useState<string>('')
    const [hasAgreed, setHasAgreed] = useState<boolean>(false)

    const gotoWallet = async function () {
      try {
          if(!hasAgreed) { return }

          if(!isInternetReachable) {
            setInfo(translate('welcomeScreen_offlineWarning'))
            return
          }

          setIsLoading(true)
          setStatusMessage(translate('welcomeScreen_creatingKeys'))

          // check if keys already exist (if onboarding is repeated or if iOS did not wipe keys?)
          let keys = await KeyChain.getWalletKeys()

          if(!keys) {
            const newKeys = KeyChain.generateWalletKeys()

            // save keys after successful profile creation
            await KeyChain.saveWalletKeys(newKeys)
            walletStore.cleanCachedWalletKeys()
            keys = newKeys
          }

          setStatusMessage(translate('welcomeScreen_creatingProfile'))

          // First, enroll device for JWT authentication then create profile
          try {
            await authStore.logout()
          } catch (e: any) {}

          await authStore.enrollDevice(
            keys.NOSTR,
            walletProfileStore.device
          )

          // idempotent if keys and profile exists on the server
          await walletProfileStore.create(
            keys.walletId,
            keys.SEED.seedHash
          )

          if(!mintsStore.mintExists(MINIBITS_MINT_URL)) {
            await mintsStore.addMint(MINIBITS_MINT_URL)
          }

          relaysStore.addDefaultRelays()
          userSettingsStore.setIsOnboarded(true)

          navigation.navigate('Tabs')

          await delay(1000)
          setStatusMessage('')
          setIsLoading(false)
      } catch (e: any) {
          handleError(e)
      }
    }

    const handleError = function (e: AppError) {
        setIsLoading(false)
        setError(e)
    }

    // Pager scroll animation wiring for the dot indicator.
    const width = spacing.screenWidth
    const ref = useRef<PagerView>(null)
    const scrollOffsetAnimatedValue = useRef(new Animated.Value(0)).current
    const positionAnimatedValue = useRef(new Animated.Value(0)).current
    const inputRange = [0, PAGE_INDICATORS.length]
    const scrollX = Animated.add(
      scrollOffsetAnimatedValue,
      positionAnimatedValue
    ).interpolate({
      inputRange,
      outputRange: [0, PAGE_INDICATORS.length * width],
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

    return (
        <Screen
            contentContainerStyle={$container}
            preset="fixed"
            style={{backgroundColor: bgColor}}
            safeAreaEdges={['top', 'bottom']}
        >
            <AnimatedPagerView
                testID="pager-view"
                initialPage={0}
                ref={ref}
                style={$pager}
                onPageScroll={onPageScroll}
            >
                <View key="hero" style={$page}>
                    <HeroPage />
                </View>
                <View key="terms" style={$page}>
                    <TermsPage
                        hasAgreed={hasAgreed}
                        onAgreeChange={setHasAgreed}
                        onEnter={gotoWallet}
                    />
                </View>
            </AnimatedPagerView>
            <View style={$dotsContainer}>
                <ScalingDot
                    testID={'scaling-dot'}
                    data={PAGE_INDICATORS}
                    inActiveDotColor={colors.palette.primary300}
                    activeDotColor={colors.palette.primary100}
                    activeDotScale={1}
                    containerStyle={{bottom: undefined, position: undefined}}
                    //@ts-ignore
                    scrollX={scrollX}
                    dotSize={12}
                />
            </View>
            {error && <ErrorModal error={error} />}
            {info && <InfoModal message={info} />}
            {isLoading && <Loading statusMessage={statusMessage} style={{backgroundColor: headerBg, opacity: 1}} textStyle={{color: 'white'}}/>}
        </Screen>
    )
}


/* ----------------------------- Page 1: Hero ----------------------------- */

const HeroPage = function () {
    // Body copy adapts to the theme: dark on light theme, light on dark themes.
    const textColor = useThemeColor('text')

    return (
        <ScrollView
            style={{flex: 1}}
            contentContainerStyle={$heroScroll}
            showsVerticalScrollIndicator={false}
        >
            <View>
                <Text style={$heroHeading}>
                    <Text
                        tx="welcomeScreen_hero_instant"
                        style={[$heroHeading, {color: textColor}]}
                    />
                    {' '}
                    <Text
                        tx="welcomeScreen_hero_private"
                        style={[$heroHeading, {color: colors.palette.primary400}]}
                    />
                </Text>
                <Text
                    tx="welcomeScreen_hero_ecash"
                    style={[$heroHeading, {color: colors.palette.green400}]}
                />
                <Text
                    tx="welcomeScreen_hero_intro"
                    style={[$heroIntro, {color: textColor}]}
                />
            </View>
        </ScrollView>
    )
}


/* ------------------------ Page 2: Terms & consent ----------------------- */

type TermsPageProps = {
    hasAgreed: boolean
    onAgreeChange: (value: boolean) => void
    onEnter: () => void
}

const TermsPage = function ({ hasAgreed, onAgreeChange, onEnter }: TermsPageProps) {
    // Copy on the themed background adapts: dark on light theme, light on dark themes.
    const textColor = useThemeColor('text')

    return (
        <View style={$termsPage}>
            <Text
                tx="welcomeScreen_terms_title"
                preset="subheading"
                style={[$termsTitle, {color: textColor}]}
            />
            <View style={$termsBox}>
                <TermsContent />
            </View>
            <View style={$agreeRow}>
                <Toggle
                    variant="checkbox"
                    value={hasAgreed}
                    onValueChange={onAgreeChange}
                    containerStyle={{marginRight: spacing.small}}
                />
                <Text style={[$agreeText, {color: textColor}]}>
                    {translate('welcomeScreen_terms_agreePrefix')}{' '}
                    <Text
                        style={[$agreeLink, {color: textColor}]}
                        onPress={() => Linking.openURL(TERMS_URL)}
                        text={translate('welcomeScreen_terms_agreeTerms')}
                    />
                    {' '}{translate('welcomeScreen_terms_agreeConjunction')}{' '}
                    <Text
                        style={[$agreeLink, {color: textColor}]}
                        onPress={() => Linking.openURL(PRIVACY_URL)}
                        text={translate('welcomeScreen_terms_agreePrivacy')}
                    />.
                </Text>
            </View>
            <Button
                onPress={onEnter}
                //preset="secondary"
                tx="welcomeScreen_lastPageConfirmButton"
                disabled={!hasAgreed}
                style={[$enterButton, !hasAgreed && {opacity: 0.5}]}
            />
        </View>
    )
}


/**
 * Fetches the Minibits Terms page and renders its content as native text.
 * Loaded lazily on mount; scrolls independently inside the pager.
 */
const TermsContent = function () {
    const cardBg = useThemeColor('card')
    const textColor = useThemeColor('text')
    const separatorColor = useThemeColor('separator')
    const tintColor = useThemeColor('tint')

    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
    const [blocks, setBlocks] = useState<Block[]>([])

    const load = useCallback(async () => {
        setState('loading')
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), TERMS_FETCH_TIMEOUT)
        try {
            const response = await fetch(TERMS_URL, { signal: controller.signal as any })
            const html = await response.text()
            const parsed = htmlToBlocks(html)
            if (parsed.length === 0) { throw new Error('No terms content parsed') }
            setBlocks(parsed)
            setState('ready')
        } catch (e: any) {
            log.warn('[WelcomeScreen.TermsContent] Failed to load terms', { error: e.message })
            setState('error')
        } finally {
            clearTimeout(timeout)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const renderSegments = (segments: InlineSegment[]) =>
        segments.map((segment, index) => (
            <Text
                key={index}
                text={segment.text}
                onPress={segment.href ? () => Linking.openURL(segment.href!) : undefined}
                style={[
                    segment.bold && {fontFamily: typography.primary?.medium},
                    segment.italic && {fontStyle: 'italic'},
                    segment.href && {color: colors.palette.primary400, textDecorationLine: 'underline'},
                ]}
            />
        ))

    const renderBlock = (block: Block, index: number) => {
        switch (block.type) {
            // The page-level H1 duplicates our screen title, so skip it.
            case 'h1':
                return null
            case 'h2':
                return (
                    <Text
                        key={index}
                        preset="bold"
                        style={[$termsH2, {color: textColor, borderTopColor: separatorColor}]}
                        text={block.segments.map(s => s.text).join('')}
                    />
                )
            case 'h3':
                return (
                    <Text
                        key={index}
                        preset="bold"
                        style={[$termsH3, {color: textColor}]}
                        text={block.segments.map(s => s.text).join('')}
                    />
                )
            case 'p':
                return (
                    <Text key={index} style={[$termsParagraph, {color: textColor}]}>
                        {renderSegments(block.segments)}
                    </Text>
                )
            case 'li':
                return (
                    <View key={index} style={$termsListItem}>
                        <Text style={[$termsBullet, {color: textColor}]} text={'•'} />
                        <Text style={[$termsListText, {color: textColor}]}>
                            {renderSegments(block.segments)}
                        </Text>
                    </View>
                )
            case 'quote':
                return (
                    <View
                        key={index}
                        style={[$termsQuote, {borderLeftColor: tintColor, backgroundColor: separatorColor}]}
                    >
                        <Text style={[$termsParagraph, {color: textColor, marginTop: 0}]}>
                            {renderSegments(block.segments)}
                        </Text>
                    </View>
                )
            case 'hr':
                return <View key={index} style={[$termsRule, {backgroundColor: separatorColor}]} />
            default:
                return null
        }
    }

    return (
        <View style={[$termsInner, {backgroundColor: cardBg}]}>
            {state === 'loading' && (
                <View style={$termsCentered}>
                    <ActivityIndicator color={tintColor} />
                    <Text
                        tx="welcomeScreen_terms_loading"
                        style={[$termsStatusText, {color: textColor}]}
                    />
                </View>
            )}
            {state === 'error' && (
                <View style={$termsCentered}>
                    <Text
                        tx="welcomeScreen_terms_error"
                        style={[$termsStatusText, {color: textColor}]}
                    />
                    <Button
                        preset="tertiary"
                        onPress={load}
                        tx="welcomeScreen_terms_retry"
                        style={{marginTop: spacing.small}}
                    />
                </View>
            )}
            {state === 'ready' && (
                <ScrollView
                    style={{flex: 1}}
                    contentContainerStyle={$termsScrollContent}
                    nestedScrollEnabled={true}
                    showsVerticalScrollIndicator={true}
                >
                    {blocks.map(renderBlock)}
                </ScrollView>
            )}
        </View>
    )
}


/* -------------------------------- Styles -------------------------------- */

const $container: ViewStyle = {
  flex: 1,
  paddingHorizontal: spacing.medium,
}

const $pager: ViewStyle = {
  flex: 1,
  marginTop: spacing.large,
}

const $page: ViewStyle = {
  flex: 1,
}

const $dotsContainer: ViewStyle = {
  height: 30,
  justifyContent: 'center',
  alignItems: 'center',
  marginVertical: spacing.small,
}

/* Hero */

const $heroScroll: ViewStyle = {
  flexGrow: 1,
  justifyContent: 'center',
  paddingBottom: spacing.large,
}

const $heroHeading: TextStyle = {
  fontFamily: typography.logo?.normal,
  fontSize: 42,
  lineHeight: 50,
  color: colors.palette.neutral100,
}

const $heroIntro: TextStyle = {
  marginTop: spacing.large,
  fontSize: 18,
  lineHeight: 27,
}

/* Terms page */

const $termsPage: ViewStyle = {
  flex: 1,
  paddingBottom: spacing.small,
}

const $termsTitle: TextStyle = {
  alignSelf: 'center',
  marginBottom: spacing.small,
}

const $termsBox: ViewStyle = {
  flex: 1,
  borderRadius: spacing.small,
  overflow: 'hidden',
}

const $termsInner: ViewStyle = {
  flex: 1,
}

const $termsScrollContent: ViewStyle = {
  padding: spacing.medium,
}

const $termsCentered: ViewStyle = {
  flex: 1,
  justifyContent: 'center',
  alignItems: 'center',
  padding: spacing.large,
}

const $termsStatusText: TextStyle = {
  marginTop: spacing.small,
  textAlign: 'center',
}

const $termsH2: TextStyle = {
  fontSize: 18,
  lineHeight: 26,
  marginTop: spacing.large,
  marginBottom: spacing.extraSmall,
  paddingTop: spacing.medium,
  borderTopWidth: 1,
}

const $termsH3: TextStyle = {
  fontSize: 16,
  lineHeight: 24,
  marginTop: spacing.medium,
  marginBottom: spacing.tiny,
}

const $termsParagraph: TextStyle = {
  fontSize: 14,
  lineHeight: 21,
  marginTop: spacing.small,
}

const $termsListItem: ViewStyle = {
  flexDirection: 'row',
  marginTop: spacing.extraSmall,
  paddingRight: spacing.small,
}

const $termsBullet: TextStyle = {
  fontSize: 14,
  lineHeight: 21,
  marginRight: spacing.small,
}

const $termsListText: TextStyle = {
  flex: 1,
  fontSize: 14,
  lineHeight: 21,
}

const $termsQuote: ViewStyle = {
  marginTop: spacing.medium,
  paddingVertical: spacing.small,
  paddingHorizontal: spacing.medium,
  borderLeftWidth: 3,
  borderRadius: spacing.tiny,
}

const $termsRule: ViewStyle = {
  height: 1,
  marginTop: spacing.medium,
}

/* Consent */

const $agreeRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: spacing.medium,
}

const $agreeText: TextStyle = {
  flex: 1,
  fontSize: 14,
  lineHeight: 21,
}

const $agreeLink: TextStyle = {
  fontFamily: typography.primary?.medium,
  textDecorationLine: 'underline',
}

const $enterButton: ViewStyle = {
  marginTop: spacing.medium,
  alignSelf: 'center',
}
