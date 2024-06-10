import React, { FC, useEffect, useState } from 'react'
import { GetInfoResponse, SwapMethod } from '@cashu/cashu-ts'
import { isObj } from '@cashu/cashu-ts/src/utils'
import Clipboard from '@react-native-clipboard/clipboard'
import { observer } from 'mobx-react-lite'
import { getSnapshot } from 'mobx-state-tree'
import { DimensionValue, LayoutAnimation, Platform, TextStyle, UIManager, View, ViewStyle } from 'react-native'
import JSONTree from 'react-native-json-tree'
import {
  $sizeStyles,
  BottomModal,
  Button,
  Card,
  ErrorModal,
  Icon,
  IconTypes,
  InfoModal,
  ListItem,
  Loading,
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
import { MintUnit, MintUnits } from '../services/wallet/currency'


if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

const iconMap: Partial<Record<keyof GetInfoResponse, IconTypes>> = {
  'name': 'faTag',
  'pubkey': 'faKey',
  'version': 'faInfoCircle',
  'contact': 'faAddressCard'
}
const prettyNamesMap: Partial<Record<keyof GetInfoResponse, string>> = {}

function MOTDCard(props: {info: GetInfoResponse}) {
  const textDim = useThemeColor('textDim')
  return (<Card
    RightComponent={<View style={{ justifyContent: 'center' }}>
      <Icon icon="faCircleExclamation" color={textDim} size={20} />
    </View>}
    headingTx="mintInfo.motd"
    HeadingTextProps={{ style: [$sizeStyles.sm, {color: textDim}] }}
    ContentComponent={<Text style={{ fontStyle: 'italic' }} text={props.info.motd} />}
  />)
}

function DescriptionCard(props: {info: GetInfoResponse}) {
  const textDim = useThemeColor('textDim')
  return (<Card
    headingTx="mintInfo.descriptionHeading"
    HeadingTextProps={{ style: [$sizeStyles.sm, { color: textDim }] }}
    style={$card}
    ContentComponent={
      props.info && props.info.description ? (
        <CollapsibleText
          collapsed={true}
          summary={props.info.description}
          text={props.info?.description_long ?? ''}
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

interface DetailedNutInfo {
  methods: Array<SwapMethod>;
  disabled: boolean;
}

function NutItem(props: {
  enabled: boolean,
  nutNumber: string,
  display: 'row' | 'small',
  width?: DimensionValue
  nutInfo?: DetailedNutInfo
}) {
  const textDim = useThemeColor('textDim')
  const $nutItem: ViewStyle = {
    flexDirection: 'row',
    width: props.display === 'row' ? '100%' : (props?.width ?? 'auto'),
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.extraSmall
  }
  const $nutIcon: ViewStyle = { paddingHorizontal: 0 }

  return (
    <View style={$nutItem}>
      <Icon
        icon={props.enabled ? 'faCheckCircle' : 'faXmark'}
        color={props.enabled ? colors.palette.success200 : colors.palette.angry500}
        size={16}
        containerStyle={$nutIcon}
      />
      <Text size='xs'>NUT-{props.nutNumber}</Text>
      {props.nutInfo && props.nutInfo.methods.map(m => (<>
        <Text text={m.method} />
        {/* <Icon icon='faBolt' color={textDim} size={16} containerStyle={$nutIcon} /> */}
        {m.min_amount && m.max_amount 
          ? <Text text={`${m.min_amount} – ${m.max_amount}`} />
          : m.min_amount && !m.max_amount ? <Text text={`min: ${m.min_amount}`} />
          : m.max_amount && !m.min_amount ? <Text text={`max: ${m.max_amount}`} />
          : void 0
        }
        {MintUnits.includes(m.unit as MintUnit) ? (
          <CurrencySign
            textStyle={{fontSize: 16}}
            containerStyle={$nutIcon}
            mintUnit={m.unit as MintUnit}
          />
        ) : (<>
          <Icon icon='faCircleQuestion' color={textDim} size={16} containerStyle={$nutIcon} />
          <Text text={m.unit.toUpperCase()} style={{fontFamily: typography.primary?.light}} />
        </>)}
      </>))}
    </View>
  )
}

function NutsCard(props: {info: GetInfoResponse}) {
  const textDim = useThemeColor('textDim')
  const supportedNutsDetailed: [string, DetailedNutInfo][] = []
  const nutsSimple: [string, boolean][] = []

  for (const [nut, info] of Object.entries(props.info.nuts)) {
    if ('disabled' in info && info.disabled === false) { // detailed
      supportedNutsDetailed.push([nut, info])
    } else if ('supported' in info) { // simple
      nutsSimple.push([nut, info.supported])
    } else {
      nutsSimple.push([nut, false]) // fallback or detailed, but disabled nut
    }
  }

  const smallNutCols = 4
  return (<Card
    heading="Nuts"
    HeadingTextProps={{style: [$sizeStyles.sm, {color: textDim}]}}
    ContentComponent={
      <>
        {supportedNutsDetailed.map(([nut, info]) => (
          <NutItem
            nutNumber={nut}
            enabled={true}
            display="row"
            key={nut}
            nutInfo={info}
          />
        ))}
        <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
          {nutsSimple.map(([nut, enabled]) => (
            <NutItem
              nutNumber={nut}
              enabled={enabled}
              key={nut}
              display="small"
              width={`${Math.round(100 / smallNutCols)}%`}
            />
          ))}
        </View>
      </>
    }
  />)
}

/** don't render these because they're rendered in separate components */
const detailsHiddenKeys = new Set(['name', 'motd', 'description', 'description_long', 'nuts'])

/** key-value pairs of details about the mint */
function MintInfoDetails(props: { info: GetInfoResponse, popupMessage: (msg: string) => void }) {
  const iconColor = useThemeColor('textDim')
  const contactPlatformColor = useThemeColor('textDim')

  const items: React.JSX.Element[] = Object.entries(props.info)
    .filter(([key, value]) => !(detailsHiddenKeys.has(key)))
    .map(([key, value], index) => {
      const missingComponent = <Text
        style={{fontStyle: 'italic'}}
        size="xs"
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
      
      if (key === 'contact') {
        let contacts = (value as [string, string][])
          .filter(([k, v]) => k.trim() !== '') // filter out empty contacts
        valueComponent = (contacts.length === 0) ? missingComponent : (<>
          {contacts.map(([platform, user]) => (
              <View style={$contactListItem}>
                <Text
                  size="xs"
                  text={`${platform}:`}
                  style={{ color: contactPlatformColor }}
                />
                <Text size="xs" text={user} />
              </View>
            ))}
        </>)
      }

      // @ts-ignore no-implicit-any
      const leftComponent = key in iconMap ? <Icon icon={iconMap[key]} color={iconColor}/> : void 0
      // @ts-ignore no-implicit-any
      const itemText = prettyNamesMap?.[key] ?? key

      return <ListItem 
        LeftComponent={leftComponent}
        text={itemText}
        textStyle={$sizeStyles.xs}
        RightComponent={<View style={{ width: spacing.screenWidth * 0.6 }}>{valueComponent}</View>}
        topSeparator={index === 0 ? false : true}
        key={key}
        onLongPress={handleLongPress}
        style={$listItem}
      />
    })
  return <>{items}</>
}

export const MintInfoScreen: FC<SettingsStackScreenProps<'MintInfo'>> = observer(function MintInfoScreen(_props) {
  const { navigation, route } = _props
  useHeader({
    leftIcon: 'faArrowLeft',
    onLeftPress: () => {
      /*const routes = navigation.getState()?.routes
      let prevRouteName: string = ''

      if(routes.length >= 2) {
          prevRouteName = routes[routes.length - 2].name
      }            

      log.trace('prevRouteName', {prevRouteName, routes})

      if(prevRouteName === 'Mints') {
          navigation.navigate('Mints', {})
      } else {                
          navigation.dispatch(
              StackActions.replace('Settings')                    
          )
          navigation.navigate('WalletNavigator', {screen: 'Wallet'})
      } */
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

  const colorScheme = useColorScheme()
  const textDim = useThemeColor('textDim')
  return (
    <Screen style={$screen} preset="scroll">
      <AvatarHeader
        encircle={true}
        fallbackIcon="faBank"
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
        {mintInfo && <>
          <DescriptionCard info={mintInfo} />
          <NutsCard info={mintInfo} />
        </>}
        <Card
          ContentComponent={
            <>
              {mintInfo && (
                <MintInfoDetails info={mintInfo} popupMessage={setInfo} />
              )}
              {isLoading && (
                <Loading
                  style={{backgroundColor: 'transparent'}}
                  statusMessage={translate('loadingPublicInfo')}
                />
              )}
            </>
          }
          style={$card}
        />
        <Card
          style={$card}
          ContentComponent={
            <>
              <ListItem
                tx="onDeviceInfo"
                RightComponent={
                  <View style={$rightContainer}>
                    <Button
                      onPress={toggleLocalInfo}
                      text={isLocalInfoVisible ? 'Hide' : 'Show'}
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
                  )}
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


const $screen: ViewStyle = {
  flex: 1,
}

const $listItem: ViewStyle = {
  columnGap: spacing.micro,
  alignItems: 'center',
}
const $contactListItem: ViewStyle = { 
  flexDirection: 'row',
  columnGap: spacing.tiny
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.1,
}

const $contentContainer: TextStyle = {
  rowGap: spacing.small,
  flex: 1,
  padding: spacing.extraSmall,
  // alignItems: 'center',
}

const $card: ViewStyle = {
  marginBottom: 0,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
  alignItems: 'center',
  marginTop: spacing.large,
}
