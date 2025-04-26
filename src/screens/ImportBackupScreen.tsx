import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {LayoutAnimation, Platform, ScrollView, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {validateMnemonic} from '@scure/bip39'
import { btoa, atob } from 'react-native-quick-base64'
import QuickCrypto from 'react-native-quick-crypto'
import { wordlist } from '@scure/bip39/wordlists/english'
import { mnemonicToSeedSync } from '@scure/bip39'
import {colors, spacing, typography, useThemeColor} from '../theme'
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
import { Database, KeyChain, log, MinibitsClient } from '../services'
import Clipboard from '@react-native-clipboard/clipboard'
import { rootStoreInstance, useStores } from '../models'
import {MnemonicInput} from './Recovery/MnemonicInput'
import { MINIBITS_MINT_URL, MINIBITS_NIP05_DOMAIN } from '@env'
import { delay } from '../utils/utils'
import { applySnapshot} from 'mobx-state-tree'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { WalletProfileRecord } from '../models/WalletProfileStore'
import { translate } from '../i18n'
import { ProofsStoreSnapshot } from '../models/ProofsStore'
import { MintsStoreSnapshot } from '../models/MintsStore'
import { ContactsStoreSnapshot } from '../models/ContactsStore'
import { CashuMint, MintActiveKeys } from '@cashu/cashu-ts'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

type Props = StaticScreenProps<undefined>

export const ImportBackupScreen = observer(function ImportBackupScreen({ route }: Props) {
    const navigation = useNavigation()

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
        contactsStore, 
        walletProfileStore, 
        walletStore
    } = useStores()
    
    const mnemonicInputRef = useRef<TextInput>(null)
    const backupInputRef = useRef<TextInput>(null)
    const seedRef = useRef<Uint8Array | null>(null)
    const seedHashRef = useRef<string | null>(null)
    
    const [info, setInfo] = useState('')    
    const [mnemonicExists, setMnemonicExists] = useState(false)
    const [mnemonic, setMnemonic] = useState<string>('')    
    const [isValidMnemonic, setIsValidMnemonic] = useState(false)
    const [isNewProfileNeeded, setIsNewProfileNeeded] = useState(false)     
    const [backup, setBackup] = useState<string>('')
    const [isValidBackup, setIsValidBackup] = useState(false)    
    const [walletSnapshot, setWalletSnapshot] = useState<{
      proofsStore: ProofsStoreSnapshot,
      mintsStore: MintsStoreSnapshot,
      contactsStore: ContactsStoreSnapshot,      
    } | undefined>(undefined) // type tbd
    const [profileToRecover, setProfileToRecover] = useState<WalletProfileRecord | undefined>(undefined)
    const [isLoading, setIsLoading] = useState(false)    
    const [error, setError] = useState<AppError | undefined>()        
    const [statusMessage, setStatusMessage] = useState<string>()

    useEffect(() => {
        const getMnemonic = async () => {  
            try {                
                const existing = await KeyChain.getWalletKeys()
                if(existing && existing.SEED.mnemonic) {
                    setMnemonicExists(true)
                }                
            } catch (e: any) {                
                handleError(e)
            } 
        }
        getMnemonic()
    }, [])


    const onBack = () => {
        navigation.goBack()
    }

    
    const onConfirmMnemonic = async function () {
        try {
            if(!mnemonic) {
                throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicError'))
            }

            LayoutAnimation.easeInEaseOut()            

            if (!validateMnemonic(mnemonic, wordlist)) {
                throw new AppError(Err.VALIDATION_ERROR, translate("recoveryInvalidMnemonicError"))
            }

            setIsValidMnemonic(true)
            
            const binarySeed = mnemonicToSeedSync(mnemonic)            

            const seedHash = QuickCrypto.createHash('sha256')
            .update(binarySeed)
            .digest('hex')

            seedRef.current = binarySeed
            seedHashRef.current = seedHash
            
            const profile = await MinibitsClient.getWalletProfileBySeedHash(seedHash as string) // throws if not found
          
            log.info('[onCheckWalletAddress] profileToRecover', {profile})                
  
            if(profile.nip05.includes(MINIBITS_NIP05_DOMAIN)) {                                    
                setProfileToRecover(profile)
            } else {
                setInfo(translate("recovery.ownKeysImportAgain", { addr: profile.nip05 }))
                setIsNewProfileNeeded(true)              
            }            
        } catch (e: any) {
          // Profile with provided seed hash does not exists
          if(e.name === Err.NOTFOUND_ERROR) {
            setIsNewProfileNeeded(true)
          } else {
            handleError(e)
          }
        }
    }

    
    const onPasteBackup = async function () {
        try {
            setStatusMessage('Inserting backup...')
            setIsLoading(true)
            const maybeBackup = await Clipboard.getString()

            if(!maybeBackup) {
                throw new AppError(Err.VALIDATION_ERROR, 'Copy and paste the wallet backup.')
            }

            const cleaned = maybeBackup.trim()
            
            setBackup(cleaned)
            setStatusMessage('')
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    
    const getWalletSnapshot = function () {
      try {
            if(!backup.startsWith('minibitsA')) {
                throw new Error('Minibits backup needs to start with minibitsA.')
            }

            // decode
            const decoded = atob(backup.substring(9))
            
            // try to load as json
            const snapshot = JSON.parse(decoded) as {
                proofsStore: ProofsStoreSnapshot,
                mintsStore: MintsStoreSnapshot,
                contactsStore: ContactsStoreSnapshot,            
            }
          
          if(!snapshot.proofsStore || !snapshot.mintsStore || !snapshot.contactsStore) {
            throw new Error('Wrong backup format.')
          }

          return snapshot
      } catch (e: any) {        
        throw new AppError(Err.VALIDATION_ERROR, `Invalid backup: ${e.message}`)
      }
    }

    
    const onConfirmBackup = async function () {
      try {
          if(!backup) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing backup.')
          }

          LayoutAnimation.easeInEaseOut()    

          const snapshot = getWalletSnapshot() // throws

          setWalletSnapshot(snapshot)
          setIsValidBackup(true)          
      } catch (e: any) {
        handleError(e)
      }
    }

    
    const importWallet = async function () {
      try {
        if(!walletSnapshot) {
          throw new AppError(Err.VALIDATION_ERROR, 'Missing wallet spnapshot decoded from backup.')
        }

        setStatusMessage(translate("recovery.starting"))
        setIsLoading(true)        
      
        // import wallet snapshot into the state        
        // const rootStore = rootStoreInstance

        // hydrate mint keys back to the backup as they are stripped from backup
        for (const mint of walletSnapshot.mintsStore.mints) {
          const cashuMint = new CashuMint(mint.mintUrl)
          const keysResult: MintActiveKeys = await cashuMint.getKeys()
          const {keysets: keys} = keysResult

          for(const key of keys) {
            if(!key.unit) {
                key.unit = 'sat'
            }

            log.trace('[importWallet] Hydrating keys for', {keysetId: key.id})
            mint.keys.push(key)                    
          }
        }
  
        applySnapshot(proofsStore, walletSnapshot.proofsStore)
        applySnapshot(mintsStore, walletSnapshot.mintsStore)
        applySnapshot(contactsStore, walletSnapshot.contactsStore)        

        // log.trace('After import', {rootStore})        
        const rootStore = rootStoreInstance
        log.trace('After import and mint keys hydration', {mintsStore})

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
        
        await onCompleteAddress()

      } catch (e: any) {
        handleError(e)
      }               
    }

    
    const onCompleteAddress = async () => {
        try {
            if(!seedHashRef.current || !seedRef.current) {
              throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicOrSeedError'))
            }
            // create a new walletId and Nostr key pair after a new install or factory reset
            // and keep provided seed
            setIsLoading(true)
            setStatusMessage(translate("recovery.recoveringAddress"))

            const keys = KeyChain.generateWalletKeys()
            // Set seed to the provided one
            const seed = {
              seed: Buffer.from(seedRef.current).toString('base64'),
              seedHash: seedHashRef.current,
              mnemonic
            }

            keys.SEED = seed      
            
            if(isNewProfileNeeded) {
                
                await walletProfileStore.create(
                  keys.NOSTR.publicKey, 
                  keys.walletId, 
                  seedHashRef.current
                )                
                
            } else {
                // In case of recovery from backup we link new pubkey and new walletId to the profile
                // with user provided seedHash                
                await walletProfileStore.recover(
                  keys.NOSTR.publicKey,
                  keys.walletId, 
                  seedHashRef.current,
                )
            }

            await KeyChain.saveWalletKeys(keys)            
            walletStore.cleanCachedWalletKeys()
            // force publish now that we have keys available
            await walletProfileStore.publishToRelays()
            userSettingsStore.setIsOnboarded(true)

            if(!mintsStore.mintExists(MINIBITS_MINT_URL)) {
                await mintsStore.addMint(MINIBITS_MINT_URL)            
            }

            setStatusMessage(translate('recovery.completed'))
                        
            // go directly to the wallet (profile hase been rehydrated from the one with the seed)
            // @ts-ignore
            navigation.navigate('Tabs')
            await delay(1000)
            setStatusMessage('')
            setIsLoading(false)       
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
    const inputText = useThemeColor('text')
    const inputBg = useThemeColor('background')
    const loadingBg = useThemeColor('background')
    const headerTitle = useThemeColor('headerTitle')
    const placeholderTextColor = useThemeColor('textDim')

    if(mnemonicExists) {
      return (
        <Screen contentContainerStyle={$screen} preset="fixed">
            <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
                <Text preset="heading" text="Wallet recovery" style={{color: headerTitle, zIndex: 10}} />
            </View>
            <ScrollView style={$contentContainer}>                
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
            </ScrollView>            
        </Screen>
      )
  } else {
    return (
      <Screen contentContainerStyle={$screen} preset="fixed">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            <Text 
              preset="heading" 
              text={"Import backup"} 
              style={{color: headerTitle, textAlign: 'center'}}               
            />
        </View>
        <ScrollView style={$contentContainer}>            
            <MnemonicInput   
                ref={mnemonicInputRef}             
                mnemonic={mnemonic}
                isValidMnemonic={isValidMnemonic}
                setMnemonic={setMnemonic}
                onConfirm={onConfirmMnemonic}
                onError={handleError}
            />
            {isValidMnemonic && !isValidBackup && (
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
                            placeholderTextColor={placeholderTextColor}
                            selectTextOnFocus={true}                    
                            style={[$backupInput, {backgroundColor: inputBg, flexWrap: 'wrap', color: inputText}]}
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
            {isValidMnemonic && isValidBackup && (
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
            {isValidMnemonic && isValidBackup && profileToRecover && (
              <Card
                style={$card}
                ContentComponent={
                    <ListItem
                        text={profileToRecover.nip05}
                        subTx="profileToRecoverDesc"
                        LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text={'3'}/></View>}
                        style={$item}                            
                    /> 
                  }        
              />
            )}
            {isValidMnemonic && isValidBackup && isNewProfileNeeded && (
              <Card
                style={$card}
                ContentComponent={
                    <ListItem
                        text={'Wallet address not found'}
                        subText="Wallet profile linked to the provided seed not found, new one will be created for you."
                        LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text={'3'}/></View>}
                        style={$item}                            
                    /> 
                  }        
              />
            )}
        </ScrollView>
        {isValidMnemonic && (
        <View style={$bottomContainer}>
            <View style={$buttonContainer}>                
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
            </View>            
        </View>    
        )}           
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
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.15,
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
