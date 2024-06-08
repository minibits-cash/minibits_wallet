import { observer } from 'mobx-react-lite'
import React, { FC, useEffect, useState } from 'react'
import { LayoutAnimation, Platform, TextStyle, UIManager, View, ViewStyle } from 'react-native'
import { colors, spacing, useThemeColor } from '../theme'
import { SettingsStackScreenProps } from '../navigation'
import {
  Icon,
  ListItem,
  Screen,
  Text,
  Card,
  Loading,
  ErrorModal,
  InfoModal,
  BottomModal,
  Button,
  IconTypes,
  $sizeStyles,
} from '../components'
import { useHeader } from '../utils/useHeader'
import { useStores } from '../models'
import { translate } from '../i18n'
import AppError, { Err } from '../utils/AppError'
import { log, MintClient } from '../services'
import { GetInfoResponse } from '@cashu/cashu-ts'
import { delay } from '../utils/utils'
import JSONTree from 'react-native-json-tree'
import { getSnapshot } from 'mobx-state-tree'
import { Mint, MintStatus } from '../models/Mint'
import useColorScheme from '../theme/useThemeColor'
import { CommonActions } from '@react-navigation/native'
import { StackActions } from '@react-navigation/native';
import { isObj } from '@cashu/cashu-ts/src/utils'
import { ProfileHeader } from '../components/ProfileHeader'
import { AvatarHeader } from '../components/AvatarHeader'
import { CollapsibleText } from '../components/CollapsibleText'
import { CurrencySign } from './Wallet/CurrencySign'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

const iconMap: Partial<Record<keyof GetInfoResponse, IconTypes>> = {
  'name': 'faTag',
  'pubkey': 'faKey',
  'version': 'faInfoCircle',
  'contact': 'faAddressCard',
  'motd': 'faPaperPlane'
}
const prettyNamesMap: Partial<Record<keyof GetInfoResponse, string>> = {
  'description': "desc",
  'description_long': 'full desc'
}

function MintInfoDetails(props: { info: GetInfoResponse }) {
  const iconColor = useThemeColor('textDim')
  const contactPlatformColor = useThemeColor('textDim')

  const items: React.JSX.Element[] = Object.entries(props.info)
    .filter(([key, value]) => !(['name'].includes(key))) // don't render these
    .map(([key, value], index) => {
      const missingComponent = <Text
        style={{fontStyle: 'italic'}}
        size="xs"
        text={translate('mintInfo.emptyValueParam', { param: key })}
      />

      let stringValue = isObj(value) ? JSON.stringify(value) : value.toString()
      let valueComponent = stringValue.trim() !== ''
        ? <Text size='xs' text={stringValue} />
        : missingComponent
      
      if (key === 'contact') {
        let contacts = (value as [string, string][]).filter(([k, v]) => k.trim() !== '')
        valueComponent = (contacts.length === 0) ? missingComponent : (
          <>
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
          </>
        )
      }
      // @ts-ignore no-implicit-any
      const leftComponent = key in iconMap ? <Icon icon={iconMap[key]} color={iconColor}/> : void 0
      // @ts-ignore no-implicit-any
      const itemText = prettyNamesMap?.[key] ?? key

      return <ListItem 
        LeftComponent={leftComponent}
        text={itemText}
        textStyle={$sizeStyles.xs}
        RightComponent={
          <View style={{ width: spacing.screenWidth * 0.6 }}>
            {valueComponent}
          </View>
        }
        topSeparator={index === 0 ? false : true}
        key={key}
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
  // TODO migrate to FlatList
  // mintInfo?.description_long ?? ''

  return (
    <Screen style={$screen} preset="scroll">
      {/* <View style={[$headerContainer, { backgroundColor: headerBg }]}> <Text preset="heading" tx="mintInfoHeading" style={{ color: 'white' }} /> </View> */}
      <AvatarHeader
        encircle={true}
        fallbackIcon="faBank"
        headerHeightModifier={0.26}
        heading={mintInfo?.name ?? translate('mintInfo.loadingNamePlaceholder')}
        text={route.params.mintUrl}>
        {mint?.units ? (
          <View style={{ flexDirection: 'row' }}>
            {mint.units.map(unit => (
              <CurrencySign
                containerStyle={{paddingLeft: 0, marginRight: spacing.small}}
                key={unit}
                mintUnit={unit}
              />
            ))}
          </View>
        ) : <Text style={{ fontStyle: 'italic' }} tx="mintInfo.loadingUnitsPlaceholder" />}
      </AvatarHeader>
      <View style={$contentContainer}>
        <Card
          headingTx="mintInfo.descriptionHeading"
          style={$card}
          ContentComponent={
            mintInfo && mintInfo.description ? (
              <CollapsibleText
                collapsed={true}
                summary={mintInfo.description}
                text={mintInfo?.description_long ?? ''}
              />
            ) : (
              <Text
                style={{fontStyle: 'italic'}}
                text={translate('mintInfo.emptyValueParam', {
                  param: translate("mintInfo.descriptionHeading"),
                })}
              />
            )
          }
        />
        <Card
          ContentComponent={
            <>
              {mintInfo && <MintInfoDetails info={mintInfo} />}
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

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginLeft: spacing.small,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
  alignItems: 'center',
  marginTop: spacing.large,
}
