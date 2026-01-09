import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {LayoutAnimation, Platform, ScrollView, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {validateMnemonic} from '@scure/bip39'
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
  Header,  
} from '../components'
import AppError, { Err } from '../utils/AppError'
import { Database, KeyChain, log, MinibitsClient } from '../services'
import Clipboard from '@react-native-clipboard/clipboard'
import { rootStoreInstance, useStores } from '../models'
import {MnemonicInput} from './Recovery/MnemonicInput'
import { MINIBITS_MINT_URL } from '@env'
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
import { Proof } from '../models/Proof'

type Props = StaticScreenProps<undefined>

export const ImportBackupScreen = observer(function ImportBackupScreen({ route }: Props) {
    const navigation = useNavigation()
    const {
        mintsStore, 
        proofsStore, 
        contactsStore, 
        walletProfileStore, 
        walletStore,
        authStore
    } = useStores()
    
    const mnemonicInputRef = useRef<TextInput>(null)
    const backupInputRef = useRef<TextInput>(null)
    const seedRef = useRef<Uint8Array | null>(null)
    const seedHashRef = useRef<string | null>(null)
    
    const [info, setInfo] = useState('')        
    const [mnemonic, setMnemonic] = useState<string>('')    
    const [isValidMnemonic, setIsValidMnemonic] = useState(false)      
    const [backup, setBackup] = useState<string>('')
    const [isValidBackup, setIsValidBackup] = useState(false)    
    const [walletSnapshot, setWalletSnapshot] = useState<{
      proofsStore: {proofs: Proof[], pendingByMintSecrets: string[]},
      mintsStore: MintsStoreSnapshot,
      contactsStore: ContactsStoreSnapshot,      
    } | undefined>(undefined) // type tbd
    const [isLoading, setIsLoading] = useState(false)    
    const [error, setError] = useState<AppError | undefined>()        
    const [statusMessage, setStatusMessage] = useState<string>()


    const onBack = () => {
        navigation.goBack()
    }

    
    const onConfirmMnemonic = async function () {
      try {
          if(!mnemonic) {
              throw new AppError(Err.VALIDATION_ERROR, translate('backupMissingMnemonicError'))
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
          
      } catch (e: any) {
          handleError(e)
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
                proofsStore: {proofs: Proof[], pendingByMintSecrets: string[]},
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
          if(!backup || !seedHashRef.current) {
            throw new AppError(Err.VALIDATION_ERROR, 'Missing backup or seed.')
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

        setStatusMessage(translate("recovery_starting"))
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
  
        // applySnapshot(proofsStore, walletSnapshot.proofsStore)
        proofsStore.importProofs(walletSnapshot.proofsStore.proofs)
        for(const secret of walletSnapshot.proofsStore.pendingByMintSecrets) {
          proofsStore.pendingByMintSecrets.push(secret)
        }
        applySnapshot(mintsStore, walletSnapshot.mintsStore)
        applySnapshot(contactsStore, walletSnapshot.contactsStore)        

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
            throw new AppError(Err.VALIDATION_ERROR, translate('backupMissingMnemonicOrSeedError'))
          }
          // create a new walletId and a new Nostr key pair
          // and keep provided seed
          setIsLoading(true)
          setStatusMessage(translate("recovery_recoveringAddress"))

          const keys = await walletStore.getCachedWalletKeys()
          // Set seed to the provided one
          const seed = {
            seed: Buffer.from(seedRef.current).toString('base64'),
            seedHash: seedHashRef.current,
            mnemonic
          }

          // In case there is a profile linked to provided seedHash,
          // it's address, avatar and seed is recovered to the current profile.
          await walletProfileStore.recover(
              keys.walletId, 
              seedHashRef.current,
          )

          // update seed to the provided one
          const keysCopy = { ...keys }
          keysCopy.SEED = seed

          await KeyChain.saveWalletKeys(keysCopy)            
          walletStore.cleanCachedWalletKeys()

          if(!mintsStore.mintExists(MINIBITS_MINT_URL)) {
              await mintsStore.addMint(MINIBITS_MINT_URL)            
          }

          setStatusMessage(translate('recovery_completed'))
                      
          // go directly to the wallet (profile hase been rehydrated from the one with the seed)
          //@ts-ignore
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

    return (
      <Screen contentContainerStyle={$screen} preset="fixed">
        <Header                
            leftIcon='faArrowLeft'
            onLeftPress={() => onBack()}                            
        /> 
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
                            tx="importBackupInsertWalletBackup"
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
                                    tx='commonConfirm'                        
                                />
                            ) : (
                                <Button
                                    onPress={onPasteBackup}
                                    tx='commonPaste'                        
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
            {isValidMnemonic && isValidBackup && (
              <Card
                style={$card}
                ContentComponent={
                    <ListItem
                        text={'Wallet profile recovery'}
                        subText="While importing the wallet we'll try to recover wallet address and avatar linked to the provided seed."
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
