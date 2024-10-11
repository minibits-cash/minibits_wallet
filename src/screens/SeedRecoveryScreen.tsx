import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {FlatList, LayoutAnimation, Platform, Pressable, Switch, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {validateMnemonic} from '@scure/bip39'
import QuickCrypto from 'react-native-quick-crypto'
import { wordlist } from '@scure/bip39/wordlists/english'
import {colors, spacing, useThemeColor} from '../theme'
import {AppStackScreenProps} from '../navigation' // @demo remove-current-line
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
  $sizeStyles,
} from '../components'
import {useHeader} from '../utils/useHeader'
import AppError, { Err } from '../utils/AppError'
import { KeyChain, log, MinibitsClient, NostrClient } from '../services'
import Clipboard from '@react-native-clipboard/clipboard'
import { useStores } from '../models'
import { MintListItem } from './Mints/MintListItem'
import { Mint } from '../models/Mint'
import { MintKeyset } from '@cashu/cashu-ts'
import { CashuUtils } from '../services/cashu/cashuUtils'
import { Proof } from '../models/Proof'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../models/Transaction'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { deriveSeedFromMnemonic } from '@cashu/cashu-ts'
import { MINIBITS_MINT_URL, MINIBITS_NIP05_DOMAIN } from '@env'
import { delay } from '../utils/utils'
import { getSnapshot, isStateTreeNode } from 'mobx-state-tree'
import { scale } from '@gocodingnow/rn-size-matters'
import { WalletUtils } from '../services/wallet/utils'
import { WalletScreen } from './WalletScreen'
import { MintUnit, formatCurrency, getCurrency } from '../services/wallet/currency'
import { isObj } from '@cashu/cashu-ts/src/utils'
import { WalletProfileRecord } from '../models/WalletProfileStore'
import { translate } from '../i18n'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

const RESTORE_INDEX_INTERVAL = 50

export const SeedRecoveryScreen: FC<AppStackScreenProps<'SeedRecovery'>> = observer(function SeedRecoveryScreen(_props) {
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
        walletProfileStore, 
        walletStore
    } = useStores()
    
    const mnemonicInputRef = useRef<TextInput>(null)
    const indexInputRef = useRef<TextInput>(null)

    const [info, setInfo] = useState('')    
    const [mnemonic, setMnemonic] = useState<string>('')        
    const [mnemonicExists, setMnemonicExists] = useState(false)
    const [isValidMnemonic, setIsValidMnemonic] = useState(false)
    const [seed, setSeed] = useState<Uint8Array>()    
    const [selectedMintUrl, setSelectedMintUrl] = useState<string | undefined>()
    const [selectedKeyset, setSelectedKeyset] = useState<MintKeyset | undefined>()
    const [selectedMintKeysets, setSelectedMintKeysets] = useState<MintKeyset[]>([])
    const [startIndexString, setStartIndexString] = useState<string>('0')
    const [startIndex, setStartIndex] = useState<number>(0) // start of interval of indexes of proofs to recover
    const [endIndex, setEndIndex] = useState<number>(RESTORE_INDEX_INTERVAL) // end of interval
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [isErrorsModalVisible, setIsErrorsModalVisible] = useState(false)
    const [isIndexModalVisible, setIsIndexModalVisible] = useState(false)
    const [isKeysetModalVisible, setIsKeysetModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, message: string} | undefined>()
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [lastRecoveredAmount, setLastRecoveredAmount] = useState<number>(0)
    const [totalRecoveredAmount, setTotalRecoveredAmount] = useState<number>(0)
    const [recoveryErrors, setRecoveryErrors] = useState<AppError[]>([])
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


    const toggleErrorsModal = () => {
        setIsErrorsModalVisible(previousState => !previousState)
    }


    const onPaste = async function () {
        try {
            const maybeMnemonic = await Clipboard.getString()

            if(!maybeMnemonic) {
              throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicError'))
            }

            const cleanedMnemonic = maybeMnemonic.replace(/\s+/g, ' ').trim()

            setMnemonic(cleanedMnemonic)
        } catch (e: any) {
            handleError(e)
        }
    }


    const onConfirm = async function () {
        try {
            if(!mnemonic) {
              throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicError'))
            }           

            if (!validateMnemonic(mnemonic, wordlist)) {
              throw new AppError(Err.VALIDATION_ERROR, translate("recoveryInvalidMnemonicError"))
            }
            
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)            

            const start = performance.now()
            const binarySeed = deriveSeedFromMnemonic(mnemonic)
            const end = performance.now()
            console.log(`[onConfirm] deriveSeedFromMnemonic took ${end - start} ms.`)
    
            setSeed(binarySeed)
            setIsValidMnemonic(true)            
        } catch (e: any) {
          handleError(e)
        }
    }

    const onBack = function (): void {
        return navigation.goBack()
    }


    const onAddMints = function (): void {
        return navigation.navigate('Mints', {})
    }


    const onMintSelect = async function (mint: Mint) {
        try {
            setSelectedMintUrl(mint.mintUrl)
            const allKeysets = getSnapshot(mint.keysets!)
            const defaultKeyset = walletStore.getOptimalKeyset(mint, 'sat')
         
            setSelectedKeyset(defaultKeyset)
            setSelectedMintKeysets(allKeysets)
            setStartIndex(0)
            setEndIndex(RESTORE_INDEX_INTERVAL)
        } catch (e: any) {
            handleError(e)
        }
    }

    const toggleIndexModal = () => {
        setIsIndexModalVisible(previousState => !previousState)
    }


    const toggleKeysetModal = () => {
        setIsKeysetModalVisible(previousState => !previousState)
    }


    const onResetStartIndex = function () {
        setStartIndex(parseInt(startIndexString))
        setEndIndex(parseInt(startIndexString) + RESTORE_INDEX_INTERVAL)
        toggleIndexModal()
    }

    
    const startRecovery = async function () {
        if(!selectedMintUrl) {
          setInfo(translate("recovery.selectMintFrom"))
          return
        }
        setStatusMessage(translate("recovery.starting"))
        setIsLoading(true)        
        setTimeout(() => doRecovery(), 100)        
    }

    const doRecovery = async function () {        
        let errors: AppError[] = []
        let recoveredAmount: number = 0
        let alreadySpentAmount: number = 0        
        
        const transactionData: TransactionData[] = []            
        let transaction: Transaction | undefined = undefined

        const pendingTransactionData: TransactionData[] = []
        let pendingTransaction: Transaction | undefined = undefined
        let recoveredMint = mintsStore.findByUrl(selectedMintUrl as string)

        try {
            if(!recoveredMint) {                
              setInfo(translate("recovery.noMintSelected"))
              return
            }

            if(!selectedKeyset) {                
              setInfo(translate("recovery.noKeysetSelected"))
              return
            }
            
            setStatusMessage(translate("recovery.restoringFromParam", { hostname: recoveredMint.hostname }))
            log.info('[restore]', `Restoring from ${recoveredMint.hostname}...`)
            
            const { proofs } = await walletStore.restore(
                recoveredMint.mintUrl, 
                seed as Uint8Array,
                {
                    indexFrom: startIndex, 
                    indexTo: endIndex,                    
                    keysetId: selectedKeyset.id as string
                }                
            )

            //log.debug('[restore]', `Restored proofs`, proofs.length)                
            setStatusMessage(translate("recovery.foundProofsAmount", { amount: proofs.length }))
            
            if (proofs.length > 0) {
                // need to move counter by whole interval to avoid duplicate _B!!!
                const proofsCounter = recoveredMint.getProofsCounterByKeysetId(selectedKeyset.id)                
                proofsCounter?.increaseProofsCounter(Math.abs(endIndex - startIndex))
                
                const {spent, pending} = await walletStore.getSpentOrPendingProofsFromMint(
                    recoveredMint.mintUrl,
                    selectedKeyset.unit as MintUnit,
                    proofs as Proof[],
                )

                log.debug('[restore]', `Spent and pending proofs`, {spent: spent.length, pending: pending.length})

                setStatusMessage(translate("recovery.spentProofsAmount", { amount: spent.length }))

                const spentAmount = CashuUtils.getProofsAmount(spent as Proof[])
                alreadySpentAmount += spentAmount

                const unspent = proofs.filter((proof: Proof) => !spent.includes(proof))
                
                if(unspent && unspent.length > 0) {
                    
                    setStatusMessage(translate("recovery.completing"))

                    const amount = CashuUtils.getProofsAmount(unspent as Proof[])
                    recoveredAmount = amount                 
                    
                    // Let's create new draft receive transaction in database
                    transactionData.push({
                        status: TransactionStatus.PREPARED,
                        amount,
                        createdAt: new Date(),
                    })

                    const newTransaction = {
                        type: TransactionType.RECEIVE,
                        amount,
                        fee: 0,
                        unit: selectedKeyset.unit as MintUnit,
                        data: JSON.stringify(transactionData),
                        memo: 'Wallet recovery from seed',
                        mint: recoveredMint.mintUrl,
                        status: TransactionStatus.PREPARED,
                    }

                    transaction = await transactionsStore.addTransaction(newTransaction)                    

                    const { amountToAdd, addedAmount } = WalletUtils.addCashuProofs(
                        recoveredMint.mintUrl,
                        unspent,
                        {
                            unit: selectedKeyset.unit as MintUnit,
                            transactionId: transaction.id,
                            isPending: false
                        }            
                    )                 

                    if (amountToAdd !== addedAmount) {
                        transaction.setReceivedAmount(addedAmount)
                        recoveredAmount = addedAmount
                    }

                    // Finally, update completed transaction
                    transactionData.push({
                        status: TransactionStatus.COMPLETED,
                        recoveredAmount,                       
                        createdAt: new Date(),
                    })

                    transaction.setStatus(                        
                        TransactionStatus.COMPLETED,
                        JSON.stringify(transactionData),
                    )

                    const balanceAfter = proofsStore.getUnitBalance(selectedKeyset.unit as MintUnit)?.unitBalance
                    transaction.setBalanceAfter(balanceAfter || 0)
                }
            
                if(pending && pending.length > 0) {

                    // setStatusMessage(`Found ${pending.length} pending proofs...`)
                    setStatusMessage(translate("recovery.foundPendingProofsAmount", { amount: pending.length }))
                    log.debug(`Found pending ecash with ${recoveredMint.hostname}...`)

                    const amount = CashuUtils.getProofsAmount(pending as Proof[])
                    
                    // Let's create new draft receive transaction in database
                    pendingTransactionData.push({
                        status: TransactionStatus.PREPARED,
                        amount,
                        createdAt: new Date(),
                    })

                    const newTransaction = {
                        type: TransactionType.RECEIVE,
                        amount,
                        fee: 0,
                        unit: selectedKeyset?.unit as MintUnit,
                        data: JSON.stringify(pendingTransactionData),
                        memo: 'Wallet recovery - pending',
                        mint: recoveredMint.mintUrl,
                        status: TransactionStatus.PREPARED,
                    }

                    pendingTransaction = await transactionsStore.addTransaction(newTransaction)

                    const { amountToAdd, addedAmount } = WalletUtils.addCashuProofs(
                        recoveredMint.mintUrl,
                        pending,
                        {
                            unit: selectedKeyset?.unit as MintUnit,
                            transactionId: pendingTransaction.id,
                            isPending: true
                        }            
                    )

                    if (amountToAdd !== addedAmount) {
                        pendingTransaction.setReceivedAmount(addedAmount)
                    }

                    // Finally, update pending transaction
                    pendingTransactionData.push({
                        status: TransactionStatus.PENDING,                        
                        createdAt: new Date(),
                    })

                    pendingTransaction.setStatus(                        
                        TransactionStatus.PENDING,
                        JSON.stringify(pendingTransactionData),
                    )
                }
            }

        } catch(e: any) {
            
            if (selectedMintUrl) {
                e.params = {mintUrl: selectedMintUrl}
            }

            log.error('[doRecovery]', {name: e.name, message: isObj(e.message) ? JSON.stringify(e.message) : e.message, params: e.params})
            errors.push({name: e.name, message: e.message}) // TODO this could now be single error as we do not loop anymore

            if (transaction) {
                transactionData.push({
                    status: TransactionStatus.ERROR,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date(),
                })

                transaction.setStatus(                    
                    TransactionStatus.ERROR,
                    JSON.stringify(transactionData),
                )
            }

            if (pendingTransaction) {
                pendingTransactionData.push({
                    status: TransactionStatus.ERROR,
                    error: WalletUtils.formatError(e),
                    createdAt: new Date(),
                })

                pendingTransaction.setStatus(                    
                    TransactionStatus.ERROR,
                    JSON.stringify(pendingTransactionData),
                )
            }
            setStatusMessage(undefined)                
        }
        

        setLastRecoveredAmount(recoveredAmount)
        setTotalRecoveredAmount(prevTotalRecoveredAmount => prevTotalRecoveredAmount + recoveredAmount)
        setStartIndex(startIndex + RESTORE_INDEX_INTERVAL)
        setEndIndex(endIndex + RESTORE_INDEX_INTERVAL)       
        setStatusMessage(undefined)
        setIsLoading(false)

        if(recoveredAmount > 0) {
            const currency = getCurrency(selectedKeyset?.unit as MintUnit)
            setResultModalInfo({
                status: TransactionStatus.COMPLETED, 
                message: translate("recovery.recoveredResult", { 
                  formattedCurrency: formatCurrency(recoveredAmount, currency.code),
                  code: currency.code
                })
            })
        } else {
            if(errors.length > 0) {
                setResultModalInfo({
                    status: TransactionStatus.ERROR, 
                    message: translate("recovery.resultErrors")
                })            
                setRecoveryErrors(errors)
            } else {
                if(alreadySpentAmount > 0) {
                    setResultModalInfo({
                        status: TransactionStatus.EXPIRED, 
                        message: translate("recovery.resultSpent")
                    }) 
                } else {
                    setResultModalInfo({
                        status: TransactionStatus.EXPIRED, 
                        message: translate("recovery.resultExpired")
                    }) 
                }

            }
        }

        toggleResultModal() // open
    }
    


    const onComplete = async () => {
        try {
            if(!seed || !mnemonic) {
                throw new AppError(Err.VALIDATION_ERROR, translate('backupScreen.missingMnemonicOrSeedError'))
            }

            setStatusMessage(translate('recovery.recoveringAddress'))
            setIsLoading(true)

            const seedHash = QuickCrypto.createHash('sha256')
            .update(seed)
            .digest('hex')

            log.trace('[onComplete]', 'getWalletProfileBySeedHash')
            const profileToRecover = await MinibitsClient.getWalletProfileBySeedHash(seedHash as string)            

            // Skip external profiles beacause we do not control keys
            if(profileToRecover) {
                log.info('[onComplete] recovery', {profileToRecover})
                setStatusMessage(translate("recovery.foundAddrParam", { addr: profileToRecover.nip05 }))

                if(profileToRecover.nip05.includes(MINIBITS_NIP05_DOMAIN)) {                                    
                    const {publicKey: newPublicKey} = await NostrClient.getOrCreateKeyPair()
                    // Updates pubkey and imports wallet profile
                    await walletProfileStore.recover(seedHash as string, newPublicKey)
                    // Align walletId in userSettings with recovered profile
                    userSettingsStore.setWalletId(walletProfileStore.walletId)                    
                    
                    
                } else {
                  setInfo(translate("recovery.ownKeysImportAgain", { addr: profileToRecover.nip05 }))
                  await delay(4000)
                }
            }

            userSettingsStore.setIsOnboarded(true)
            await KeyChain.saveMnemonic(mnemonic)
            await KeyChain.saveSeed(seed as Uint8Array)

            if(!mintsStore.mintExists(MINIBITS_MINT_URL)) {
                await mintsStore.addMint(MINIBITS_MINT_URL)            
            }
            
            setStatusMessage(translate('recovery.completed'))
            await delay(2000)
            setStatusMessage('')
            setIsLoading(false)
            navigation.navigate('Tabs', {screen: 'WalletNavigator', params: {screen: 'Wallet', params: {}}})        
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

    if(mnemonicExists) {
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
            <Screen contentContainerStyle={$screen} preset="auto">
              <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
                  <Text preset="heading" text="Wallet recovery" style={{color: headerTitle, zIndex: 10}} />
              </View>
              <View style={$contentContainer}>            
                  <>
                  {isValidMnemonic ? (
                  <>
                      <Card
                          style={$card}
                          ContentComponent={
                              <ListItem
                                  tx='backupScreen.mnemonicTitle'
                                  subText={mnemonic}
                                  LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                                  style={$item}                            
                              /> 
                          }        
                      />                          
                      <Card
                          style={$card}
                          HeadingComponent={
                              <>
                              <ListItem
                                  tx="recoveryFromMints"
                                  subTx="recoveryFromMintsDesc"
                                  LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='2'/></View>} 
                                  RightComponent={mintsStore.mintCount > 0 ? (
                                      <View style={$rightContainer}>
                                          <Button
                                              onPress={onAddMints}
                                              text='Mints'
                                              preset='secondary'                                           
                                          /> 
                                      </View>
                                      ) : (undefined)        
                                  }                        
                                  style={$item}                            
                              />
                              {mintsStore.mintCount === 0 && (
                                  <View style={$buttonContainer}>
                                      <Button
                                          onPress={onAddMints}
                                          tx="addMints"
                                      /> 
                                  </View>
                              )}
                              </>
                          }
                          ContentComponent={
                              <>
                              {mintsStore.mints.map((mint: Mint, index: number) => (
                                  <MintListItem
                                  key={mint.mintUrl}
                                  mint={mint}
                                  mintBalance={proofsStore.getMintBalance(mint.mintUrl)}
                                  onMintSelect={() => onMintSelect(mint)}
                                  isSelectable={true}
                                  isSelected={selectedMintUrl === mint.mintUrl}                                  
                                  separator={index === 0 ? 'both' : 'bottom'}
                                  />
                              ))}
                              </>
                          }
                          FooterComponent={
                              <>
                                  {mintsStore.mintCount > 0 && selectedMintUrl && (
                                  <>
                                      <View style={$buttonContainer}>               
                                          <Button
                                              onPress={startRecovery}
                                              tx={startIndex === 0 ? 'startRecovery' : 'nextInterval'}
                                              preset={(startIndex === 0 ||  totalRecoveredAmount > 0) ? 'default' : 'secondary'}
                                              style={{marginRight: spacing.small}}
                                              disabled={selectedMintUrl ? false : true}    
                                          />
                                          {(startIndex > 0 || totalRecoveredAmount > 0) && (
                                              <Button
                                                  onPress={onComplete}
                                                  tx="common.complete"                                                        
                                                  preset='secondary'                                        
                                              />
                                          )} 
                                      </View>
      
                                      <View style={$buttonContainer}>
                                      <Text 
                                          text={translate("recovery.intervalParam", { 
                                              startIndex: startIndex,
                                              endIndex: endIndex
                                          })} 
                                          size='xxs' 
                                          style={{color: textHint, alignSelf: 'center', marginTop: spacing.small}}
                                      />
                                      <Pressable onPress={toggleIndexModal}>
                                          <Text 
                                              tx="recovery.setManually"
                                              size='xxs' 
                                              style={{color: textHint, alignSelf: 'center', marginTop: spacing.small}}
                                          />  
                                      </Pressable>                                    
                                      </View>
                                      <View style={[$buttonContainer,{marginTop: 0}]}>
                                      <Text 
                                          text={translate("recovery.keysetID", { 
                                              id: selectedKeyset?.id,
                                              unit: selectedKeyset?.unit  
                                          })}
                                          size='xxs' 
                                          style={{color: textHint, alignSelf: 'center', marginTop: spacing.extraSmall}}
                                      />
                                      {selectedMintKeysets.length > 1 && (
                                          <Pressable onPress={toggleKeysetModal}>
                                              <Text 
                                                  tx="recovery.selectAnotherKeyset"
                                                  size='xxs' 
                                                  style={{color: textHint, alignSelf: 'center', marginTop: spacing.extraSmall}}
                                              />  
                                          </Pressable> 
                                      )}                                                                       
                                      </View>
                                  </>  
                                  )}
                                  {mintsStore.mintCount > 0 && !selectedMintUrl && (
                                      <Text 
                                          tx='recovery.selectMintFrom'
                                          size='xxs' 
                                          style={{color: textHint, alignSelf: 'center', margin: spacing.large}}
                                      />
                                  )}
                              </>   
                          }         
                      />                                                         
                  </>
                  ) : (
                      <Card
                          style={$card}
                          ContentComponent={
                              <ListItem
                                  tx="recoveryInsertMnemonic"
                                  subTx={'recoveryInsertMnemonicDesc'}
                                  LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                                  style={$item}                            
                              /> 
                          }
                          FooterComponent={
                              <>
                              <TextInput
                                  ref={mnemonicInputRef}
                                  onChangeText={(mnemonic: string) => setMnemonic(mnemonic)}
                                  value={mnemonic}
                                  numberOfLines={3}
                                  multiline={true}
                                  autoCapitalize='none'
                                  keyboardType='default'
                                  maxLength={150}
                                  placeholder={translate("mnemonicPhrasePlaceholder")}
                                  selectTextOnFocus={true}                    
                                  style={[$mnemonicInput, {backgroundColor: inputBg, flexWrap: 'wrap'}]}
                              />
                              <View style={$buttonContainer}>
                                  {mnemonic ? (
                                      <Button
                                          onPress={onConfirm}
                                          tx='common.confirm'                        
                                      />
                                  ) : (
                                      <Button
                                          onPress={onPaste}
                                          tx='common.paste'                        
                                      />
                                  )
                              }                    
                              </View>
                              </>
                          }           
                      />
                      )}                
                  </>
              </View>
              <BottomModal
                isVisible={isIndexModalVisible}
                ContentComponent={
                  <View style={$indexContainer}>
                      <Text tx="setStartIndex" preset="subheading" />
                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
                          <TextInput
                              ref={indexInputRef}
                              onChangeText={index => setStartIndexString(index)}
                              value={startIndexString}
                              style={[$noteInput, {backgroundColor: inputBg}]}
                              maxLength={8}
                              selectTextOnFocus={true}
                              keyboardType='numeric'
                              textAlign='right'
                          />
                          <Button
                              tx='common.save'
                              onPress={onResetStartIndex}
                          />
                      </View>
                      <Text 
                          tx="recovery.startIndexDesc"
                          size='xxs' 
                          style={{color: textHint, margin: spacing.small}}
                      />
                  </View>
                }
                onBackButtonPress={toggleIndexModal}
                onBackdropPress={toggleIndexModal}
              />
              <BottomModal
                isVisible={isKeysetModalVisible}
                // style={{alignItems: 'stretch'}} 
                HeadingComponent={<Text tx="recovery.selectKeyset" style={{textAlign: 'center', margin: spacing.small}}/>}
                ContentComponent={
                  <FlatList
                      data={selectedMintKeysets}
                      numColumns={2}
                      renderItem={({ item, index }) => {                                
                          return(
                              <Button
                                  key={index}
                                  preset={selectedKeyset?.id === item.id ? 'default' : 'secondary'}
                                  onPress={() => {
                                      setSelectedKeyset(item)
                                      setStartIndex(0)
                                      setEndIndex(RESTORE_INDEX_INTERVAL)
                                  }}
                                  text={`${item.id} (${item.unit})`}
                                  style={{minWidth: scale(80), margin: spacing.extraSmall}}
                                  textStyle={$sizeStyles.xxs}
                              />
                          )
                      }}
                      keyExtractor={(item) => item.id} 
                      style={{ flexGrow: 0  }}
                  />
                }
                FooterComponent={
                  <Button                
                      preset={'secondary'}
                      onPress={toggleKeysetModal}
                      tx='common.close'
                      style={{marginTop: spacing.small}}
                  />}
                onBackButtonPress={toggleKeysetModal}
                onBackdropPress={toggleKeysetModal}
              />
              <BottomModal
                isVisible={isErrorsModalVisible}
                style={{alignItems: 'stretch'}}          
                ContentComponent={
                  <>
                      {recoveryErrors?.map((err, index) => (
                              <ListItem
                                  key={index}
                                  leftIcon='faTriangleExclamation'
                                  leftIconColor={colors.palette.angry500}                       
                                  text={err.message}
                                  subText={err.params ? err.params.mintUrl : ''}
                                  bottomSeparator={true}
                                  style={{paddingHorizontal: spacing.small}}
                              />             
                          )
                      )}
                  </>
                }
                onBackButtonPress={toggleErrorsModal}
                onBackdropPress={toggleErrorsModal}
              />
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
                              onPress={toggleErrorsModal}
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

const $mnemonicInput: TextStyle = {
    // flex: 1,    
    borderRadius: spacing.small,    
    fontSize: 16,
    padding: spacing.small,
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
