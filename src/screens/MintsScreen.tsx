import {observer} from 'mobx-react-lite'
import React, {FC, useRef, useState} from 'react'
import {Alert, TextInput, TextStyle, View, ViewStyle} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import {
    MINIBITS_MINT_URL 
} from '@env'
import {spacing, typography, useThemeColor} from '../theme'
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
  MintIcon,
} from '../components'
import {Mint} from '../models/Mint'
import {useStores} from '../models'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError, { Err } from '../utils/AppError'
import {translate} from '../i18n'
import {MintListItem} from './Mints/MintListItem'
import { SvgXml } from 'react-native-svg'
import { isStateTreeNode } from 'mobx-state-tree'
import { MintKeyset } from '@cashu/cashu-ts'
import { QRCodeBlock } from './Wallet/QRCode'
import { QRShareModal } from '../components/QRShareModal'

export const MintsScreen: FC<SettingsStackScreenProps<'Mints'>> = observer(function MintsScreen({route, navigation}) {    
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const {mintsStore, proofsStore, walletStore} = useStores()
    // const {walletStore} = nonPersistedStores
    const mintInputRef = useRef<TextInput>(null)

    const [mintUrl, setMintUrl] = useState('')
    const [defaultMintUrl, setDefaultMintUrl] = useState<string>(MINIBITS_MINT_URL)
    const [selectedMint, setSelectedMint] = useState<Mint | undefined>()
    const [lastSelectedMint, setLastSelectedMint] = useState<Mint | undefined>()
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isAddMintVisible, setIsAddMintVisible] = useState(false)
    const [shareModalVisible, setShareModalVisible] = useState(false)


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


    const gotoInfo = function () {        
      if(!selectedMint) {return}
      navigation.navigate('MintInfo', {mintUrl: selectedMint?.mintUrl})
      onMintUnselect()
    }

    
    const addMint = async function () {
        setIsAddMintVisible(false)

        if (mintsStore.alreadyExists(mintUrl)) {
          const msg = translate('mintsScreen.mintExists')
          log.trace(msg)
          setInfo(msg)
          return
        }

        try {
            toggleAddMintModal() // close
            setIsLoading(true)
            await mintsStore.addMint(mintUrl)
            setInfo(translate('mintsScreen.mintAdded'))
        } catch (e: any) {
            setMintUrl('')
            handleError(e)
        } finally {
            setMintUrl('')
            setIsLoading(false)            
        }
    }


    const updateMint = async function () {
        if (!selectedMint) {return}

        try {          
          setIsLoading(true)
          await mintsStore.updateMint(selectedMint.mintUrl)          
          setInfo(translate("mintSettingsUpdated"))
        } catch (e: any) {          
          handleError(e)
        } finally {  
          onMintUnselect()
          setIsLoading(false)
        }
    }


    const updateMintUrlStart = async function () {
      if (!selectedMint) {return}
      toggleAddMintModal() // open
    }


    const updateMintUrl = async function () {
      if (!selectedMint) {return}      
      try {
        if (isStateTreeNode(selectedMint)) { // update URL of existing mint
          // checks if mint is reachable on new url, if it the same mint by checking keysets and syncs local data
          if(mintsStore.alreadyExists(mintUrl)) {
            throw new AppError(Err.VALIDATION_ERROR, 'Mint with this URL already exists.')
          }

          toggleAddMintModal() // close
          setIsLoading(true)
          const keysets: MintKeyset[] = await walletStore.getMintKeysets(mintUrl)
          const matchingKeyset = keysets.find(keyset => selectedMint.keysets?.some(k => k.id === keyset.id))

          if(!matchingKeyset) {
            throw new AppError(Err.VALIDATION_ERROR, 'No keyset match, provided URL likely points to different mint.')
          }

          selectedMint.setMintUrl!(mintUrl)                    
        }
      } catch (e: any) {        
        handleError(e)
      } finally {  
        setMintUrl('')
        setIsLoading(false)
        onMintUnselect() // close        
      }
    }


    const addDefaultMint = async function () {
        setMintUrl(defaultMintUrl)
        toggleAddMintModal()
    }


	const removeMint = async function () {
        if (!selectedMint) {return}

        const proofsByMint = proofsStore.getByMint(selectedMint.mintUrl, {isPending: false})
        const pendingProofsByMint = proofsStore.getByMint(selectedMint.mintUrl, {isPending: true})
        let message: string = ''

        if (proofsByMint && proofsByMint.length > 0) {
          message = translate("removingMintLostBalanceWarning") + `\n\n`
        }
        message += translate("confirmMintRemoval", { hostname: selectedMint.hostname, shortname: selectedMint.shortname })

        Alert.alert(
        translate("warning"),
        message,
            [
            {
                text: translate('common.cancel'),
                style: 'cancel',
                onPress: () => {
                // Action canceled
                },
            },
            {
                text: translate('common.confirm'),
                onPress: () => {
                try {
                    onMintUnselect()
                    mintsStore.removeMint(selectedMint as Mint)
                    if (proofsByMint && proofsByMint.length > 0) {
                        proofsStore.removeProofs(proofsByMint)           
                    }
                    if (pendingProofsByMint && pendingProofsByMint.length > 0) {
                        proofsStore.removeProofs(pendingProofsByMint, true)           
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
      setLastSelectedMint(mint)
    }

    const onMintUnselect = function () {
      setSelectedMint(undefined)
    }

    const openShareModal = () => { 
      setSelectedMint(void 0)
      setShareModalVisible(true) 
    }
    const closeShareModal = () => { setShareModalVisible(false) }

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
          <Text preset="heading" tx="manageMints" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
            <Card
                style={$actionCard}
                ContentComponent={
                    <>
                    <ListItem
                        tx='mintsScreen.addMint'
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
                    {!mintsStore.alreadyExists(defaultMintUrl) && (
                    <ListItem
                        tx="mintsScreen.addMintMinibits"
                        LeftComponent={<SvgXml 
                            width={spacing.medium} 
                            height={spacing.medium} 
                            xml={MintIcon}
                            fill={iconColor}
                            style={{marginLeft: spacing.extraSmall, marginRight: spacing.large}}
                        />
                        }                
                        style={$actionItem}
                        onPress={addDefaultMint}
                        topSeparator={true}
                    />
                    )}
                    </>
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
                      isUnitVisible={true}
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
                onPress={gotoInfo}
                tx='mintsScreen.mintInfo'
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
              <ListItem
                leftIcon='faRotate'
                onPress={updateMint}
                tx="mintsScreen.refreshMintSettings"
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
              {mintsStore.isBlocked(selectedMint?.mintUrl as string) ? (
                <ListItem
                  leftIcon="faShieldHalved"
                  onPress={unblockMint}
                  tx='mintsScreen.unblockMint'
                  bottomSeparator={true}
                  style={{paddingHorizontal: spacing.medium}}
                />
              ) : (
                <ListItem
                  leftIcon="faShieldHalved"
                  onPress={blockMint}
                  tx='mintsScreen.blockMint'
                  bottomSeparator={true}
                  style={{paddingHorizontal: spacing.medium}}
                />
              )}
              {/*<ListItem
                leftIcon="faPaintbrush"
                onPress={() => Alert.alert('Not yet implemented')}
                tx={'mintsScreen.setColor'}
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />*/}
              <ListItem
                leftIcon="faShareNodes"
                onPress={openShareModal}
                tx="mintsScreen.share"
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
              <ListItem
                leftIcon="faCopy"
                onPress={onCopyMintUrl}
                tx='mintsScreen.copy'
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}j
              />
              <ListItem
                leftIcon='faGlobe'
                onPress={updateMintUrlStart}
                text="Update mint URL"
                bottomSeparator={true}
                style={{paddingHorizontal: spacing.medium}}
              />
              <ListItem
                leftIcon="faXmark"
                onPress={removeMint}
                tx='mintsScreen.removeMint'
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
                    tx={selectedMint ? 'mintsScreen.updateMintUrl' : 'mintsScreen.addMintUrl'}
                    // style={{marginBottom: spacing.medium, textAlign: 'center'}}
                />
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.small}}>
                        <TextInput
                            ref={mintInputRef}
                            onChangeText={mintUrl => setMintUrl(mintUrl)}
                            onFocus={() => mintUrl.length === 0 ? setMintUrl('https://') : undefined}
                            autoCapitalize='none'
                            keyboardType='default'
                            value={mintUrl}
                            style={[$mintInput, {backgroundColor: inputBg}]}
                            maxLength={200}
                            placeholder='https://'
                        />
                        <Button
                            preset='secondary'
                            tx='common.paste'
                            style={{
                                borderRadius: 0,                                
                                marginLeft: 1,                                
                            }}
                            onPress={pasteMintUrl}
                        />
                        <Button
                            preset='secondary'
                            tx="common.scan"
                            style={{
                                borderTopLeftRadius: 0,
                                borderBottomLeftRadius: 0,  
                                marginHorizontal: 1,                                
                            }}
                            onPress={gotoScan}
                        />
                </View>
                <View style={$buttonContainer}>
                  {selectedMint ? (
                      <Button
                        tx='common.update'
                        style={{
                            // borderTopLeftRadius: 0,
                            // borderBottomLeftRadius: 0,                                
                            marginRight: spacing.small,
                            minWidth: 80
                        }}
                        onPress={updateMintUrl}
                      />  
                  ) : (
                      <Button
                        tx='common.save'
                        style={{
                            // borderTopLeftRadius: 0,
                            // borderBottomLeftRadius: 0,                                
                            marginRight: spacing.small,
                            minWidth: 80
                        }}
                        onPress={addMint}
                      />                    
                  )}
                    
                    <Button
                        tx='common.cancel'
                        onPress={toggleAddMintModal}
                        preset="secondary"
                    />
                </View>            
            </View>
          }
          onBackButtonPress={toggleAddMintModal}
          onBackdropPress={toggleAddMintModal}          
        />
        {/* using lastSelectedMint so we can close the underlying modal */}
        {lastSelectedMint && typeof lastSelectedMint?.mintUrl === 'string' &&
          <QRShareModal
            url={lastSelectedMint?.mintUrl as string}
            shareModalTx='mintsScreen.share'
            subHeading={lastSelectedMint?.shortname as string}
            type='URL'
            isVisible={shareModalVisible}
            onClose={closeShareModal}
          />
        }
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
  height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
  padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
  marginBottom: spacing.small,
  marginTop: -spacing.extraLarge * 2,
  minHeight: 70,
  paddingVertical: 0,  
}

const $actionItem: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $card: ViewStyle = {
    marginBottom: spacing.small,
  // paddingTop: 0,
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
    borderTopLeftRadius: spacing.extraSmall,
    borderBottomLeftRadius: spacing.extraSmall,
    // fontSize: 16,
    padding: spacing.extraSmall,
    alignSelf: 'stretch',
    // textAlignVertical: 'top',
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
