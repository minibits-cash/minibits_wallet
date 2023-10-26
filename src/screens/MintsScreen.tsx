import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useRef, useState} from 'react'
import {Alert, TextInput, TextStyle, View, ViewStyle} from 'react-native'
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
import { infoMessage } from '../utils/utils'


export const MintsScreen: FC<SettingsStackScreenProps<'Mints'>> = observer(function MintsScreen({route, navigation}) {    
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {mintsStore, proofsStore, userSettingsStore} = useStores()
    const mintInputRef = useRef<TextInput>(null)

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


    const gotoScan = function () {
        toggleAddMintModal()
        navigation.navigate('WalletNavigator', {screen: 'Scan'})
    }

    
    const addMint = async function () {
      setIsAddMintVisible(false)

      if(mintUrl.includes('.onion')) {
        if(!userSettingsStore.isTorDaemonOn) {
            setInfo('Please enable Tor daemon in Privacy settings before connecting to the mint using .onion address.')
            return
        }
      }

      if (mintsStore.alreadyExists(mintUrl)) {
        const msg = translate('mintsScreen.mintExists')
        log.trace(msg)
        setInfo(msg)
        return
      }

      try {
        setIsLoading(true)
        // log.trace('Snapshot before add mint', getSnapshot(mintsStore))

        const mintKeys: {
          keys: MintKeys
          keyset: string
        } = await MintClient.getMintKeys(mintUrl)

        const newMint: Mint = {
          mintUrl,
          keys: mintKeys.keys,
          keysets: [mintKeys.keyset],
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
        let message: string = ''

        if (proofsByMint && proofsByMint.length > 0) {
            message = 'Your wallet has a positive balance with this mint. If removed, your ecash will be lost. '            
        }

        message += 'Do you really want to remove this mint from the wallet?'



        Alert.alert(
        'Warning',
        message,
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
                    if (proofsByMint && proofsByMint.length > 0) {
                        proofsStore.removeProofs(proofsByMint)           
                    }
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

    const onCopyMintUrl = function () {        
        try {
            Clipboard.setString(selectedMint?.mintUrl as string)
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
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
    const inputBg = useThemeColor('background')

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
          style={{alignItems: 'stretch'}}          
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
                leftIcon="faPencil"
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
                onPress={onCopyMintUrl}
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
                <Text
                    preset="subheading"
                    tx={'mintsScreen.addMintUrl'}
                    // style={{marginBottom: spacing.medium, textAlign: 'center'}}
                />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                        <TextInput
                            ref={mintInputRef}
                            onChangeText={mintUrl => setMintUrl(mintUrl)}
                            autoCapitalize='none'
                            keyboardType='default'
                            value={mintUrl}
                            style={[$mintInput, {backgroundColor: inputBg}]}
                            maxLength={200}
                            placeholder='https://'
                        />
                        <Button
                            preset='secondary'
                            text="Paste"
                            style={{
                                borderRadius: 0,                                
                                marginLeft: 1,                                
                            }}
                            onPress={pasteMintUrl}
                        />
                        <Button
                            preset='secondary'
                            text="Scan"
                            style={{
                                borderTopLeftRadius: 0,
                                borderBottomLeftRadius: 0,  
                                marginHorizontal: 1,                                
                            }}
                            onPress={gotoScan}
                        />
                </View>
                <View style={$buttonContainer}>
                    <Button
                        text="Save"
                        style={{
                            // borderTopLeftRadius: 0,
                            // borderBottomLeftRadius: 0,                                
                            marginRight: spacing.small,
                            minWidth: 80
                        }}
                        onPress={addMint}
                    />                    
                    <Button
                        tx={'common.cancel'}
                        onPress={toggleAddMintModal}
                        preset="secondary"
                    />
                </View>            
            </View>
          }
          onBackButtonPress={toggleAddMintModal}
          onBackdropPress={toggleAddMintModal}          
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
}) 



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
  marginBottom: spacing.small,
  marginTop: -spacing.extraLarge * 1.5,
  minHeight: 70,
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
  alignItems: 'center',
}


const $mintInput: TextStyle = {
    flex: 1,    
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
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
