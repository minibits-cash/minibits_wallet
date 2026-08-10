import React, { useEffect, useMemo, useState } from 'react'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import Clipboard from '@react-native-clipboard/clipboard'
import numbro from 'numbro'
import { observer } from 'mobx-react-lite'
import { getSnapshot } from 'mobx-state-tree'
import { LayoutAnimation, Linking, TextStyle, View, ViewStyle } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import JSONTree from 'react-native-json-tree'
import { SvgXml } from 'react-native-svg'
import FastImage from 'react-native-fast-image'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'
import {
  $sizeStyles,
  Button,
  Card,
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
import { QRShareModal } from '../components/QRShareModal'
import { translate, TxKeyPath } from '../i18n'
import { useStores } from '../models'
import { Mint, MintStatus } from '../models/Mint'
import { log } from '../services'
import {
  getMintAuditSummary,
  MintAuditSummary,
  MintAuditWarning,
  MintAuditWarningCode,
  MintSwapEvent,
} from '../services/mintAuditService'
import { formatCurrency, getCurrency } from '../services/wallet/currency'
import { colors, spacing, useThemeColor } from '../theme'
import useColorScheme from '../theme/useThemeColor'
import { formatDayTime, formatRelativeToNow } from '../utils/dateUtils'
import { useHeader } from '../utils/useHeader'
import { CurrencySign } from './Wallet/CurrencySign'
import {
  asNonEmptyString,
  getContacts,
  getMintCapabilities,
  getNutSupport,
  getPaymentMethods,
  MethodLimit,
  MintCapability,
  MintContact,
  MintInfo,
  NutSupport,
  PaymentMethodSummary,
} from './Mints/mintInfoSummary'

type Props = StaticScreenProps<{
  mintUrl: string
}>

const contactIconMap: Record<string, IconTypes> = {
  email: 'faEnvelope',
  twitter: 'faTwitter',
  telegram: 'faTelegramPlane',
  discord: 'faDiscord',
  github: 'faGithub',
  reddit: 'faReddit',
  nostr: 'faCircleNodes',
  website: 'faGlobe',
}

/** header height, and the scroll distance over which the header title hands off
 *  to the navigation header */
const HEADER_HEIGHT = spacing.screenHeight * 0.20

export const MintInfoScreen = observer(function MintInfoScreen({ route }: Props) {
  const navigation = useNavigation()
  const scrollY = useSharedValue(0)

  const { mintsStore, walletStore, userSettingsStore } = useStores()

  const [isLoading, setIsLoading] = useState(false)
  const [mintInfo, setMintInfo] = useState<MintInfo | undefined>()
  const [mint, setMint] = useState<Mint>()
  const [audit, setAudit] = useState<MintAuditSummary | undefined>()
  const [isLocalInfoVisible, setIsLocalInfoVisible] = useState(false)
  const [isShareModalVisible, setIsShareModalVisible] = useState(false)
  const [isInfoLoadFailed, setIsInfoLoadFailed] = useState(false)
  const [info, setInfo] = useState('')

  const mintUrl = route.params?.mintUrl

  useEffect(() => {
    const getInfo = async () => {
      if (!mintUrl) {
        log.error('[MintInfoScreen]', 'Missing mintUrl route param')
        setIsInfoLoadFailed(true)
        return
      }

      const mint = mintsStore.findByUrl(mintUrl)

      if (!mint) {
        log.error('[MintInfoScreen]', 'Could not find mint', { mintUrl })
        setIsInfoLoadFailed(true)
        return
      }

      setMint(mint)
      // show whatever we cached on device while the fresh info loads
      const cachedInfo = mint.mintInfo as MintInfo | undefined
      setMintInfo(cachedInfo)
      setIsLoading(!cachedInfo)

      try {
        const freshInfo: MintInfo = await walletStore.getMintInfo(mint.mintUrl)
        mint.setStatus(MintStatus.ONLINE)
        mint.setMintInfo(freshInfo)
        if (freshInfo.name && freshInfo.name !== mint.shortname) {
          await mint.setShortname()
        }
        setMintInfo(freshInfo)
        setIsInfoLoadFailed(false)
      } catch (e: any) {
        log.warn('[MintInfoScreen]', 'Could not load mint info', { mintUrl, message: e.message })
        mint.setStatus(MintStatus.OFFLINE)
        setIsInfoLoadFailed(true)
      } finally {
        setIsLoading(false)
      }
    }
    getInfo()
  }, [mintUrl])

  // Independent of the mint's own info: the whole point of the auditor is that
  // it answers even when the mint does not. Resolves undefined on any failure,
  // which simply hides the section.
  //
  // Gated on the privacy setting, since this is the ONE request on this screen
  // that tells a third party which mint the user is looking at. Reading it here
  // rather than inside the service keeps the network call and the consent in the
  // same place, and the effect re-runs if the switch is flipped mid-visit.
  const isMintAuditOn = userSettingsStore.isMintAuditOn

  useEffect(() => {
    if (!mintUrl || !isMintAuditOn) {
      setAudit(undefined)
      return
    }
    let isCurrent = true

    getMintAuditSummary(mintUrl).then(summary => {
      if (isCurrent) setAudit(summary)
    })

    return () => { isCurrent = false }
  }, [mintUrl, isMintAuditOn])

  const toggleLocalInfo = () => {
    LayoutAnimation.easeInEaseOut()
    setIsLocalInfoVisible(!isLocalInfoVisible)
  }

  const toggleShareModal = () => setIsShareModalVisible(previousState => !previousState)

  const copyToClipboard = (value: string) => {
    Clipboard.setString(value)
    setInfo(translate('commonCopySuccessParam', { param: value }))
  }

  const capabilities = useMemo(() => getMintCapabilities(mintInfo), [mintInfo])
  const nutSupport = useMemo(() => getNutSupport(mintInfo), [mintInfo])
  const paymentMethods = useMemo(() => getPaymentMethods(mintInfo), [mintInfo])
  const contacts = useMemo(() => getContacts(mintInfo), [mintInfo])

  const colorScheme = useColorScheme()
  const textDim = useThemeColor('textDim')
  const headerBg = useThemeColor('header')
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
                style={{
                  width: spacing.extraLarge,
                  height: spacing.extraLarge,
                  borderRadius: spacing.small,
                }}
                source={{uri: iconUrl}}
              />
            ) : (
              <View
                style={{
                  marginEnd: spacing.small,
                  flex: 0,
                  borderRadius: spacing.small,
                  padding: spacing.extraSmall,
                  backgroundColor: colors.palette.orange600,
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
              {isInfoLoadFailed && <NoticeCard tx="mintInfo_loadFailed" icon="faTriangleExclamation" />}
              {motd && <NoticeCard text={motd} icon="faCircleExclamation" />}
              {mintInfo && <DescriptionCard info={mintInfo} />}
              <Card
                labelTx="mintInfo_mintUrlHeading"
                HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
                content={mint?.mintUrl}
                RightComponent={
                  <View style={$rightContainer}>
                    <Button
                      onPress={toggleShareModal}
                      preset='secondary'
                      LeftAccessory={() => <Icon icon='faQrcode' color={textDim} />}
                    />
                  </View>
                }
              />
              {audit && <AvailabilityCard audit={audit} />}
              {paymentMethods.length > 0 && <PaymentMethodsCard methods={paymentMethods} />}
              {mintInfo && <CapabilitiesCard capabilities={capabilities} nuts={nutSupport} />}
              {contacts.length > 0 && <ContactsCard contacts={contacts} onCopy={copyToClipboard} />}
              {mintInfo && <DetailsCard info={mintInfo} onCopy={copyToClipboard} />}
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
        data={mintUrl ?? ''}
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

/** Warning banner — used for both the MOTD and an unreachable mint. */
function NoticeCard(props: {tx?: TxKeyPath, text?: string, icon: IconTypes}) {
  return (
    <Card
      RightComponent={
        <View style={{justifyContent: 'center'}}>
          <Icon icon={props.icon} color={'white'} size={20} />
        </View>
      }
      ContentComponent={
        <Text style={{fontStyle: 'italic'}} tx={props.tx} text={props.text} />
      }
      style={{backgroundColor: colors.dark.warn}}
    />
  )
}

function DescriptionCard(props: {info: MintInfo}) {
  const description = asNonEmptyString(props.info.description)
  const descriptionLong = asNonEmptyString(props.info.description_long)

  if (!description && !descriptionLong) return null

  const summary = description ?? (descriptionLong as string)
  const full = descriptionLong && description !== descriptionLong
    ? [description, descriptionLong].filter(Boolean).join('\n')
    : ''

  return (
    <Card
      ContentComponent={
        <CollapsibleText collapsed={true} summary={summary} text={full} />
      }
    />
  )
}

// === Availability (mint auditor) ===

const AUDIT_WARNING_LABELS: Record<MintAuditWarningCode, TxKeyPath> = {
  lastSwapFailed: 'mintInfo_audit_warn_lastSwapFailed',
  lastSwapFailedReliable: 'mintInfo_audit_warn_lastSwapFailedReliable',
  lastSwapFailedUnreliable: 'mintInfo_audit_warn_lastSwapFailedUnreliable',
  unknownQuality: 'mintInfo_audit_warn_unknownQuality',
  notEnoughData: 'mintInfo_audit_warn_notEnoughData',
  lowSuccessRate: 'mintInfo_audit_warn_lowSuccessRate',
  inactive: 'mintInfo_audit_warn_inactive',
  noSuccessfulSwaps: 'mintInfo_audit_warn_noSuccessfulSwaps',
  slow: 'mintInfo_audit_warn_slow',
}

/**
 * `2783 ms` under ten seconds, `12.34 s` above — cashu.me's auditor panel reads
 * the same way, and at this precision a slow mint is the thing worth seeing.
 *
 * Not date-fns' `formatDuration`: its smallest unit is the second, so a typical
 * sub-second swap would render as "0 seconds". Elapsed CALENDAR time on this
 * screen (last audit) does go through date-fns.
 */
function formatSwapDuration(ms: number): string {
  return ms < 10000
    ? `${numbro(Math.round(ms)).format({thousandSeparated: true})} ms`
    : `${(ms / 1000).toFixed(2)} s`
}

/**
 * Independent availability signal from the public mint auditor: what the
 * auditor thinks is wrong, the two headline numbers, and a timeline of the
 * swaps behind them. Rendered only when the auditor knows this mint and
 * answered; see mintAuditService.
 */
function AvailabilityCard(props: {audit: MintAuditSummary}) {
  const {audit} = props
  const textDim = useThemeColor('textDim')

  return (
    <Card
      labelTx="mintInfo_audit_heading"
      ContentComponent={
        <>
          {audit.warnings.length > 0 && <AuditWarningsBox warnings={audit.warnings} />}
          {audit.swap && (
            <View style={$statTileRow}>
              <StatTile
                labelTx="mintInfo_audit_swapSuccess"
                value={`${audit.swap.successRate}%`}
                caption={translate('mintInfo_audit_swapSuccessValue', {
                  ok: audit.swap.okCount,
                  total: audit.swap.totalCount,
                })}
              />
              <StatTile
                labelTx="mintInfo_audit_swapTime"
                value={typeof audit.swap.averageMs !== 'undefined'
                  ? formatSwapDuration(audit.swap.averageMs)
                  : '–'
                }
                captionTx="mintInfo_audit_forSuccessfulSwaps"
              />
            </View>
          )}
          <SwapTimeline history={audit.history} />
          <ListItem
            tx="mintInfo_audit_source"
            subText={audit.updatedAt
              ? translate('mintInfo_audit_lastCheckedParam', {
                  ago: formatRelativeToNow(audit.updatedAt),
                })
              : undefined
            }
            textStyle={[$sizeStyles.xs, {color: textDim}]}
            subTextStyle={[$sizeStyles.xxs, {color: textDim}]}
            topSeparator
            RightComponent={<Icon icon="faUpRightFromSquare" color={textDim} size={14} />}
            onPress={() => Linking.openURL(audit.auditUrl).catch(e =>
              log.warn('[AvailabilityCard]', 'Could not open auditor url', {message: e?.message}),
            )}
            style={$compactListItem}
          />
          {/* Reliability over time is not solvency — say so, as the auditor does. */}
          <Text tx="mintInfo_audit_disclaimer" size="xxs" style={{color: textDim}} />
        </>
      }
    />
  )
}

/** The auditor's judgements, as a bulleted callout. */
function AuditWarningsBox(props: {warnings: MintAuditWarning[]}) {
  const warnColor = useThemeColor('warn')

  return (
    <View style={[$warningsBox, {borderColor: warnColor}]}>
      <Icon
        icon="faTriangleExclamation"
        color={warnColor as string}
        size={18}
        containerStyle={$tightIcon}
      />
      <View style={$warningsText}>
        <Text tx="mintInfo_audit_warningsHeading" size="xs" style={{color: warnColor}} />
        {props.warnings.map(warning => (
          <View key={warning.code} style={$warningBullet}>
            <Text text="•" size="xxs" style={{color: warnColor}} />
            <Text
              text={translate(AUDIT_WARNING_LABELS[warning.code], warning.params)}
              size="xxs"
              style={[$statValueLeft, {color: warnColor}]}
            />
          </View>
        ))}
      </View>
    </View>
  )
}

/** One headline number: caption above, figure, sub-caption. */
function StatTile(props: {labelTx: TxKeyPath, value: string, caption?: string, captionTx?: TxKeyPath}) {
  const textDim = useThemeColor('textDim')
  const tileBg = useThemeColor('background')

  return (
    <View style={[$statTile, {backgroundColor: tileBg}]}>
      <Text tx={props.labelTx} size="xxs" style={{color: textDim}} />
      <Text text={props.value} preset="subheading" />
      <Text tx={props.captionTx} text={props.caption} size="xxs" style={{color: textDim}} />
    </View>
  )
}

// === Swap timeline ===

/**
 * How many bars the timeline is divided into.
 *
 * Fixed rather than derived from the measured width (as cashu.me does): the
 * bars are laid out with `flex: 1`, so the row fills whatever width it gets
 * without a measure pass, and on a phone there is no width range wide enough to
 * make a variable count worth the re-render.
 */
const TIMELINE_BUCKETS = 28

type SwapBucket = {count: number, okCount: number}

/**
 * Bucket the sampled swaps by TIME, newest bucket first.
 *
 * By time, not by index, which is the whole point: a mint that stopped
 * answering leaves EMPTY buckets, and those gaps are the signal. An
 * index-based chart would silently close them up and show an unbroken run of
 * green.
 */
function bucketByTime(history: MintSwapEvent[]): SwapBucket[] {
  const buckets: SwapBucket[] = Array.from({length: TIMELINE_BUCKETS}, () => ({count: 0, okCount: 0}))
  if (history.length === 0) return buckets

  // `history` is oldest-first (see mintAuditService.toHistory).
  const oldest = history[0].at.getTime()
  const newest = history[history.length - 1].at.getTime()
  const span = newest - oldest

  for (const event of history) {
    // 0 = newest → leftmost bucket, 1 = oldest → rightmost.
    const fromNewest = span === 0 ? 0 : (newest - event.at.getTime()) / span
    const index = Math.min(Math.floor(fromNewest * TIMELINE_BUCKETS), TIMELINE_BUCKETS - 1)
    buckets[index].count += 1
    if (event.ok) buckets[index].okCount += 1
  }

  return buckets
}

/** Red at 0% through amber at 50% to green at 100%, as the auditor colours it. */
function successColor(rate: number): string {
  if (rate >= 1) return colors.palette.success200
  if (rate <= 0) return colors.palette.angry500
  const mix = (from: number, to: number, t: number) => Math.round(from + (to - from) * t)
  // angry500 #8F3403 -> accent400 #FFBB50 -> success200 #599D52
  const stops = rate < 0.5
    ? [[0x8f, 0x34, 0x03], [0xff, 0xbb, 0x50], rate * 2] as const
    : [[0xff, 0xbb, 0x50], [0x59, 0x9d, 0x52], (rate - 0.5) * 2] as const
  const [from, to, t] = stops
  return `rgb(${mix(from[0], to[0], t)}, ${mix(from[1], to[1], t)}, ${mix(from[2], to[2], t)})`
}

/**
 * Every sampled swap as one bar per time slice, newest on the left.
 *
 * Renders nothing without history: an axis with no bars would suggest the mint
 * has no record, when in fact the request for it failed.
 */
function SwapTimeline(props: {history: MintSwapEvent[]}) {
  const textDim = useThemeColor('textDim')
  const buckets = useMemo(() => bucketByTime(props.history), [props.history])

  if (props.history.length === 0) return null

  const oldest = props.history[0].at
  const newest = props.history[props.history.length - 1].at
  const middle = new Date((oldest.getTime() + newest.getTime()) / 2)

  return (
    <View style={$timeline}>
      <View style={$timelineBars}>
        {buckets.map((bucket, index) => (
          <View
            key={index}
            style={[
              $timelineBar,
              bucket.count === 0
                // An empty slice is drawn as an outline, not a coloured bar: no
                // swap happened then, which is not the same as a failed one.
                ? {borderWidth: 1, borderColor: textDim as string, opacity: 0.4}
                : {backgroundColor: successColor(bucket.okCount / bucket.count)},
            ]}
          />
        ))}
      </View>
      <View style={$timelineAxis}>
        <Text tx="mintInfo_audit_now" size="xxs" style={{color: textDim}} />
        <Text text={formatDayTime(middle)} size="xxs" style={{color: textDim}} />
        <Text text={formatDayTime(oldest)} size="xxs" style={{color: textDim}} />
      </View>
    </View>
  )
}

// === Payment methods ===

/** Amount without a unit suffix, so a range can carry the unit only once. */
function formatLimitAmount(amount: number, limit: MethodLimit): string {
  if (limit.mintUnit) {
    try {
      return formatCurrency(amount, getCurrency(limit.mintUnit).code)
    } catch {
      // unit the wallet has no currency data for — fall through to the raw value
    }
  }
  return String(amount)
}

function unitLabel(limit: MethodLimit): string {
  if (limit.mintUnit) {
    try {
      return getCurrency(limit.mintUnit).symbol
    } catch {
      // fall through
    }
  }
  return limit.unit.toUpperCase()
}

/** `0 – 1,000,000 SAT`, or a one-sided / absent bound. */
function limitText(limit: MethodLimit): string {
  const unit = unitLabel(limit)
  const hasMin = typeof limit.min !== 'undefined'
  const hasMax = typeof limit.max !== 'undefined'

  if (hasMin && hasMax) {
    return `${formatLimitAmount(limit.min as number, limit)} – ${formatLimitAmount(limit.max as number, limit)} ${unit}`
  }
  if (hasMax) {
    return translate('mintInfo_limitMax', {amount: `${formatLimitAmount(limit.max as number, limit)} ${unit}`})
  }
  if (hasMin) {
    return translate('mintInfo_limitMin', {amount: `${formatLimitAmount(limit.min as number, limit)} ${unit}`})
  }
  return translate('mintInfo_limitNone')
}

/**
 * The rails the mint settles on, each with its deposit and withdrawal limits.
 *
 * Deposit and withdrawal are shown SEPARATELY per rail because they are
 * independent: a mint commonly accepts onchain deposits without paying onchain
 * out, and the limits differ even when both directions exist.
 */
function PaymentMethodsCard(props: {methods: PaymentMethodSummary[]}) {
  const textDim = useThemeColor('textDim')

  return (
    <Card
      labelTx="mintInfo_paymentMethodsHeading"
      ContentComponent={
        <>
          {props.methods.map((method, index) => (
            <View key={method.method} style={index > 0 ? $methodBlockSeparated : undefined}>
              <View style={$methodHeaderRow}>
                <Icon icon={method.icon} color={textDim} size={16} containerStyle={$tightIcon} />
                <Text
                  tx={method.labelTx}
                  text={method.labelTx ? undefined : method.method}
                  style={$methodName}
                />
                {typeof method.confirmations !== 'undefined' && (
                  <Text
                    text={translate('mintInfo_confirmationsParam', {count: method.confirmations})}
                    size="xxs"
                    style={{color: textDim}}
                  />
                )}
              </View>
              <DirectionRows direction="mint" limits={method.mint} />
              <DirectionRows direction="melt" limits={method.melt} />
            </View>
          ))}
        </>
      }
    />
  )
}

function DirectionRows(props: {direction: 'mint' | 'melt', limits: MethodLimit[]}) {
  const textDim = useThemeColor('textDim')
  const isMint = props.direction === 'mint'
  const label = translate(isMint ? 'mintInfo_depositMint' : 'mintInfo_withdrawMelt')
  const icon: IconTypes = isMint ? 'faCircleArrowDown' : 'faCircleArrowUp'

  if (props.limits.length === 0) {
    return (
      <View style={$limitRow}>
        <Icon icon={icon} color={textDim} size={14} containerStyle={$tightIcon} />
        <Text text={label} size="xs" style={{color: textDim}} />
        <Text tx="mintInfo_notSupported" size="xs" style={[$statValue, {color: textDim}]} />
      </View>
    )
  }

  // A rail may settle in several units; name the unit on the label only then,
  // so the common single-unit mint stays uncluttered.
  const isMultiUnit = props.limits.length > 1

  return (
    <>
      {props.limits.map(limit => (
        <View key={`${props.direction}-${limit.unit}`} style={$limitRow}>
          <Icon icon={icon} color={colors.palette.success200} size={14} containerStyle={$tightIcon} />
          <Text
            text={isMultiUnit ? `${label} · ${unitLabel(limit)}` : label}
            size="xs"
            style={{color: textDim}}
          />
          <Text text={limitText(limit)} size="xs" style={$statValue} />
        </View>
      ))}
    </>
  )
}

// === Capabilities ===

/**
 * What the mint can do, in plain language. Supported capabilities carry a line
 * explaining what it buys the user; unsupported ones are listed dimmed without
 * the explanation, so the card stays scannable.
 *
 * The raw NUT numbers are still here, one tap away, for anyone who wants them.
 */
function CapabilitiesCard(props: {capabilities: MintCapability[], nuts: NutSupport[]}) {
  const [isTechnicalVisible, setIsTechnicalVisible] = useState(false)
  const textDim = useThemeColor('textDim')

  const toggleTechnical = () => {
    LayoutAnimation.easeInEaseOut()
    setIsTechnicalVisible(!isTechnicalVisible)
  }

  // Caveats (`warning`) are shown only when present — see MintCapability.
  const supported = props.capabilities.filter(c => c.supported && !c.warning)
  const caveats = props.capabilities.filter(c => c.supported && c.warning)
  const unsupported = props.capabilities.filter(c => !c.supported && !c.warning)

  return (
    <Card
      labelTx="mintInfo_capabilitiesHeading"
      ContentComponent={
        <>
          {supported.length === 0 && caveats.length === 0 && (
            <Text
              style={{fontStyle: 'italic'}}
              size="xs"
              tx="mintInfo_capabilitiesUnknown"
            />
          )}
          {[...supported, ...caveats].map(capability => (
            <View key={capability.key} style={$capabilityRow}>
              <Icon
                icon={capability.icon}
                color={capability.warning ? colors.palette.accent400 : colors.palette.success200}
                size={16}
                containerStyle={$capabilityIcon}
              />
              <View style={$capabilityText}>
                <Text tx={capability.labelTx} size="xs" />
                <Text tx={capability.descriptionTx} size="xxs" style={{color: textDim}} />
              </View>
            </View>
          ))}
          {unsupported.length > 0 && (
            <View style={$unsupportedWrapper}>
              {unsupported.map(capability => (
                <View key={capability.key} style={$capabilityRow}>
                  <Icon icon="faXmark" color={textDim} size={16} containerStyle={$capabilityIcon} />
                  <Text tx={capability.labelTx} size="xs" style={{color: textDim}} />
                </View>
              ))}
            </View>
          )}
          <ListItem
            tx="mintInfo_technicalDetails"
            textStyle={[$sizeStyles.xs, {color: textDim}]}
            topSeparator
            RightComponent={
              <Icon icon={isTechnicalVisible ? 'faChevronUp' : 'faChevronDown'} color={textDim} size={14} />
            }
            onPress={toggleTechnical}
            style={$compactListItem}
          />
          {isTechnicalVisible && (
            <>
              {props.nuts.length === 0 ? (
                <Text
                  style={{fontStyle: 'italic'}}
                  size="xxs"
                  text={translate('mintInfo_emptyValueParam', {param: translate('mintInfo_nutsHeading')})}
                />
              ) : (
                props.nuts.map(nut => (
                  <View key={nut.nut} style={$nutRow}>
                    <Text text={nut.code} size="xxs" style={[$nutCode, {color: textDim}]} />
                    <Text
                      text={nut.title ?? ''}
                      size="xxs"
                      style={[$statValueLeft, !nut.supported && {color: textDim}]}
                    />
                    <Icon
                      icon={nut.supported ? 'faCheck' : 'faXmark'}
                      color={nut.supported ? colors.palette.success200 : textDim}
                      size={12}
                      containerStyle={$tightIcon}
                    />
                  </View>
                ))
              )}
            </>
          )}
        </>
      }
    />
  )
}

// === Contacts and details ===

function ContactsCard(props: {contacts: MintContact[], onCopy: (value: string) => void}) {
  const textDim = useThemeColor('textDim')

  return (
    <Card
      labelTx="mintInfo_contactsHeading"
      ContentComponent={
        <>
          {props.contacts.map(({method, info}, index) => (
            <ListItem
              style={$compactListItem}
              key={`${method}-${index}`}
              text={method}
              textStyle={$sizeStyles.xs}
              LeftComponent={
                <Icon icon={contactIconMap[method] ?? 'faAddressBook'} color={textDim} />
              }
              RightComponent={
                <View style={{width: spacing.screenWidth * 0.6}}>
                  <Text text={info} size="xs" />
                </View>
              }
              topSeparator={index !== 0}
              onLongPress={() => props.onCopy(info)}
            />
          ))}
        </>
      }
    />
  )
}

/** `023cf092…3d489554` — long hex is unreadable in full and copyable anyway. */
function truncateMiddle(value: string, lead = 8, tail = 8): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`
}

/**
 * The remaining identity/version facts, as an explicit list.
 *
 * This used to iterate over every key of the info response minus a hidden-key
 * set, which meant any new NUT-06 field appeared as a raw JSON blob with its
 * snake_case name as the label. The full response is still one tap away under
 * "On-device information".
 */
function DetailsCard(props: {info: MintInfo, onCopy: (value: string) => void}) {
  const textDim = useThemeColor('textDim')

  const version = asNonEmptyString(props.info.version)
  const pubkey = asNonEmptyString(props.info.pubkey)
  const tosUrl = asNonEmptyString(props.info.tos_url)
  const urls = Array.isArray(props.info.urls)
    ? props.info.urls.map(asNonEmptyString).filter(Boolean).join('\n')
    : undefined

  const rows: Array<{key: string, labelTx: TxKeyPath, icon: IconTypes, display: string, copy: string, onPress?: () => void}> = []

  if (version) {
    rows.push({key: 'version', labelTx: 'mintInfo_detail_version', icon: 'faInfoCircle', display: version, copy: version})
  }
  if (pubkey) {
    rows.push({key: 'pubkey', labelTx: 'mintInfo_detail_pubkey', icon: 'faKey', display: truncateMiddle(pubkey), copy: pubkey})
  }
  if (urls) {
    rows.push({key: 'urls', labelTx: 'mintInfo_detail_urls', icon: 'faGlobe', display: urls, copy: urls})
  }
  if (tosUrl) {
    rows.push({
      key: 'tos',
      labelTx: 'mintInfo_detail_tos',
      icon: 'faShieldHalved',
      display: tosUrl,
      copy: tosUrl,
      onPress: () => Linking.openURL(tosUrl).catch(e =>
        log.warn('[DetailsCard]', 'Could not open tos url', {message: e?.message}),
      ),
    })
  }

  if (rows.length === 0) return null

  return (
    <Card
      labelTx="mintInfo_keyValueInfoCardHeading"
      ContentComponent={
        <>
          {rows.map((row, index) => (
            <ListItem
              key={row.key}
              style={$compactListItem}
              tx={row.labelTx}
              textStyle={$sizeStyles.xs}
              LeftComponent={<Icon icon={row.icon} color={textDim} />}
              RightComponent={
                <View style={{width: spacing.screenWidth * 0.6}}>
                  <Text text={row.display} size="xs" />
                </View>
              }
              topSeparator={index !== 0}
              onPress={row.onPress}
              onLongPress={() => props.onCopy(row.copy)}
            />
          ))}
        </>
      }
    />
  )
}

// === Styles ===

const $screen: ViewStyle = {}

const $tightIcon: ViewStyle = {paddingHorizontal: 0}

const $statValue: TextStyle = {
  flex: 1,
  textAlign: 'right',
}

const $statValueLeft: TextStyle = {
  flex: 1,
}

const $warningsBox: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: spacing.small,
  borderWidth: 1,
  borderRadius: spacing.small,
  padding: spacing.small,
  marginBottom: spacing.small,
}

const $warningsText: ViewStyle = {
  flex: 1,
  gap: spacing.micro,
}

const $warningBullet: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: spacing.extraSmall,
}

const $statTileRow: ViewStyle = {
  flexDirection: 'row',
  gap: spacing.small,
  marginBottom: spacing.small,
}

const $statTile: ViewStyle = {
  flex: 1,
  borderRadius: spacing.small,
  padding: spacing.small,
  gap: spacing.micro,
}

const $timeline: ViewStyle = {
  gap: spacing.extraSmall,
  marginBottom: spacing.extraSmall,
}

const $timelineBars: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'stretch',
  gap: 2,
  height: verticalScale(44),
}

const $timelineBar: ViewStyle = {
  flex: 1,
  borderRadius: 2,
}

const $timelineAxis: ViewStyle = {
  flexDirection: 'row',
  justifyContent: 'space-between',
}

const $methodBlockSeparated: ViewStyle = {
  marginTop: spacing.small,
  paddingTop: spacing.small,
  borderTopWidth: 1,
  borderTopColor: colors.palette.neutral500 + '40',
}

const $methodHeaderRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.extraSmall,
  paddingVertical: spacing.tiny,
}

const $methodName: TextStyle = {
  flex: 1,
}

const $limitRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.extraSmall,
  paddingVertical: spacing.micro,
  paddingLeft: spacing.small,
}

const $capabilityRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: spacing.extraSmall,
  paddingVertical: spacing.tiny,
}

const $capabilityIcon: ViewStyle = {
  paddingHorizontal: 0,
  width: spacing.medium,
  alignItems: 'center',
}

const $capabilityText: ViewStyle = {
  flex: 1,
}

const $unsupportedWrapper: ViewStyle = {
  marginTop: spacing.extraSmall,
}

const $nutRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.extraSmall,
  paddingVertical: spacing.micro,
}

const $nutCode: TextStyle = {
  width: spacing.huge * 1.2,
}

const $compactListItem: ViewStyle = {
  columnGap: spacing.tiny,
  alignItems: 'center',
}

const $headerContainer: ViewStyle = {
  alignItems: 'center',
  height: HEADER_HEIGHT,
}

const $headerContent: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'space-around',
  paddingBottom: spacing.huge,
}

const $contentContainer: ViewStyle = {
  marginTop: -spacing.extraLarge * 1.5,
  rowGap: spacing.small,
  padding: spacing.extraSmall,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}
