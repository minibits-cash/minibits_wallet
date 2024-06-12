import React, { FC, useEffect, useMemo, useState } from 'react'
import { GetInfoResponse, SwapMethod } from '@cashu/cashu-ts'
import { isObj } from '@cashu/cashu-ts/src/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { observer } from 'mobx-react-lite'
import { getSnapshot } from 'mobx-state-tree'
import { DimensionValue, LayoutAnimation, Platform, TextStyle, UIManager, View, ViewStyle } from 'react-native'
import JSONTree from 'react-native-json-tree'
import {
  $sizeStyles,
  Button,
  Card,
  ErrorModal,
  Icon,
  IconTypes,
  InfoModal,
  ListItem,
  Loading,
  MintIcon,
  Screen,
  Text,
} from '../components'
import { AvatarHeader } from '../components/AvatarHeader'
import { CollapsibleText } from '../components/CollapsibleText'
import { translate } from '../i18n'
import { useStores } from '../models'
import { Mint, MintStatus } from '../models/Mint'
import { SettingsStackScreenProps } from '../navigation'
import { MintClient, log } from '../services'
import { colors, spacing, typography, useThemeColor } from '../theme'
import useColorScheme from '../theme/useThemeColor'
import AppError, { Err } from '../utils/AppError'
import { useHeader } from '../utils/useHeader'
import { CurrencySign } from './Wallet/CurrencySign'
import { SvgXml } from 'react-native-svg'


if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

interface DetailedNutInfo {
  methods: Array<SwapMethod>;
  disabled: boolean;
}

interface MethodLimit {
  min?: number,
  max?: number,
}

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

function MOTDCard(props: {info: GetInfoResponse}) {
  const textDim = useThemeColor('textDim')
  return (
    <Card
      RightComponent={
        <View style={{justifyContent: 'center'}}>
          <Icon icon="faCircleExclamation" color={textDim} size={20} />
        </View>
      }
      headingTx="mintInfo.motd"
      HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
      ContentComponent={
        <Text style={{fontStyle: 'italic'}} text={props.info.motd} />
      }
    />
  )
}

function MintLimitsCard(props: { info: GetInfoResponse, limitInfo: ReturnType<typeof getMintLimits> }) {
  if (props.limitInfo.mintSats === false && props.limitInfo.mintSats === false) return;
  log.trace('MintLimtsCard', props.limitInfo)

  const limitText = (m: MethodLimit) => (
    typeof m.min !== 'undefined' && typeof m.max !== 'undefined' ? `${m.min} – ${m.max}`
    : typeof m.min !== 'undefined' && typeof m.max === 'undefined' ? `min: ${m.min}`
    : typeof m.max !== 'undefined' && typeof m.min === 'undefined' ? `max: ${m.max}`
    : void 0
  )

  const LimitItem = (props: { m: MethodLimit, type: 'mint' | 'melt' }) => (<View style={$limitItem}>
    <Icon 
      icon={props.type === 'mint' ? 'faCircleArrowUp' : 'faCircleArrowDown'} 
      color={colors.palette.success200} 
      size={16} 
      containerStyle={$nutIcon}
    />
    <Text text={limitText(props.m)} />
  </View>)

  const textDim = useThemeColor('textDim')

  return (<Card
    headingTx="mintInfo.mintMeltHeading"
    HeadingTextProps={{ style: [$sizeStyles.sm, { color: textDim }] }}
    ContentComponent={<>
      <View style={$limitItemWrapper}>
        <Text text="Deposit (Mint)" style={{ width: '50%' }} size='xs' />
        <Text text="Withdraw (Melt)" style={{ width: '50%' }} size='xs' />
      </View>
      <View style={$limitItemWrapper}>
        <LimitItem m={props.limitInfo.mintSats as MethodLimit} type="mint" />
        <LimitItem m={props.limitInfo.meltSats as MethodLimit} type="melt" />
      </View>
    </>}
  />)
}

function DescriptionCard(props: {info: GetInfoResponse}) {
  const textDim = useThemeColor('textDim')
  return (<Card
    headingTx="mintInfo.descriptionHeading"
    HeadingTextProps={{ style: [$sizeStyles.sm, { color: textDim }] }}
    ContentComponent={
      props.info && props.info.description ? (
        <CollapsibleText
          collapsed={true}
          summary={props.info.description}
          text={props.info?.description_long && props.info.description !== props.info.description_long 
            ? props.info.description + '\n' + props.info.description_long 
            : ''
          }
        />
      ) : (
        <Text
          style={{fontStyle: 'italic'}}
          text={translate('mintInfo.emptyValueParam', {
            param: translate('mintInfo.descriptionHeading'),
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
  const textDim = useThemeColor('textDim')
  const supportedNutsDetailed: [string, DetailedNutInfo][] = []
  const nutsSimple: [string, boolean][] = []

  // detailed nuts are separated from simple ones if we want to show more info abt them in the future
  for (const [nut, info] of Object.entries(props.info.nuts)) {
    if ('disabled' in info && info.disabled === false) { // detailed
      supportedNutsDetailed.push([nut, info])
    } else if ('supported' in info) { // simple
      nutsSimple.push([nut, info.supported])
    } else {
      nutsSimple.push([nut, false]) // fallback or detailed but disabled nut
    }
  }

  const smallNutCols = 4
  return (
    <Card
      headingTx="mintInfo.nutsHeading"
      HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
      ContentComponent={
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
      }
    />
  )
}

function ContactCard(props: { info: GetInfoResponse, popupMessage: (msg: string) => void }) {
  const textDim = useThemeColor('textDim')

  let contacts = props.info.contact.filter(([k, v]) => k.trim() !== '') // filter out empty contacts
  return (
    <Card
      headingTx="mintInfo.contactsHeading"
      HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
      ContentComponent={
        contacts.length === 0 ? (
          <Text
            style={{fontStyle: 'italic'}}
            text={translate('mintInfo.emptyValueParam', { param: translate('mintInfo.contactsHeading') })}
          />
        ) : (
          <>
            {contacts.map(([platform, user], index) => (
              <ListItem
                style={$contactListItem}
                key={platform}
                text={platform}
                textStyle={$sizeStyles.xs}
                LeftComponent={<Icon icon={platform in contactIconMap ? contactIconMap[platform] : 'faAddressBook'} color={textDim}/>}
                RightComponent={<View style={{ width: spacing.screenWidth * 0.6 }}><Text text={user}/></View>}
                topSeparator={index !== 0}
                onLongPress={() => {
                  Clipboard.setString(user)
                  props.popupMessage(translate('common.copySuccessParam', { param: user }))
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
const detailsHiddenKeys = new Set(['name', 'motd', 'description', 'description_long', 'nuts', 'contact'])

/** key-value pairs of details about the mint */
function MintInfoDetails(props: { info: GetInfoResponse, popupMessage: (msg: string) => void }) {
  const iconColor = useThemeColor('textDim')

  const items: React.JSX.Element[] = Object.entries(props.info)
    .filter(([key, value]) => !(detailsHiddenKeys.has(key)))
    .map(([key, value], index) => {
      const missingComponent = <Text
        style={{fontStyle: 'italic'}}
        size="xs"
        key={key}
        text={translate('mintInfo.emptyValueParam', { param: key })}
      />
      
      let stringValue = isObj(value) ? JSON.stringify(value) : value.toString()
      let valueComponent = stringValue.trim() !== ''
        ? <Text size='xs' text={stringValue} />
        : missingComponent;
      
      const handleLongPress = () => {
        if (stringValue.trim() === '') return;
        Clipboard.setString(stringValue)
        props.popupMessage(translate('common.copySuccessParam', { param: stringValue }))
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

function getMintLimits(info: GetInfoResponse) {
  // later this can be adjusted to show USD/other units as well. for now only shows limits if they are in sats
  let mintSats: false | MethodLimit = false
  let meltSats: false | MethodLimit = false
  console.log('runs')
  for (const method of info.nuts['4'].methods) {
    if ((typeof method.min_amount !== 'undefined' || typeof method.max_amount !== 'undefined') && method.unit === 'sat') {
      mintSats = { min: method.min_amount, max: method.max_amount }
      break;
    }
  }

  for (const method of info.nuts['5'].methods) {
    if ((typeof method.min_amount !== 'undefined' || typeof method.max_amount !== 'undefined') && method.unit === 'sat') {
      meltSats = { min: method.min_amount, max: method.max_amount }
      break;
    }
  }
  return {
    mintSats,
    meltSats,
    any: mintSats || meltSats,
    both: mintSats && meltSats,
  }
}

export const MintInfoScreen: FC<SettingsStackScreenProps<'MintInfo'>> = observer(function MintInfoScreen(_props) {
  const { navigation, route } = _props
  useHeader({
    leftIcon: 'faArrowLeft',
    onLeftPress: () => {
      navigation.goBack()
    },
  })

  const { mintsStore } = useStores()

  const [isLoading, setIsLoading] = useState(false)
  const [mintInfo, setMintInfo] = useState<GetInfoResponse | undefined>()
  const [mint, setMint] = useState<Mint>()
  const [isLocalInfoVisible, setIsLocalInfoVisible] = useState<boolean>(false)
  
  const [error, setError] = useState<AppError | undefined>()
  const [info, setInfo] = useState('')

  useEffect(() => {
    const getInfo = async () => {
      try {
        if (!route.params || !route.params.mintUrl) {
          throw new AppError(Err.VALIDATION_ERROR, 'Missing mintUrl')
        }

        log.trace('useEffect', { mintUrl: route.params.mintUrl })

        setIsLoading(true)
        const mint = mintsStore.findByUrl(route.params.mintUrl)

        if (mint) {
          const info: GetInfoResponse = await MintClient.getMintInfo(mint.mintUrl)
          mint.setStatus(MintStatus.ONLINE)
          if(info.name && info.name !== mint.shortname) {
            await mint.setShortname()
          }
          setMintInfo(info)
          setMint(mint)
        } else {
          throw new AppError(Err.VALIDATION_ERROR, 'Could not find mint', { mintUrl: route.params.mintUrl })
        }

        setIsLoading(false)
      } catch (e: any) {
        if (route.params.mintUrl) {
          const mint = mintsStore.findByUrl(route.params.mintUrl)
          if (mint) {
            mint.setStatus(MintStatus.OFFLINE)
          }
        }
        handleError(e)
      }
    }
    getInfo()
  }, [])

  const toggleLocalInfo = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setIsLocalInfoVisible(!isLocalInfoVisible)
  }

  const handleError = function (e: AppError): void {
    setIsLoading(false)
    setError(e)
  }

  /** memoized mint limit info */
  const mintLimitInfo = useMemo(() => {
    if (typeof mintInfo === 'undefined') return;
    return getMintLimits(mintInfo)
  }, [mintInfo])

  const colorScheme = useColorScheme()
  const textDim = useThemeColor('textDim')
  return (
    <Screen style={$screen} preset="scroll">
      <AvatarHeader
        encircle={false}        
        fallbackIconComponent={
          <SvgXml 
              width={60} 
              height={60} 
              xml={MintIcon}
              fill='white'
          />
        }
        headerHeightModifier={0.26}
        heading={mintInfo?.name ?? translate('mintInfo.loadingNamePlaceholder')}
        text={route.params.mintUrl}>
        {mint?.units ? (
          <View style={{flexDirection: 'row'}}>
            {mint.units.map(unit => (
              <CurrencySign
                textStyle={{fontSize: 16}}
                containerStyle={{paddingLeft: 0, marginRight: spacing.small}}
                key={unit}
                mintUnit={unit}
              />
            ))}
          </View>
        ) : (
          <Text
            style={{fontStyle: 'italic'}}
            tx="mintInfo.loadingUnitsPlaceholder"
          />
        )}
      </AvatarHeader>
      <View style={$contentContainer}>
        {mintInfo?.motd && <MOTDCard info={mintInfo} />}
        {mintInfo && mintLimitInfo?.any && <MintLimitsCard info={mintInfo} limitInfo={mintLimitInfo}/>}
        {mintInfo && <>
          <DescriptionCard info={mintInfo} />
          <ContactCard info={mintInfo} popupMessage={setInfo} />
        </>}
        <Card
          headingTx={mintInfo && "mintInfo.keyValueInfoCardHeading"}
          HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
          ContentComponent={
            <>
              {mintInfo && <MintInfoDetails info={mintInfo} popupMessage={setInfo} />}
              {isLoading && (
                <Loading
                  style={{backgroundColor: 'transparent'}}
                  statusMessage={translate('loadingPublicInfo')}
                />
              )}
            </>
          }
        />
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
                      text={isLocalInfoVisible ? translate("common.hide") : translate("common.show")}
                      preset="secondary"
                    />
                  </View>
                }
              />
              {isLocalInfoVisible && (
                <JSONTree
                  hideRoot
                  data={getSnapshot(
                    mintsStore.findByUrl(route.params?.mintUrl) as Mint,
                  ) as any}
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
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </View>
    </Screen>
  )
})

const $screen: ViewStyle = { flex: 1, }
const $nutIcon: ViewStyle = { paddingHorizontal: 0 }

const $limitItem: ViewStyle = {
  alignItems: 'center',
  flexDirection: 'row',
  width: '50%',
  gap: spacing.extraSmall,
}
const $limitItemWrapper: ViewStyle = {
  flexDirection: 'row',
  gap: spacing.extraSmall,
}

const $listItem: ViewStyle = {
  columnGap: spacing.micro,
  alignItems: 'center',
}

const $contentContainer: TextStyle = {
  rowGap: spacing.small,
  flex: 1,
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
