import {observer} from 'mobx-react-lite'
import React, {FC, useState} from 'react'
import {Alert, TextStyle, View, ViewStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import {spacing, typography, useThemeColor, colors} from '../theme'
import {SettingsStackScreenProps} from '../navigation'
import {
  Button,
  Icon,
  Card,
  Screen,
  Loading,
  InfoModal,
  ErrorModal,
  ListItem,
  BottomModal,
  Text,
} from '../components'
import {Mint} from '../models/Mint'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {MintKeys, MintKeySets, MintClient} from '../services'
import {log} from '../utils/logger'
import AppError from '../utils/AppError'
import {translate} from '../i18n'
import {MintListItem} from './Mints/MintListItem'

export const MintsScreen: FC<SettingsStackScreenProps<'Mints'>> = observer(function MintsScreen(_props) {
    const {navigation} = _props
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {mintsStore, proofsStore} = useStores()

    const [mintUrl, setMintUrl] = useState('')
    const [selectedMint, setSelectedMint] = useState<Mint | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isAddMintVisible, setIsAddMintVisible] = useState(false)

    const toggleAddMintModal = async function () {
      if (isAddMintVisible) {
        setIsAddMintVisible(false)
        setMintUrl('')
      } else {
        setIsAddMintVisible(true)
      }
    }

    const pasteMintUrl = async () => {
      const url = await Clipboard.getString()
      try {
        new URL(url)
        setMintUrl(url)
      } catch (e) {
        setInfo(translate('mintsScreen.invalidUrl'))
      }
    }

    const pasteTestMintUrl = async () => {
      // Pastes mintUrl provided here
      setMintUrl('')
    }
    
    const addMint = async function () {
      setIsAddMintVisible(false)

      if (mintsStore.alreadyExists(mintUrl)) {
        const msg = translate('mintsScreen.mintExists')
        log.info(msg)
        setInfo(msg)
        return
      }

      try {
        setIsLoading(true)
        // log.trace('Snapshot before add mint', getSnapshot(mintsStore))

        const mintKeys: {
          keys: MintKeys
          keysets: MintKeySets
        } = await MintClient.getMintKeys(mintUrl)

        const newMint: Mint = {
          mintUrl,
          keys: mintKeys.keys,
          keysets: mintKeys.keysets.keysets,
        }

        mintsStore.addMint(newMint)

        // log.trace('Snapshot after add mint', getSnapshot(mintsStore))

        setInfo(translate('mintsScreen.mintAdded'))
      } catch (e: any) {
        setMintUrl('')
        handleError(e)
      } finally {
        setMintUrl('')
        setIsLoading(false)
      }
    }


	const removeMint = async function () {
    if (!selectedMint) {return}

      const proofsByMint = proofsStore.getByMint(selectedMint.mintUrl)


    if (proofsByMint && proofsByMint.length > 0) {
        setInfo('Your wallet has a positive balance with this mint. Send or transfer your tokens before removing.')
        return
    }

      Alert.alert(
      'Confirmation',
      'Do you want to remove this mint from the wallet?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {
              // Action canceled
            },
          },
          {
            text: 'Confirm',
            onPress: () => {
              try {
                onMintUnselect()
                mintsStore.removeMint(selectedMint as Mint)
                setInfo(translate('mintsScreen.mintRemoved'))
              } catch (e: any) {
                handleError(e)
              }
            },
          },
        ],
      )
    }

    const blockMint = async function () {
      if (!selectedMint) return
      try {
        mintsStore.blockMint(selectedMint as Mint)
        setInfo(translate('mintsScreen.mintBlocked'))
      } catch (e: any) {
        handleError(e)
      } finally {
        onMintUnselect()
      }
    }

    const unblockMint = async function () {
      if (!selectedMint) return
      try {
        mintsStore.unblockMint(selectedMint as Mint)
        setInfo(translate('mintsScreen.mintUnblocked'))
      } catch (e: any) {
        handleError(e)
      } finally {
        onMintUnselect()
      }
    }

    const onMintSelect = function (mint: Mint) {
      setSelectedMint(mint)
    }

    const onMintUnselect = function () {
      setSelectedMint(undefined)
    }

    const handleError = function (e: AppError) {
      setIsLoading(false)
      setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')

    return (
      <Screen preset="auto" contentContainerStyle={$screen}>
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="Manage mints" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
            <Card
                style={$actionCard}
                ContentComponent={
                    <ListItem
                        text={'Add mint'}
                        LeftComponent={<Icon
                            containerStyle={$iconContainer}
                            icon="faPlus"
                            size={spacing.medium}
                            color={iconColor}                  
                        />
                        }                
                        style={$actionItem}
                        onPress={toggleAddMintModal}
                    />
                }
            />
          {mintsStore.mintCount > 0 && (
            <Card
              style={$card}
              ContentComponent={
                <>
                  {mintsStore.mints.map((mint: Mint, index: number) => (
                    <MintListItem
                      key={mint.mintUrl}
                      mint={mint}
                      onMintSelect={() => onMintSelect(mint)}
                      isSelectable={true}
                      isSelected={selectedMint?.mintUrl === mint.mintUrl}
                      isBlocked={mintsStore.isBlocked(mint.mintUrl as string)}
                      separator={index !== 0 ? 'top' : undefined}
                    />
                  ))}
                </>
              }
            />
          )}
          {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={selectedMint ? true : false}
          top={spacing.screenHeight * 0.5}
          ContentComponent={
            <View style={{}}>
              <ListItem
                leftIcon="faInfoCircle"
                onPress={() => Alert.alert('Not yet implemented')}
                tx={'mintsScreen.mintInfo'}
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
              {mintsStore.isBlocked(selectedMint?.mintUrl as string) ? (
                <ListItem
                  leftIcon="faShieldHalved"
                  onPress={unblockMint}
                  tx={'mintsScreen.unblockMint'}
                  bottomSeparator={true}
                  style={{paddingHorizontal: spacing.medium}}
                />
              ) : (
                <ListItem
                  leftIcon="faShieldHalved"
                  onPress={blockMint}
                  tx={'mintsScreen.blockMint'}
                  bottomSeparator={true}
                  style={{paddingHorizontal: spacing.medium}}
                />
              )}
              <ListItem
                leftIcon="faPaintbrush"
                onPress={() => Alert.alert('Not yet implemented')}
                tx={'mintsScreen.rename'}
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
              <ListItem
                leftIcon="faPaintbrush"
                onPress={() => Alert.alert('Not yet implemented')}
                tx={'mintsScreen.setColor'}
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
              <ListItem
                leftIcon="faCopy"
                onPress={() => Alert.alert('Not yet implemented')}
                tx={'mintsScreen.copy'}
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
              <ListItem
                leftIcon="faXmark"
                onPress={removeMint}
                tx={'mintsScreen.removeMint'}
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
            </View>
          }
          onBackButtonPress={onMintUnselect}
          onBackdropPress={onMintUnselect}
        />
        <BottomModal
          isVisible={isAddMintVisible ? true : false}
          ContentComponent={
            <View style={$bottomModal}>
              {mintUrl.length > 0 ? (
                <PasteMintUrlBlock
                  mintUrl={mintUrl}
                  addMint={addMint}
                  toggleAddMintModal={toggleAddMintModal}
                />
              ) : (
                <AddMintUrlBlock
                  pasteMintUrl={pasteMintUrl}
                  pasteTestMintUrl={pasteTestMintUrl}
                />
              )}
          </View>
          }
          onBackButtonPress={toggleAddMintModal}
          onBackdropPress={toggleAddMintModal}
          top={spacing.screenHeight * 0.6}
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
}) 


const PasteMintUrlBlock = function (props: {
  mintUrl: string
  addMint: any
  toggleAddMintModal: any
}) {
  return (
    <View style={{alignItems: 'center'}}>
      <Text
        preset="subheading"
        tx={'mintsScreen.mintUrl'}
        style={{marginBottom: spacing.medium}}
      />
      <Text
        text={props.mintUrl}
      />
      <View style={$buttonContainer}>
        <Button
          testID="addmint-button"
          tx={'mintsScreen.addMint'}
          onPress={props.addMint}
          style={{marginRight: spacing.medium}}
        />
        <Button
          tx={'common.cancel'}
          onPress={props.toggleAddMintModal}
          preset="secondary"
        />
      </View>
    </View>
  )
}

const AddMintUrlBlock = function (props: {
  pasteMintUrl: any
  pasteTestMintUrl: any
}) {
  return (
    <View style={{alignItems: 'center'}}>
      <Text
        preset="subheading"
        tx="mintsScreen.mintUrlHint"
        style={{marginBottom: spacing.medium}}
      />
      <View style={$buttonContainer}>
        <Button
          testID="pasteminturl-button"
          tx={'common.paste'}
          onPress={props.pasteMintUrl}
          style={{marginRight: spacing.medium}}
        />
        <Button
          tx={'common.scan'}
          onPress={() => Alert.alert('Not yet implemented')}
          preset="secondary"
        />
      </View>
      {/*<Button      
      text="Paste test mint"
      onPress={props.pasteTestMintUrl}
      style={{marginTop: spacing.medium}}
      preset="secondary"
    />*/}
  </View>
  )
}

const $screen: ViewStyle = {

}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
  padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
  marginBottom: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 1.5,
  // padding: 0,
}

const $actionItem: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingTop: 0,
}

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: 20,
}

const $cardContent: TextStyle = {
  fontSize: 14,
}

const $bottomContainer: ViewStyle = {
  flex: 1,
  justifyContent: 'flex-end',
  marginBottom: spacing.large,
  alignSelf: 'stretch',
}

const $bottomModal: ViewStyle = {
  padding: spacing.small,
}

const $textField: ViewStyle = {
  marginBottom: spacing.large,
}

const $buttonContainer: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'center',
  marginTop: spacing.medium,
}

const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}
