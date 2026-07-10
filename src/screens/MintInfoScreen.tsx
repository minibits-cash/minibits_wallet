import React, { useEffect, useMemo, useState } from 'react'
import { GetInfoResponse as CashuGetInfoResponse, SwapMethod } from '@cashu/cashu-ts'
import { CashuUtils } from '../services/cashu/cashuUtils'
import Clipboard from '@react-native-clipboard/clipboard'
import { observer } from 'mobx-react-lite'
import { getSnapshot } from 'mobx-state-tree'
import { DimensionValue, Image, LayoutAnimation, Platform, TextStyle, UIManager, View, ViewStyle } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import JSONTree from 'react-native-json-tree'
import {
  $sizeStyles,
  Button,
  Card,
  Header,
  Icon,
  IconTypes,
  InfoModal,
  ListItem,
  Loading,
  MintIcon,
  Screen,
  Text,
} from '../components'
import { CollapsibleText } from '../components/CollapsibleText'
import { translate } from '../i18n'
import { useStores } from '../models'
import { Mint, MintStatus } from '../models/Mint'
import { log } from '../services'
import { colors, spacing, typography, useThemeColor } from '../theme'
import useColorScheme from '../theme/useThemeColor'
import { useHeader } from '../utils/useHeader'
import { CurrencySign } from './Wallet/CurrencySign'
import { SvgXml } from 'react-native-svg'
import { CurrencyCode, formatCurrency } from '../services/wallet/currency'
import { QRShareModal } from '../components/QRShareModal'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
import FastImage from 'react-native-fast-image'

interface DetailedNutInfo {
  methods: Array<SwapMethod>;
  disabled: boolean;
}

interface MethodLimit {
  min?: number,
  max?: number,
}

type GetInfoResponse = CashuGetInfoResponse & {icon_url: string}

const iconMap: Partial<Record<keyof GetInfoResponse, IconTypes>> = {
  'name': 'faTag',
  'pubkey': 'faKey',
  'version': 'faInfoCircle',
  'contact': 'faAddressCard'
}
const contactIconMap: Record<string, IconTypes> = {
  'email': 'faEnvelope',
  'twitter': 'faTwitter',
  'telegram': 'faTelegramPlane',
  'discord': 'faDiscord',
  'github': 'faGithub',
  'reddit': 'faReddit',
  'nostr': 'faCircleNodes'
}

type Props = StaticScreenProps<{
  mintUrl : string
}>

/** Every NUT-06 field is optional and mints may publish malformed values, so
 *  narrow to a usable string or give up. */
function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Renders any info value as a copyable string, without assuming its type. */
function stringifyValue(value: unknown): string {
  if (value === null || typeof value === 'undefined') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? ''
    } catch (e) {
      return ''
    }
  }
  return String(value)
}

/** header height, and the scroll distance over which the header title hands off
 *  to the navigation header */
const HEADER_HEIGHT = spacing.screenHeight * 0.20

export const MintInfoScreen = observer(function MintInfoScreen({ route }: Props) {
  const navigation = useNavigation()
  const scrollY = useSharedValue(0)

  const { mintsStore, walletStore } = useStores()
  //const { walletStore } = nonPersistedStores

  const [isLoading, setIsLoading] = useState(false)
  const [mintInfo, setMintInfo] = useState<GetInfoResponse | undefined>()
  const [mint, setMint] = useState<Mint>()
  const [isLocalInfoVisible, setIsLocalInfoVisible] = useState<boolean>(false)
  const [isShareModalVisible, setIsShareModalVisible] = useState(false)
  const [isInfoLoadFailed, setIsInfoLoadFailed] = useState(false)

  const [info, setInfo] = useState('')

  useEffect(() => {
    const getInfo = async () => {
      const mintUrl = route.params?.mintUrl

      if (!mintUrl) {
        log.error('[MintInfoScreen] Missing mintUrl route param')
        setIsInfoLoadFailed(true)
        return
      }

      log.trace('[MintInfoScreen] useEffect', { mintUrl })

      const mint = mintsStore.findByUrl(mintUrl)

      if (!mint) {
        log.error('[MintInfoScreen] Could not find mint', { mintUrl })
        setIsInfoLoadFailed(true)
        return
      }

      setMint(mint)
      // show whatever we cached on device while the fresh info loads
      const cachedInfo = mint.mintInfo as GetInfoResponse | undefined
      setMintInfo(cachedInfo)
      setIsLoading(!cachedInfo)

      try {
        const info: GetInfoResponse & {time: number} = await walletStore.getMintInfo(mint.mintUrl)
        mint.setStatus(MintStatus.ONLINE)
        mint.setMintInfo(info)
        if (info.name && info.name !== mint.shortname) {
          await mint.setShortname()
        }
        setMintInfo(info as GetInfoResponse)
        setIsInfoLoadFailed(false)
      } catch (e: any) {
        log.warn('[MintInfoScreen] Could not load mint info', { mintUrl, message: e.message })
        mint.setStatus(MintStatus.OFFLINE)
        setIsInfoLoadFailed(true)
      } finally {
        setIsLoading(false)
      }
    }
    getInfo()
  }, [])

  const toggleLocalInfo = () => {
    LayoutAnimation.easeInEaseOut()
    setIsLocalInfoVisible(!isLocalInfoVisible)
  }

  const toggleShareModal = () => setIsShareModalVisible(previousState => !previousState)

  const gotoShare = function () {
    toggleShareModal()
  } 

  /** memoized mint limit info */
  const mintLimitInfo = useMemo(() => {
    if (typeof mintInfo === 'undefined') return;
    return getMintLimits(mintInfo)
  }, [mintInfo])

  const colorScheme = useColorScheme()
  const textDim = useThemeColor('textDim')
  const headerBg = useThemeColor('header')
  const iconColor = useThemeColor('textDim')
  const headerTitle = useThemeColor('headerTitle')

  // every field of the NUT-06 info response is optional, so nothing may be trusted to exist
  const iconUrl = asNonEmptyString(mintInfo?.icon_url)
  const mintName = asNonEmptyString(mintInfo?.name) ?? mint?.shortname
  const rawMotd = asNonEmptyString(mintInfo?.motd)
  const motd = rawMotd !== 'Message to users' ? rawMotd : undefined

  // the mint name fades into the navigation header as the large header scrolls away
  useHeader({
    leftIcon: 'faArrowLeft',
    onLeftPress: () => {
      navigation.goBack()
    },
    title: mintName,
    scrollY,
    scrollDistance: HEADER_HEIGHT,
  }, [mintName])

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y
    },
  })

  const animatedHeaderStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, HEADER_HEIGHT * 0.5],
      [1, 0],
      Extrapolation.CLAMP
    )
    return { opacity }
  })

  return (
    <Screen contentContainerStyle={$screen} preset="fixed">
      <Animated.ScrollView
        style={$screen}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
      <View style={[$headerContainer, {backgroundColor: headerBg}]}>
        <Animated.View style={[$headerContent, animatedHeaderStyle]}>
      {iconUrl ? (
              <FastImage
                style={
                  {
                    width: spacing.extraLarge,
                    height: spacing.extraLarge,
                    borderRadius: spacing.small,
                  }
                }
                source={{uri: iconUrl}}
              />
          ):(
            <View
              style={{
                marginEnd: spacing.small,
                flex: 0,
                borderRadius: spacing.small,
                padding: spacing.extraSmall,
                backgroundColor: colors.palette.orange600
              }}
            >
            <SvgXml
              width={spacing.medium}
              height={spacing.medium}
              xml={MintIcon}
              fill='white'
            />
          </View>
        )}
        <Text preset='subheading' text={mintName} style={{color: headerTitle}}/>
        {mint?.units && (
          <View style={{flexDirection: 'row'}}>
            {mint.units.map(unit => (
              <CurrencySign
                //containerStyle={{marginTop: spacing.small}}
                key={unit}
                mintUnit={unit}
                textStyle={{color: 'white'}}
              />
            ))}
          </View>
        )}
        </Animated.View>
      </View>
      <View style={$contentContainer}>
        {isLoading ? (
          <View style={{height: spacing.screenHeight * 0.4}}><Loading/></View>
        ) : (
        <>
        {isInfoLoadFailed && <InfoLoadFailedCard />}
        {motd && <MOTDCard motd={motd} />}
        {mintInfo && <DescriptionCard info={mintInfo} />}
        <Card
          labelTx={"mintInfo_mintUrlHeading"}          
          HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
          content={mint?.mintUrl}
          RightComponent={
            <View style={$rightContainer}>
                <Button
                    onPress={gotoShare}
                    preset='secondary'
                    LeftAccessory={() => <Icon icon='faQrcode' color={iconColor} />}
                />                                                
            </View>
        }
        />
        {mintInfo && mintLimitInfo?.any && <MintLimitsCard info={mintInfo} limitInfo={mintLimitInfo}/>}
        {mintInfo && 
          <>
            <ContactCard info={mintInfo} popupMessage={setInfo} />
            <Card
              labelTx={"mintInfo_keyValueInfoCardHeading"}            
              ContentComponent={
                <>
                  {mintInfo && <MintInfoDetails info={mintInfo} popupMessage={setInfo} />}
                </>
              }
            />
          </>
        }
        {mintInfo && <NutsCard info={mintInfo} />}
        <Card
          ContentComponent={
            <>
              <ListItem
                tx="onDeviceInfo"
                RightComponent={
                  <View style={$rightContainer}>
                    <Button
                      onPress={toggleLocalInfo}
                      text={isLocalInfoVisible ? translate("commonHide") : translate("commonShow")}
                      preset="secondary"
                    />
                  </View>
                }
              />
              {isLocalInfoVisible && mint && (
                <JSONTree
                  hideRoot
                  data={(() => {
                    const m = mint
                    const snap = getSnapshot(m) as any
                    // `counter` is stripped from every snapshot (it is mastered in
                    // SQLite, not MMKV). Re-inject the live cache value per keyset
                    // so this debug tree shows the real derivation index, not 0.
                    return {
                      ...snap,
                      proofsCounters: snap.proofsCounters?.map((c: any) => ({
                        ...c,
                        counter: m?.proofsCounters?.find(pc => pc.keyset === c.keyset)?.counter ?? c.counter,
                      })),
                    }
                  })() as any}
                  theme={{
                    scheme: 'default',
                    base00: '#eee',
                  }}
                  invertTheme={colorScheme === 'light' ? false : true}
                />
              )}
            </>
          }
        />
        </>

        )}
      </View>
      </Animated.ScrollView>
      <QRShareModal
          data={route.params?.mintUrl ?? ''}
          shareModalTx='mintsScreen_share'
          subHeading={mintName ?? translate('mintInfo_loadingNamePlaceholder')}
          type='URL'
          isVisible={isShareModalVisible}
          onClose={toggleShareModal}
        />
      {info && <InfoModal message={info} />}
    </Screen>
  )
})


function MOTDCard(props: {motd: string}) {
  return (
    <Card
      RightComponent={
        <View style={{justifyContent: 'center'}}>
          <Icon icon="faCircleExclamation" color={'white'} size={20} />
        </View>
      }
      // heading='Important'
      ContentComponent={
        <Text style={{fontStyle: 'italic'}} text={props.motd} />
      }
      style={{backgroundColor: colors.dark.warn, marginBottom: spacing.small}}
    />
  )
}

/** Shown when the mint did not return its info (mint is switched to OFFLINE). */
function InfoLoadFailedCard() {
  return (
    <Card
      RightComponent={
        <View style={{justifyContent: 'center'}}>
          <Icon icon="faTriangleExclamation" color={'white'} size={20} />
        </View>
      }
      ContentComponent={
        <Text style={{fontStyle: 'italic'}} tx="mintInfo_loadFailed" />
      }
      style={{backgroundColor: colors.dark.warn}}
    />
  )
}

function MintLimitsCard(props: { info: GetInfoResponse, limitInfo: ReturnType<typeof getMintLimits> }) {
  if (props.limitInfo.mintSats === false && props.limitInfo.meltSats === false) return null
  log.trace('[MintLimitsCard]', props.limitInfo)

  const limitText = (m: false | MethodLimit): string | undefined => {
    if (!m) return undefined
    const min = `${formatCurrency(m.min as number, CurrencyCode.SAT)}`
    const max = `${formatCurrency(m.max as number, CurrencyCode.SAT)}`

    return (typeof m.min !== 'undefined' && typeof m.max !== 'undefined' ? `${min} – ${max}`
    : typeof m.min !== 'undefined' && typeof m.max === 'undefined' ? `min: ${min}`
    : typeof m.max !== 'undefined' && typeof m.min === 'undefined' ? `max: ${max}`
    : void 0)
  }

  // a mint may publish limits for only one of the two methods
  const LimitItem = (props: { m: false | MethodLimit, type: 'mint' | 'melt' }) => (
  <View style={$limitItem}>
    <Icon
      icon={props.type === 'mint' ? 'faCircleArrowDown' : 'faCircleArrowUp'}
      color={colors.palette.success200}
      size={16}
      containerStyle={$nutIcon}
    />
    <Text text={limitText(props.m) ?? '–'} />
  </View>)

  return (<Card
    labelTx="mintInfo_mintMeltHeading"
    // HeadingTextProps={{ style: [$sizeStyles.sm, { color: textDim }] }}
    ContentComponent={<>
      <View style={$limitItemWrapper}>
        <Text tx="mintInfo_depositMint" style={{ width: '50%' }} />
        <Text tx="mintInfo_withdrawMelt" style={{ width: '50%' }} />
      </View>
      <View style={$limitItemWrapper}>
        <LimitItem m={props.limitInfo.mintSats} type="mint" />
        <LimitItem m={props.limitInfo.meltSats} type="melt" />
      </View>
    </>}
  />)
}

function DescriptionCard(props: {info: GetInfoResponse}) {
  const description = asNonEmptyString(props.info?.description)
  const descriptionLong = asNonEmptyString(props.info?.description_long)

  return (<Card
    // labelTx="mintInfo_descriptionHeading"
    //headingTx="mintInfo_descriptionHeading"
    // HeadingTextProps={{ style: [$sizeStyles.sm, { color: textDim }] }}
    ContentComponent={
      description ? (
        <CollapsibleText
          collapsed={true}
          summary={description}
          text={descriptionLong && description !== descriptionLong
            ? description + '\n' + descriptionLong
            : ''
          }
        />
      ) : (
        <Text
          style={{fontStyle: 'italic'}}
          text={translate('mintInfo_emptyValueParam', {
            param: translate('mintInfo_descriptionHeading'),
          })}
        />
      )
    }
  />)
}

/** one-line item for NUT specifications and adjacent things like limits */
function NutItem(props: {
  enabled: boolean,
  nutNameNumber: string,
  width?: DimensionValue
  customIcon?: IconTypes,
  customIconColor?: string,
}) {
  return (
    <View style={[$nutItem, { width: props?.width ?? 'auto'}]}>
      <Icon
          icon={props?.customIcon ?? (props.enabled ? 'faCheckCircle' : 'faXmark')}
          color={props?.customIconColor ?? (props.enabled ? colors.palette.success200 : colors.palette.angry500)}
          size={16}
          containerStyle={$nutIcon}
        />
      <Text size='xs'>NUT-{props.nutNameNumber}</Text>
    </View>
  )
}

function NutsCard(props: {info: GetInfoResponse}) {
  const supportedNutsDetailed: [string, DetailedNutInfo][] = []
  const nutsSimple: [string, boolean][] = []

  const nuts = CashuUtils.isObj(props.info?.nuts) ? props.info.nuts : {}

  // detailed nuts are separated from simple ones if we want to show more info abt them in the future
  for (const [nut, info] of Object.entries(nuts)) {
    // a mint may publish a null / primitive value instead of a settings object;
    // `in` would throw on those, so resolve them before any further checks
    if (info === null || typeof info === 'undefined') {
      nutsSimple.push([nut, false])
      continue;
    }
    if (typeof info !== 'object') {
      nutsSimple.push([nut, !!info])
      continue;
    }
    if (nut === '15' && 'methods' in info && Array.isArray(info.methods) && info.methods.length > 0) {
      // see https://github.com/cashubtc/nuts/blob/main/15.md - multipath payments
      // in the future, it might be nice to show for which currencies are multipath payments supported
      // for example by extending NutItem
      nutsSimple.push(['15', true])
      continue;
    }
    // see https://github.com/cashubtc/nutshell/issues/588
    if (nut === '17' && Array.isArray(info) && info.length > 0) {
      nutsSimple.push(['17', info.some(m => m?.unit === 'sat')])
      continue;
    }
    // proper nut-17 response handling (not implemented in nutshell yet)
    if (nut === '17' && 'supported' in info && Array.isArray(info.supported) && info.supported.length > 0) {
      nutsSimple.push(['17', info.supported.some(m => m?.unit === 'sat')])
      continue;
    }
    if (nut === '19' && 'cached_endpoints' in info && Array.isArray(info.cached_endpoints) && info.cached_endpoints.length > 0) {
      nutsSimple.push(['19', info.cached_endpoints.some(e => e?.method === 'POST')])
      continue;
    }
    if (nut === '29' && (('supported' in info && info.supported === true) || ('methods' in info && Array.isArray(info.methods) && info.methods.length > 0))) {
      nutsSimple.push(['29', true])
      continue;
    }
    if ('disabled' in info && info.disabled === false) { // detailed
      supportedNutsDetailed.push([nut, info as unknown as DetailedNutInfo])
    } else if ('supported' in info && typeof info.supported !== 'undefined') { // simple
      nutsSimple.push([nut, !!info.supported])
    } else if (!('disabled' in info) && 'methods' in info && Array.isArray(info.methods) && info.methods.length > 0) {
      // `disabled` is optional - a nut advertising methods is supported unless it says otherwise
      nutsSimple.push([nut, true])
    } else {
      nutsSimple.push([nut, false]) // fallback or detailed but disabled nut
    }
  }

  const smallNutCols = 4
  return (
    <Card
      labelTx="mintInfo_nutsHeading"
      style={{marginBottom: spacing.small}}
      // HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
      ContentComponent={
        supportedNutsDetailed.length === 0 && nutsSimple.length === 0 ? (
          <Text
            style={{fontStyle: 'italic'}}
            text={translate('mintInfo_emptyValueParam', { param: translate('mintInfo_nutsHeading') })}
          />
        ) : (
        <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
          {supportedNutsDetailed.map(([nut, info]) => (
            <NutItem
              nutNameNumber={nut}
              enabled={true}
              key={`detailed-${nut}`}
              width={`${Math.round(100 / smallNutCols)}%`}
            />
          ))}
          {nutsSimple.map(([nut, enabled]) => (
            <NutItem
              nutNameNumber={nut}
              enabled={enabled}
              key={`simple-${nut}`}
              width={`${Math.round(100 / smallNutCols)}%`}
            />
          ))}
        </View>
        )
      }
    />
  )
}

function ContactCard(props: { info: GetInfoResponse, popupMessage: (msg: string) => void }) {
  const textDim = useThemeColor('textDim')
  type Contact = {method: string, info: string}

  // `contact` is optional and its entries may be malformed or partially filled
  const rawContacts = Array.isArray(props.info?.contact) ? props.info.contact : []

  let contacts: Contact[] = []
  for (const contact of rawContacts) {
    if (!contact) continue

    // legacy tuple form: ['email', 'contact@me.com']
    if (Array.isArray(contact)) {
      const method = asNonEmptyString(contact[0])
      const info = asNonEmptyString(contact[1])
      if (method && info) contacts.push({ method, info })
      continue
    }

    if (typeof contact === 'object') {
      const method = asNonEmptyString((contact as Contact).method)
      const info = asNonEmptyString((contact as Contact).info)
      if (method && info) contacts.push({ method, info })
    }
  }

  return (
    <Card
      labelTx="mintInfo_contactsHeading"
      //HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
      ContentComponent={
        contacts.length === 0 ? (
          <Text
            style={{fontStyle: 'italic'}}
            text={translate('mintInfo_emptyValueParam', { param: translate('mintInfo_contactsHeading') })}
          />
        ) : (
          <>
            {contacts.map(({ method, info }, index) => (
              <ListItem
                style={$contactListItem}
                key={`${method}-${index}`}
                text={method}
                textStyle={$sizeStyles.xs}
                LeftComponent={<Icon icon={method in contactIconMap ? contactIconMap[method] : 'faAddressBook'} color={textDim}/>}
                RightComponent={<View style={{ width: spacing.screenWidth * 0.6 }}><Text text={info}/></View>}
                topSeparator={index !== 0}
                onLongPress={() => {
                  Clipboard.setString(info)
                  props.popupMessage(translate('commonCopySuccessParam', { param: info }))
                }}
              />
            ))}
          </>
        )
      }
    />
  )
}

/** don't render these because they're rendered in separate components */
const detailsHiddenKeys = new Set(['name', 'motd', 'description', 'description_long', 'nuts', 'contact', 'icon_url', 'time'])

/** key-value pairs of details about the mint */
function MintInfoDetails(props: { info: GetInfoResponse, popupMessage: (msg: string) => void }) {
  const iconColor = useThemeColor('textDim')

  const items: React.JSX.Element[] = Object.entries(props.info ?? {})
    .filter(([key, value]) => !(detailsHiddenKeys.has(key)))
    .map(([key, value], index) => {
      const missingComponent = <Text
        style={{fontStyle: 'italic'}}
        size="xs"
        key={key}
        text={translate('mintInfo_emptyValueParam', { param: key })}
      />

      const stringValue = stringifyValue(value)
      const valueComponent = stringValue.trim() !== ''
        ? <Text size='xs' text={stringValue} />
        : missingComponent;

      const handleLongPress = () => {
        if (stringValue.trim() === '') return;
        Clipboard.setString(stringValue)
        props.popupMessage(translate('commonCopySuccessParam', { param: stringValue }))
      }

      // @ts-ignore no-implicit-any
      const leftComponent = key in iconMap ? <Icon icon={iconMap[key]} color={iconColor}/> : void 0
      // @ts-ignore no-implicit-any

      return <ListItem 
        LeftComponent={leftComponent}
        text={key}
        textStyle={$sizeStyles.xs}
        RightComponent={<View style={{ width: spacing.screenWidth * 0.6 }}>{valueComponent}</View>}
        topSeparator={index !== 0}
        key={key}
        onLongPress={handleLongPress}
        style={$listItem}
      />
    })
  return <>{items}</>
}

/** the `methods` array of a given nut, or empty if the mint did not publish it */
function getNutMethods(info: GetInfoResponse, nut: '4' | '5'): Array<SwapMethod> {
  const methods = (info?.nuts as any)?.[nut]?.methods
  return Array.isArray(methods) ? methods : []
}

function getSatLimit(methods: Array<SwapMethod>): false | MethodLimit {
  for (const method of methods) {
    if (!method || method.unit !== 'sat') continue
    if (typeof method.min_amount === 'undefined' && typeof method.max_amount === 'undefined') continue
    return {
      min: method.min_amount !== undefined ? Number(method.min_amount) : undefined,
      max: method.max_amount !== undefined ? Number(method.max_amount) : undefined,
    }
  }
  return false
}

function getMintLimits(info: GetInfoResponse) {
  // later this can be adjusted to show USD/other units as well. for now only shows limits if they are in sats
  const mintSats = getSatLimit(getNutMethods(info, '4'))
  const meltSats = getSatLimit(getNutMethods(info, '5'))

  return {
    mintSats,
    meltSats,
    any: mintSats || meltSats,
    both: mintSats && meltSats,
  }
}

const $screen: ViewStyle = { }
const $nutIcon: ViewStyle = { paddingHorizontal: 0 }

const $limitItem: ViewStyle = {
  alignItems: 'center',
  flexDirection: 'row',
  width: '50%',
  gap: spacing.extraSmall,
}
const $limitItemWrapper: ViewStyle = {
  flexDirection: 'row',
  marginVertical: spacing.extraSmall  
}

const $listItem: ViewStyle = {
  columnGap: spacing.micro,
  alignItems: 'center',
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  // padding: spacing.tiny,
  height: HEADER_HEIGHT,
}

const $headerContent: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'space-around',
  paddingBottom: spacing.huge,
}

const $contentContainer: TextStyle = {
  marginTop: -spacing.extraLarge * 1.5,
  rowGap: spacing.small,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}

const $nutItem: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: spacing.extraSmall
}

const $contactListItem: ViewStyle = { 
  flexDirection: 'row',
  columnGap: spacing.tiny
}
