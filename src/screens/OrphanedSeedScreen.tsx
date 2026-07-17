import React, {useEffect, useState} from 'react'
import {FlatList, TextStyle, View, ViewStyle} from 'react-native'
import {scale} from '@gocodingnow/rn-size-matters'
import Clipboard from '@react-native-clipboard/clipboard'
import {StaticScreenProps, useNavigation} from '@react-navigation/native'
import {
  $sizeStyles,
  BottomModal,
  Button,
  Card,
  ErrorModal,
  InfoModal,
  ListItem,
  Loading,
  Screen,
  Text,
} from '../components'
import {translate} from '../i18n'
import {KeyChain, log, resolveOrphanedSeed} from '../services'
import {colors, spacing, useThemeColor} from '../theme'
import AppError from '../utils/AppError'

type Props = StaticScreenProps<undefined>

/**
 * The keychain outlived the wallet — offer the user the choice before anything derives.
 *
 * Reached from WelcomeScreen when `hasOrphanedSeed()` is true, which in practice means
 * an iOS reinstall: the container (database, MMKV) went with the app, the keychain did
 * not. The seed is therefore intact while every derivation counter is gone, and simply
 * resuming would re-derive blinded secrets the mint has already signed.
 *
 * Two ways out, both safe, and the screen is careful not to make the choice for them:
 *
 *   RECOVER — keep the seed and run the standard recovery, which walks the derivation
 *   space, moves each counter past what the mint has already seen, and brings the ecash
 *   back. It also recovers the profile from the seedHash, so the user keeps their
 *   @minibits.cash address. GATED on having copied the phrase: recovery ends in
 *   saveWalletKeys with whatever mnemonic is typed there, so arriving without it and
 *   entering a different one overwrites the keys this screen exists to protect.
 *
 *   START FRESH — discard the seed and generate a new one. Safe by construction (a new
 *   seed has no history, so counter 0 is correct), but it abandons whatever the old
 *   seed still holds AND changes the user's identity: the Nostr keypair is derived from
 *   the mnemonic via NIP-06 and the walletId is regenerated, so the address changes and
 *   contacts can no longer reach them. That is why the mnemonic is shown and copyable
 *   BEFORE this is offered, and why it takes a confirmation.
 */
export const OrphanedSeedScreen = function ({route}: Props) {
  const navigation = useNavigation()
  const headerBg = useThemeColor('header')
  const headerTitle = useThemeColor('headerTitle')

  const [mnemonic, setMnemonic] = useState<string>()
  const [mnemonicArray, setMnemonicArray] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isResetConfirmVisible, setIsResetConfirmVisible] = useState(false)
  const [hasCopiedSeed, setHasCopiedSeed] = useState(false)
  const [info, setInfo] = useState('')
  const [error, setError] = useState<AppError | undefined>()

  useEffect(() => {
    const loadMnemonic = async () => {
      try {
        const keys = await KeyChain.getWalletKeys()

        // Defensive: the screen is only reachable when keys were found at startup, so
        // this means they vanished underneath us. Nothing to decide — let onboarding
        // carry on and generate a fresh set.
        if (!keys) {
          log.warn('[OrphanedSeedScreen]', 'No wallet keys found, returning to onboarding')
          resolveOrphanedSeed()
          navigation.goBack()
          return
        }

        setMnemonic(keys.SEED.mnemonic)
        setMnemonicArray(keys.SEED.mnemonic.split(/\s+/))
        setIsLoading(false)
      } catch (e: any) {
        setIsLoading(false)
        setError(e)
      }
    }
    loadMnemonic()
  }, [])

  const onCopy = function () {
    try {
      if (!mnemonic) return
      Clipboard.setString(mnemonic)
      setHasCopiedSeed(true)
      setInfo(translate('orphanedSeed_copied'))
    } catch (e: any) {
      setInfo(translate('commonCopyFailParam', {param: e.message}))
    }
  }

  /** Keep the seed. Recovery restores the funds AND advances the counters. */
  const onRecover = function () {
    // Gated on having copied, because recovery ENDS in saveWalletKeys with whatever
    // mnemonic gets typed there. A user who arrives without the phrase in hand and
    // enters a different one overwrites the very keys this screen exists to protect —
    // and those keys are the only remaining route to the old wallet's ecash. Copying
    // first is not ceremony: recovery is about to ask for exactly this phrase.
    if (!hasCopiedSeed) {
      setInfo(translate('orphanedSeed_copyFirst'))
      return
    }

    // Deliberately NOT resolved: recovery may be abandoned half way, and a user who
    // backs out has decided nothing. Asking again is correct.
    navigation.navigate('SeedRecovery' as never)
  }

  /** Discard the seed. Onboarding then generates a fresh one and derives from 0 safely. */
  const onStartFresh = async function () {
    try {
      setIsResetConfirmVisible(false)
      setIsLoading(true)

      await KeyChain.removeWalletKeys()
      // Clear the startup snapshot, or the freshly generated keys look orphaned too and
      // onboarding offers to reset a seed that is seconds old.
      resolveOrphanedSeed()

      log.info('[OrphanedSeedScreen]', 'Wallet keys discarded on user confirmation')

      navigation.goBack()
    } catch (e: any) {
      setIsLoading(false)
      setError(e)
    }
  }

  return (
    <Screen contentContainerStyle={$screen} preset="auto">
      <View style={[$headerContainer, {backgroundColor: headerBg}]}>
        <Text preset="heading" tx="orphanedSeed_title" style={{color: headerTitle}} />
      </View>
      <View style={$contentContainer}>
        <Card
          style={$card}
          ContentComponent={
            <ListItem
              tx="orphanedSeed_explainTitle"
              subTx="orphanedSeed_explainDescription"
              leftIcon="faTriangleExclamation"
              leftIconColor={colors.palette.accent400}
              leftIconInverse={true}
              style={$item}
            />
          }
        />
        <Card
          style={$card}
          ContentComponent={
            <>
              {isLoading && <Loading />}
              <FlatList
                data={mnemonicArray}
                numColumns={2}
                renderItem={({item, index}) => (
                  <Button
                    key={index}
                    preset={'secondary'}
                    onPress={() => false}
                    text={`${index + 1}. ${item}`}
                    style={{minWidth: scale(150), margin: spacing.tiny, minHeight: scale(25)}}
                    textStyle={[$sizeStyles.xs, {padding: 0, margin: 0, lineHeight: 16}]}
                  />
                )}
                keyExtractor={item => item}
                style={{flexGrow: 0}}
                contentContainerStyle={{alignItems: 'center'}}
              />
            </>
          }
          FooterComponent={
            <View style={$buttonContainer}>
              <Button
                preset="default"
                style={{margin: spacing.small}}
                tx="commonCopy"
                onPress={onCopy}
              />
            </View>
          }
        />
        <Card
          style={$card}
          ContentComponent={
            <>
              <ListItem
                tx="orphanedSeed_recoverTitle"
                subTx={hasCopiedSeed ? 'orphanedSeed_recoverDescription' : 'orphanedSeed_recoverCopyFirst'}
                leftIcon="faRotate"
                leftIconColor={hasCopiedSeed ? colors.palette.success200 : colors.palette.neutral400}
                leftIconInverse={true}
                style={[$item, !hasCopiedSeed && $itemGated]}
                bottomSeparator={true}
                onPress={onRecover}
              />
              <ListItem
                tx="orphanedSeed_resetTitle"
                subTx="orphanedSeed_resetDescription"
                leftIcon="faXmark"
                leftIconColor={colors.palette.neutral400}
                leftIconInverse={true}
                style={$item}
                onPress={() => setIsResetConfirmVisible(true)}
              />
            </>
          }
        />
      </View>

      <BottomModal
        isVisible={isResetConfirmVisible}
        ContentComponent={
          <View style={$modalContainer}>
            <Text preset="subheading" tx="orphanedSeed_resetConfirmTitle" />
            <Text
              style={{marginVertical: spacing.small, textAlign: 'center'}}
              tx="orphanedSeed_resetConfirmDescription"
            />
            <View style={$buttonContainer}>
              <Button
                preset="secondary"
                tx="commonCancel"
                style={{marginRight: spacing.small}}
                onPress={() => setIsResetConfirmVisible(false)}
              />
              <Button
                preset="default"
                tx="orphanedSeed_resetConfirmButton"
                onPress={onStartFresh}
              />
            </View>
          </View>
        }
        onBackButtonPress={() => setIsResetConfirmVisible(false)}
        onBackdropPress={() => setIsResetConfirmVisible(false)}
      />

      {error && <ErrorModal error={error} />}
      {info && <InfoModal message={info} />}
    </Screen>
  )
}

const $screen: ViewStyle = {}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
}

const $contentContainer: TextStyle = {
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
}

const $modalContainer: ViewStyle = {
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

/** Recovery stays visible but reads as unavailable until the seed has been copied. */
const $itemGated: ViewStyle = {
  opacity: 0.5,
}
