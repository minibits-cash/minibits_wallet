import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {LayoutAnimation, Platform, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {validateMnemonic} from '@scure/bip39'
import { btoa, atob } from 'react-native-quick-base64'
import QuickCrypto from 'react-native-quick-crypto'
import { wordlist } from '@scure/bip39/wordlists/english'
import {colors, spacing, typography, useThemeColor} from '../theme'
import {AppStackScreenProps, goBack} from '../navigation' // @demo remove-current-line
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
} from '../components'
import {useHeader} from '../utils/useHeader'
import AppError, { Err } from '../utils/AppError'
import { Database, KeyChain, log, MinibitsClient, NostrClient } from '../services'
import Clipboard from '@react-native-clipboard/clipboard'
import { rootStoreInstance, useStores } from '../models'
import {MnemonicInput} from './Recovery/MnemonicInput'
import { TransactionData, TransactionStatus } from '../models/Transaction'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { deriveSeedFromMnemonic } from '@cashu/cashu-ts'
import { MINIBITS_MINT_URL, MINIBITS_NIP05_DOMAIN } from '@env'
import { delay } from '../utils/utils'
import { applySnapshot} from 'mobx-state-tree'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { WalletProfileRecord } from '../models/WalletProfileStore'
import { translate } from '../i18n'
import { ProofsStoreSnapshot } from '../models/ProofsStore'
import { MintsStoreSnapshot } from '../models/MintsStore'
import { ContactsStoreSnapshot } from '../models/ContactsStore'
import { TransactionsStoreSnapshot } from '../models/TransactionsStore'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export const ImportBackupScreen: FC<AppStackScreenProps<'ImportBackup'>> = observer(
  function ImportBackupScreen(_props) {
    const {navigation, route} = _props    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {            
            navigation.goBack()
        },
    })

    const {
        mintsStore, 
        proofsStore, 
        userSettingsStore, 
        transactionsStore,
        contactsStore, 
        walletProfileStore, 
        walletStore
    } = useStores()
    
    const mnemonicInputRef = useRef<TextInput>(null)
    const backupInputRef = useRef<TextInput>(null)

    const [isAddressOnlyRecovery, setIsAddressOnlyRecovery] = useState(route.params.isAddressOnlyRecovery ? true : false)
    const [info, setInfo] = useState('')    
    const [mnemonicExists, setMnemonicExists] = useState(false)
    const [mnemonic, setMnemonic] = useState<string>('')    
    const [isValidMnemonic, setIsValidMnemonic] = useState(false)    
    const [seed, setSeed] = useState<Uint8Array>()
    const [backup, setBackup] = useState<string>('')
    const [isValidBackup, setIsValidBackup] = useState(false)    
    const [walletSnapshot, setWalletSnapshot] = useState<{
      proofsStore: ProofsStoreSnapshot,
      mintsStore: MintsStoreSnapshot,
      contactsStore: ContactsStoreSnapshot,
      transactionsStore: TransactionsStoreSnapshot
    } | undefined>(undefined) // type tbd
    const [profileToRecover, setProfileToRecover] = useState<WalletProfileRecord | undefined>(undefined)
    const [isLoading, setIsLoading] = useState(false)    
    const [error, setError] = useState<AppError | undefined>()        
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, message: string} | undefined>()
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)    
    const [statusMessage, setStatusMessage] = useState<string>()

    useEffect(() => {
        const getMnemonic = async () => {  
            try {
                setIsLoading(true)          
                const existing = await walletStore.getMnemonic()

                if(existing) {
                    setMnemonicExists(true)
                }
                setIsLoading(false) 
            } catch (e: any) {
                handleError(e)
            } 
        }
        getMnemonic()
    }, [])


    const toggleResultModal = () => {
        if(isResultModalVisible === true) {
            setResultModalInfo(undefined)
        }
        setIsResultModalVisible(previousState => !previousState)        
    }

    // Used by both Wallet address and Import backup flows
    const onConfirmMnemonic = async function () {
        try {
            if(!mnemonic) {
              throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicError'))
            }

            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)            

            if (!validateMnemonic(mnemonic, wordlist)) {
              throw new AppError(Err.VALIDATION_ERROR, translate("recoveryInvalidMnemonicError"))
            }          

            const start = performance.now()
            const binarySeed = deriveSeedFromMnemonic(mnemonic) // expensive
            const end = performance.now()
            console.log(`[onConfirm] deriveSeedFromMnemonic took ${end - start} ms.`)
    
            setSeed(binarySeed)
            setIsValidMnemonic(true)            
        } catch (e: any) {
          handleError(e)
        }
    }

    // Used by Import backup flow
    const onPasteBackup = async function () {
        try {
            const maybeBackup = await Clipboard.getString()

            if(!maybeBackup) {
                throw new AppError(Err.VALIDATION_ERROR, 'Copy and paste the wallet backup.')
            }

            const cleaned = maybeBackup.trim()
            
            setBackup(cleaned)
        } catch (e: any) {
            handleError(e)
        }
    }

    // Used by Import backup flow
    const getWalletSnapshot = function () {
      try {
          // decode
          const decoded = atob(backup)
          // try to load as json
          const snapshot = JSON.parse(decoded) as {
            proofsStore: ProofsStoreSnapshot,
            mintsStore: MintsStoreSnapshot,
            contactsStore: ContactsStoreSnapshot,
            transactionsStore: TransactionsStoreSnapshot
          }

          // log.trace('[getWalletSnapshot]', {snapshot})
          
          if(!snapshot.proofsStore || !snapshot.mintsStore || !snapshot.contactsStore || !snapshot.transactionsStore) {
            throw new Error('Wrong backup format.')
          }

          return snapshot
      } catch (e: any) {        
        throw new AppError(Err.VALIDATION_ERROR, `Invalid backup: ${e.message}`)
      }
    }

    // Used by Import backup flow
    const onConfirmBackup = async function () {
      try {
          if(!backup) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing backup.')
          }

          const snapshot = getWalletSnapshot() // throws

          setWalletSnapshot(snapshot)
          setIsValidBackup(true)

          await onFindWalletAddress()
      } catch (e: any) {
        handleError(e)
      }
    }


    const onBack = function (): void {
        return navigation.goBack()
    }

    // Used by both Wallet address and Import backup flows
    const onFindWalletAddress = async () => {
      try {
          if(!seed || !mnemonic) {
            throw new AppError(Err.VALIDATION_ERROR, translate("backupScreen.missingMnemonicOrSeedError"))
          }

          setStatusMessage(translate('recovery.recoveringAddress'))
          setIsLoading(true)

          const seedHash = QuickCrypto.createHash('sha256')
          .update(seed)
          .digest('hex')
          
          const profile = await MinibitsClient.getWalletProfileBySeedHash(seedHash as string)            

          // Skip external profiles beacause we do not control keys
          if(profile) {
              log.info('[onCheckWalletAddress] profileToRecover', {profile})                

              if(profile.nip05.includes(MINIBITS_NIP05_DOMAIN)) {                                    
                  setProfileToRecover(profile)
              } else {
                  setInfo(translate("recovery.ownKeysImportAgain", { addr: profile.nip05 }))
                  await delay(4000)
              }
          } else {
            if(isAddressOnlyRecovery) {
              setInfo(translate("recovery.noWalletForSeedError"))
            }
          }
          
          setStatusMessage('')
          setIsLoading(false)
      } catch (e: any) {
          handleError(e)
      }
    }

    // Used by Import backup flow
    const importWallet = async function () {
      try {
        if(!walletSnapshot) {
          throw new AppError(Err.VALIDATION_ERROR, 'Missing wallet spnapshot decoded from backup.')
        }

        setStatusMessage(translate("recovery.starting"))
        setIsLoading(true)        
      
        // import wallet snapshot into the state        
        const rootStore = rootStoreInstance
        
        log.trace('Before import', {rootStore})
        log.trace('Snapshot ot be imported', {walletSnapshot})

        applySnapshot(proofsStore, walletSnapshot.proofsStore)
        applySnapshot(mintsStore, walletSnapshot.mintsStore)
        applySnapshot(contactsStore, walletSnapshot.contactsStore)
        applySnapshot(transactionsStore, walletSnapshot.transactionsStore)

        log.trace('After import', {rootStore})

        // import proofs into the db
        if(proofsStore.proofsCount > 0) {
          Database.addOrUpdateProofs(proofsStore.allProofs, false, false)
        }
        
        if(proofsStore.pendingProofsCount > 0) {
          Database.addOrUpdateProofs(proofsStore.allPendingProofs, true, false)
        }

        if(!mintsStore.mintExists(MINIBITS_MINT_URL)) {
          await mintsStore.addMint(MINIBITS_MINT_URL)            
        }      
        
        if(profileToRecover) {
          // If wallet profile has been found on server, recover wallet address
          await onCompleteAddress()
        } else {
          // If there is no profile go back to the welcome screen to create a new one
          goBack()
        }
      } catch (e: any) {
        handleError(e)
      }               
    } 


    // Used by both Wallet address and Import backup flows
    const onCompleteAddress = async () => {
      try {
          if(!seed || !mnemonic || !profileToRecover) {
              throw new AppError(Err.VALIDATION_ERROR, translate("recovery.missingMnemonicSeedProfileError"))
          }

          setStatusMessage(translate("recovery.recoveringAddress"))
          setIsLoading(true)

          const seedHash = QuickCrypto.createHash('sha256')
          .update(seed)
          .digest('hex')

          // get nostr key from current on device profile (if we recover to existing wallet in Settings) or create new one (if we recover to new install)
          const {publicKey: newPublicKey} = await NostrClient.getOrCreateKeyPair()
          
          // delete orphaned server profile then update server profile with seedHash with pubkey + update on device wallet name and address
          await walletProfileStore.recover(seedHash as string, newPublicKey)

          // align walletId in userSettings with recovered profile
          userSettingsStore.setWalletId(walletProfileStore.walletId)            
          await KeyChain.saveMnemonic(mnemonic)
          await KeyChain.saveSeed(seed as Uint8Array)
          userSettingsStore.setIsOnboarded(true)
          
          setStatusMessage(translate('recovery.completed'))
          await delay(1000)
          setStatusMessage('')
          setIsLoading(false)

          if(isAddressOnlyRecovery) {
            // go back to Settings
            navigation.goBack()       
          } else {
            navigation.navigate('Tabs', {screen: 'WalletNavigator', params: {screen: 'Wallet', params: {}}})
          }          
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
    const textHint = useThemeColor('textDim')
    const inputBg = useThemeColor('background')
    const headerTitle = useThemeColor('headerTitle')

    if(mnemonicExists && !isAddressOnlyRecovery) {
      return (
        <Screen contentContainerStyle={$screen} preset="auto">
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
                <Text preset="heading" text="Wallet recovery" style={{color: headerTitle, zIndex: 10}} />
            </View>
            <View style={$contentContainer}>                
                <Card
                    style={$card}
                    ContentComponent={
                        <ListItem
                            tx="recovery.mnemonicCollision"
                            subTx="recovery.mnemonicCollisionDesc"
                            leftIcon='faTriangleExclamation'
                            // leftIconColor='red'                  
                            style={$item}                    
                            bottomSeparator={true}
                        /> 
                    }
                    FooterComponent={
                        <View style={$buttonContainer}>               
                            <Button
                                onPress={onBack}
                                tx='common.back'
                                preset='secondary'                      
                            />                        
                        </View>                    
                    }          
                />
            </View>
        </Screen>
      )
  } else {
    return (
      <Screen contentContainerStyle={$screen} preset="scroll">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            <Text 
              preset="heading" 
              text={isAddressOnlyRecovery ? "Recover address" : "Import backup"} 
              style={{color: headerTitle, textAlign: 'center'}}               
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
            {isValidMnemonic && !isValidBackup && !isAddressOnlyRecovery && (
                <Card
                    style={$card}
                    ContentComponent={
                        <ListItem
                            text="Insert wallet backup"
                            subText={'Paste the backup exported from previous wallet.'}
                            LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='2'/></View>}                  
                            style={$item}                            
                        /> 
                    }
                    FooterComponent={
                        <>
                        <TextInput
                            ref={backupInputRef}
                            onChangeText={(backup: string) => setBackup(backup)}
                            value={backup}
                            numberOfLines={3}
                            multiline={true}
                            autoCapitalize='none'
                            keyboardType='default'                            
                            placeholder={'Paste your backup'}
                            selectTextOnFocus={true}                    
                            style={[$backupInput, {backgroundColor: inputBg, flexWrap: 'wrap'}]}
                        />
                        <View style={$buttonContainer}>
                            {backup ? (
                                <Button
                                    onPress={onConfirmBackup}
                                    tx='common.confirm'                        
                                />
                            ) : (
                                <Button
                                    onPress={onPasteBackup}
                                    tx='common.paste'                        
                                />
                            )
                        }                    
                        </View>
                        </>
                    }           
                />
            )}
            {isValidMnemonic && isValidBackup && !isAddressOnlyRecovery && (
                <Card
                    style={$card}
                    ContentComponent={
                        <ListItem
                            text='Wallet backup'
                            subText={`${backup.slice(0, 50)}...`}
                            subTextStyle={{fontFamily: typography.code?.normal}}
                            LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='2'/></View>}                  
                            style={$item}                            
                        /> 
                    }        
                />
            )}
            {isValidMnemonic && profileToRecover && (
              <Card
                style={$card}
                ContentComponent={
                    <ListItem
                        text={profileToRecover.nip05}
                        subTx="profileToRecoverDesc"
                        LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text={isAddressOnlyRecovery ? '2' : '3'}/></View>}
                        style={$item}                            
                    /> 
                  }        
              />
            )}
        </View>
        {isValidMnemonic && (
        <View style={$bottomContainer}>
            <View style={$buttonContainer}>
                {isAddressOnlyRecovery ? (
                  <>
                    {profileToRecover ? (
                      <Button                      
                      tx="recovery.completeCTA"
                        style={{marginRight: spacing.small}}
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
                          style={{marginRight: spacing.small}}
                          LeftAccessory={() => (
                            <Icon
                                icon='faCircleUser'                            
                                size={spacing.medium}                  
                            />
                          )}
                          onPress={onFindWalletAddress}                                       
                      />
                    )}                    
                  </>                  
                ) : (
                  <>
                    {isValidBackup && (
                      <Button                        
                        text={`Import wallet`}
                        LeftAccessory={() => (
                          <Icon
                              icon='faDownload'                            
                              size={spacing.medium}                  
                          />
                        )}
                        onPress={importWallet}                                               
                      />
                    )}
                  </>

                )}
                
            </View>            
        </View>    
        )} 
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.COMPLETED && (
                  <>
                    <ResultModalInfo
                      icon="faCheckCircle"
                      iconColor={colors.palette.success200}
                      title={translate("recovery.success")}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx='common.close'
                        onPress={toggleResultModal}
                      />
                    </View>
                  </>
                )}
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.ERROR && (
                  <>
                    <ResultModalInfo
                      icon="faTriangleExclamation"
                      iconColor={colors.palette.angry500}
                      title={translate("recovery.failed")}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx="showErrors"
                        //onPress={toggleErrorsModal}
                      />
                    </View>
                  </>
                )}
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.EXPIRED && (
                  <>
                    <ResultModalInfo
                      icon='faInfoCircle'
                      iconColor={colors.palette.neutral400}
                      title={translate("noEcashRecovered")}
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx='common.close'
                        onPress={toggleResultModal}
                      />
                    </View>
                  </>
                )}
            </>
          }
          onBackButtonPress={toggleResultModal}
          onBackdropPress={toggleResultModal}
        />             
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
        {isLoading && <Loading statusMessage={statusMessage} textStyle={{color: 'white'}} style={{backgroundColor: headerBg, opacity: 1}}/>}    
      </Screen>
    )
  }
})

const $screen: ViewStyle = {flex: 1}

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

const $indexContainer: TextStyle = {
    padding: spacing.small,
    alignItems: 'center',
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

const $backupInput: TextStyle = {
    //flex: 1,    
    borderRadius: spacing.small,    
    fontSize: 16,
    fontFamily: typography.code?.normal,
    padding: spacing.small,
    maxHeight: verticalScale(120),
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.small,
}

const $noteInput: TextStyle = {
    flex: 1,
    margin: spacing.small,
    borderRadius: spacing.extraSmall,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $bottomModal: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  alignSelf: 'center',
  //marginLeft: spacing.small,
}
