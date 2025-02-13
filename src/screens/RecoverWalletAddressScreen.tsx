import { observer } from 'mobx-react-lite'
import React, { useRef, useState } from 'react'
import { LayoutAnimation, Platform, TextInput, TextStyle, UIManager, View, ViewStyle } from 'react-native'
import { validateMnemonic } from '@scure/bip39'
import QuickCrypto from 'react-native-quick-crypto'
import { wordlist } from '@scure/bip39/wordlists/english'
import { mnemonicToSeedSync } from '@scure/bip39'
import { colors, spacing, useThemeColor } from '../theme'
import { Icon, ListItem, Screen, Text, Card, Loading, ErrorModal, Button } from '../components'
import { useHeader } from '../utils/useHeader'
import AppError, { Err } from '../utils/AppError'
import { MinibitsClient, log } from '../services'
import { useStores } from '../models'
import { MnemonicInput } from './Recovery/MnemonicInput'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { delay } from '../utils/utils'
import { WalletProfileRecord } from '../models/WalletProfileStore'
import { translate } from '../i18n'
import { StackActions, StaticScreenProps, useNavigation } from '@react-navigation/native'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

type Props = StaticScreenProps<undefined>

export const RecoverWalletAddressScreen = observer(function RecoverWalletAddressScreen({ route }: Props) {
  const navigation = useNavigation()
  useHeader({
    leftIcon: 'faArrowLeft',
    onLeftPress: () => {
      navigation.goBack()
    },
  })

  const { walletProfileStore, userSettingsStore, walletStore } = useStores()

  const mnemonicInputRef = useRef<TextInput>(null)
  const seedRef = useRef<Uint8Array | null>(null)
  const seedHashRef = useRef<string | null>(null)

  const [mnemonic, setMnemonic] = useState<string>('')
  const [isValidMnemonic, setIsValidMnemonic] = useState(false)
  const [profileToRecover, setProfileToRecover] = useState<WalletProfileRecord | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<AppError | undefined>()    
  const [statusMessage, setStatusMessage] = useState<string>()

  const onConfirmMnemonic = async function () {
    try {
      if (!mnemonic) {
        throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicError'))
      }

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)

      if (!validateMnemonic(mnemonic, wordlist)) {
        throw new AppError(Err.VALIDATION_ERROR, translate("recoveryInvalidMnemonicError"))
      }
      
      const binarySeed = mnemonicToSeedSync(mnemonic)
      const seedHash = QuickCrypto.createHash('sha256')
      .update(binarySeed)
      .digest('hex')

      seedRef.current = binarySeed
      seedHashRef.current = seedHash

      setIsValidMnemonic(true)
    } catch (e: any) {
      handleError(e)
    }
  }

  const onFindWalletAddress = async () => {
    try {
      if(!seedHashRef.current || !seedRef.current) {
        throw new AppError(Err.VALIDATION_ERROR, 'Could not get seed')
      }

      setStatusMessage(translate('recovery.recoveringAddress'))
      setIsLoading(true)

      const seedHash = QuickCrypto.createHash('sha256')
        .update(seedRef.current)
        .digest('hex')

      const profile = await MinibitsClient.getWalletProfileBySeedHash(seedHash as string) // throws if not found

      log.trace('[onCheckWalletAddress] profileToRecover', { profile })

      if (profile.nip05.includes(MINIBITS_NIP05_DOMAIN)) {
        setProfileToRecover(profile)
      } else {
        setStatusMessage(translate("recovery.ownKeysImportAgain", { addr: profile.nip05 }))
        await delay(4000)
      }

      setStatusMessage('')
      setIsLoading(false)
    } catch (e: any) {
      handleError(e)
    }
  }

  const onCompleteAddress = async () => {
    try {
      if(!seedHashRef.current || !seedRef.current || !profileToRecover) {
        throw new AppError(Err.VALIDATION_ERROR, translate("recovery.missingMnemonicSeedProfileError"))
      }

      setIsLoading(true)
      setStatusMessage(translate("recovery.recoveringAddress"))      

      const keys = await walletStore.getCachedWalletKeys()

      log.trace('[onCompleteAddress] Wallet keys', { keys })

      await walletProfileStore.recover(
        keys.NOSTR.publicKey,
        keys.walletId,
        seedHashRef.current
      )

      userSettingsStore.setIsOnboarded(true)

      setStatusMessage(translate('recovery.completed'))
      await delay(1000)
      setStatusMessage('')
      setIsLoading(false)
      
      navigation.dispatch(                
        StackActions.popToTop()
      )
    } catch (e: any) {
      handleError(e)
    }
  }

  const handleError = function (e: AppError): void {
    setIsLoading(false)
    setError(e)
  }

  const headerBg = useThemeColor('header')
  const numIconColor = useThemeColor('textDim')
  const loadingBg = useThemeColor('background')
  const headerTitle = useThemeColor('headerTitle')

  return (
    <Screen contentContainerStyle={$screen} preset="scroll">
      <View style={[$headerContainer, { backgroundColor: headerBg }]}>
        <Text
          preset="heading"
          text="Recover address"
          style={{ color: headerTitle, textAlign: 'center' }}
        />
      </View>
      <View style={$contentContainer}>
        <MnemonicInput
          ref={mnemonicInputRef}
          mnemonic={mnemonic}
          isValidMnemonic={isValidMnemonic}
          setMnemonic={setMnemonic}
          onConfirm={onConfirmMnemonic}
          onError={handleError}
        />
        {isValidMnemonic && profileToRecover && (
          <>
          <Card
            style={$card}
            ContentComponent={
              <>
              <ListItem
                text={profileToRecover.nip05}
                subText="This is the wallet address linked to the provided seed."
                LeftComponent={<View style={[$numIcon, { backgroundColor: numIconColor }]}><Text text='2' /></View>}
                style={$item}
                bottomSeparator
              />
              <ListItem
                text={'Do not lose your ecash!'}
                subText="Your current wallet seed phrase will NOT be changed. Keep it in a safe place!"
                LeftComponent={<View style={[$numIcon, { backgroundColor: numIconColor }]}><Text text='3' /></View>}
                style={$item}
              />
              </>
            }
          />
          </>
        )}
      </View>
      {isValidMnemonic && (
        <View style={$bottomContainer}>
          <View style={$buttonContainer}>
            {profileToRecover ? (
              <Button
                tx="recovery.completeCTA"
                style={{ marginRight: spacing.small }}
                LeftAccessory={() => (
                  <Icon
                    icon='faCircleUser'
                    size={spacing.medium}
                  />
                )}
                onPress={onCompleteAddress}
              />
            ) : (
              <Button
                tx="recovery.findAddressCTA"
                style={{ marginRight: spacing.small }}
                LeftAccessory={() => (
                  <Icon
                    icon='faCircleUser'
                    size={spacing.medium}
                  />
                )}
                onPress={onFindWalletAddress}
              />
            )}
          </View>
        </View>
      )}      
      {error && <ErrorModal error={error} />}
      {isLoading && <Loading />}
    </Screen>
  )
})

const $screen: ViewStyle = { flex: 1 }

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
  flex: 1,
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
}

const $bottomContainer: ViewStyle = {
  marginBottom: spacing.extraLarge
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $numIcon: ViewStyle = {
  width: 30,
  height: 30,
  borderRadius: 15,
  justifyContent: 'center',
  alignItems: 'center',
  marginRight: spacing.medium
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
  marginTop: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}