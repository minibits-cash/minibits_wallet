import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  Switch,
  Alert,
} from 'react-native'
import {btoa, fromByteArray} from 'react-native-quick-base64'
import {useThemeColor, spacing, typography, colors} from '../theme'
import {
  Button,
  Icon,
  Screen,
  Text,
  Card,
  ListItem,
  ErrorModal,
  InfoModal,
  Loading,
  BottomModal,
} from '../components'
import {SettingsStackScreenProps} from '../navigation'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError from '../utils/AppError'
import { Proof } from '../models/Proof'
import { useStores } from '../models'
import EventEmitter from '../utils/eventEmitter'
import { CashuUtils, ProofV3, TokenV3 } from '../services/cashu/cashuUtils'
import Clipboard from '@react-native-clipboard/clipboard'
import { translate } from '../i18n'
import { ProofsStoreSnapshot } from '../models/ProofsStore'
import { getSnapshot } from 'mobx-state-tree'
import { ContactsStoreSnapshot } from '../models/ContactsStore'
import { MintsStoreSnapshot } from '../models/MintsStore'
import { Database, TransactionTaskResult, WalletTask, WalletTaskResult } from '../services'
import { Transaction, TransactionStatus } from '../models/Transaction'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { verticalScale } from '@gocodingnow/rn-size-matters'

interface ExportBackupScreenProps extends SettingsStackScreenProps<'ExportBackup'> {}

const OPTIMIZE_FROM_PROOFS_COUNT = 5

export const ExportBackupScreen: FC<ExportBackupScreenProps> =
    function ExportBackup(_props) {

    const { navigation } = _props
    const { 
        mintsStore, 
        contactsStore, 
        proofsStore 
    } = useStores()

    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => navigation.goBack(),
    })

    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [orphanedProofs, setOrphanedProofs] = useState<Proof[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isSendAllSentToQueue, setIsSendAllSentToQueue] = useState<boolean>(false)
    const [isReceiveBatchSentToQueue, setIsReceiveBatchSentToQueue] = useState<boolean>(false)
    const [totalProofsCount, setTotalProofsCount] = useState<number>(0)
    const [totalSentProofsCount, setTotalSentProofsCount] = useState<number>(0)
    const [totalReceiveErrorCount, setTotalReceiveErrorCount] = useState<number>(0)
    const [totalReceiveCompleteCount, setTotalReceiveCompleteCount] = useState<number>(0)
    const [isEcashInBackup, setIsEcashInBackup] = useState(true)
    const [isMintsInBackup, setIsMintsInBackup] = useState(true)
    const [isContactsInBackup, setIsContactsInBackup] = useState(true)
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus; title?: string, message: string} | undefined
    >()
    
    
    useEffect(() => {
        const loadProofs = async () => {            
            setIsLoading(true)
            try {
              // full refresh of proofs from DB in case the state is broken
              await proofsStore.loadProofsFromDatabase()
              
              const orphaned = proofsStore.allProofs.filter(proof => !proof.mintUrl)

              if (orphaned.length > 0) {                
                setOrphanedProofs(orphaned)
                setInfo(`Found ${orphaned.length} orphaned proofs not belonging to any active mint. Those won't be included to the backup, but you can copy them separately.`)
              }

              // log.trace('[loadProofs]', {refreshedProofs: proofsStore.proofs})
              setTotalProofsCount(proofsStore.proofsCount)
              setIsLoading(false)
            } catch (e: any) {
              handleError(e)
            }            
        }

        loadProofs()
        return () => {}
    }, [])


    useEffect(() => {
      const handleSendAllResult = async (result: TransactionTaskResult) => {
          log.trace('[handleSendAllResults] event handler triggered')

          if (!isSendAllSentToQueue) { return false }

          // runs per each mint and unit
          if (result.transaction && result.transaction.status === TransactionStatus.PENDING) {

            // now we batch receive the pending encoded token 
            // this forces the proofs swap with the mint for standard denomination amounts
            const encodedTokenToReceive: string = result.encodedTokenToSend
            const tokenToReceive = CashuUtils.decodeToken(encodedTokenToReceive)              
            const {totalAmount: tokenAmount} = CashuUtils.getTokenAmounts(tokenToReceive)  
            const proofsCount = tokenToReceive.token[0].proofs.length           

            setTotalSentProofsCount(prev => prev + proofsCount)
            setIsReceiveBatchSentToQueue(true)

            WalletTask.receiveBatch(
              tokenToReceive,
              tokenAmount,
              tokenToReceive.memo as string,
              encodedTokenToReceive
            )
          }       
      }
      
      if(isSendAllSentToQueue) {
        EventEmitter.on('ev_sendTask_result', handleSendAllResult)
      }  
      
      return () => {
        EventEmitter.off('ev_sendTask_result', handleSendAllResult)            
      }
  }, [isSendAllSentToQueue])



  useEffect(() => {
    // runs for every receive in a batch
    const handleReceiveTaskResult = async (result: TransactionTaskResult) => {
      log.trace('handleReceiveTaskResult event handler triggered')     
      
      const {error} = result       

      if (error) {
          setTotalReceiveErrorCount(prev => prev + 1)          
      } else {
          setTotalReceiveCompleteCount(prev => prev + 1)          
      }
    }
    
    if(isReceiveBatchSentToQueue) {
      EventEmitter.on('ev_receiveTask_result', handleReceiveTaskResult)      
    }

    return () => {
      EventEmitter.off('ev_receiveTask_result', handleReceiveTaskResult)            
    }

  }, [isReceiveBatchSentToQueue])


  useEffect(() => {
    // runs for every receive in a batch
    const showProofOptimizationResult = async () => {
      log.trace('handleReceiveTaskResult event handler triggered')
      
      setIsLoading(false)
        
      const currentProofsCount = proofsStore.proofsCount      

      let message = `Original proofs count: ${totalSentProofsCount}, Optimized proofs count: ${currentProofsCount}`

      if (totalReceiveErrorCount > 0) {
        message += `, Errors: ${totalReceiveErrorCount}`
      } 
      
      setResultModalInfo({
        status: totalReceiveErrorCount > 0 ? TransactionStatus.ERROR : TransactionStatus.COMPLETED,
        message,
      })

      setIsResultModalVisible(true)            
    }
    
    if(totalReceiveCompleteCount > 0 || totalReceiveErrorCount > 0) {
      showProofOptimizationResult()
    }    

  }, [totalReceiveErrorCount, totalReceiveCompleteCount])


    const toggleResultModal = () => {
        setIsResultModalVisible(previousState => !previousState)
        WalletTask.syncPendingStateWithMints()
    }
      
    

    const toggleBackupEcashSwitch = () =>
        setIsEcashInBackup(previousState => !previousState)

    
    const toggleBackupMintsSwitch = () =>
        setIsMintsInBackup(previousState => !previousState)

    
    const toggleBackupContanctsSwitch = () =>
        setIsContactsInBackup(previousState => !previousState)


    const optimizeProofAmountsStart = function () {
      Alert.alert(
        'Optimize ecash proofs',
        'Do you want to swap your wallet ecash for proofs with optimal denominations? The size of your backup will decrease.',
        [
          {
            text: translate('common.cancel'),
            style: 'cancel',
            onPress: () => { /* Action canceled */ },
          },
          {
            text: translate('common.confirm'),
            onPress: async () => {
              // Moves all wallet proofs to pending in transactions 
              // split by mints and by units and in offline mode.
              // Supports batching in case proofs count is above limit.
              setIsLoading(true)
              setIsSendAllSentToQueue(true)
              WalletTask.sendAll()
            },
          },
        ],
      )


    }
    
    const copyBackup = function () {
        try {     
            setIsLoading(true)  

            let exportedProofsStore: ProofsStoreSnapshot = {
                proofs: [], 
                pendingProofs: [], 
                pendingByMintSecrets: []
            }

            let exportedMintsStore: MintsStoreSnapshot = {
                mints: [], 
                blockedMintUrls: [], 
                counterBackups: []
            }

            let exportedContactsStore: ContactsStoreSnapshot = {
                contacts: [], 
                publicPubkey: undefined, 
                selectedContact: undefined, 
                receivedEventIds: [], 
                lastPendingReceivedCheck: undefined
            }            

            if(isEcashInBackup) {
              // proofsStore is emptied in snapshot postprocess!
              const proofsSnapshot = getSnapshot(proofsStore.proofs)

              // Do not include orphaned proofs as they can not be imported without mintUrl
              const cleaned = proofsSnapshot.filter(p => p.mintUrl && p.mintUrl.length > 0)

              exportedProofsStore = {
                proofs: cleaned,
                pendingProofs: getSnapshot(proofsStore.pendingProofs) || [],
                pendingByMintSecrets: getSnapshot(proofsStore.pendingByMintSecrets)
              }              
            }

            if(isMintsInBackup) {                
              exportedMintsStore = getSnapshot(mintsStore)
            }

            if(isContactsInBackup) {
              exportedContactsStore = getSnapshot(contactsStore)
            }

            const exportedSnapshot = {
              proofsStore: exportedProofsStore, 
              mintsStore: exportedMintsStore, 
              contactsStore: exportedContactsStore,
            }

            log.trace({exportedSnapshot})

            const base64Encoded = btoa(JSON.stringify(exportedSnapshot))            
            Clipboard.setString(base64Encoded)
            setIsLoading(false)  

        } catch (e: any) {
            setInfo(`Could not encode and copy wallet backup: ${e.message}`)
            setIsLoading(false)  
        }
    }


    const groupProofsByMint = function (proofs: Proof[]) {
      return proofs.reduce((acc: Record<string, Proof[]>, proof) => {
        
        const proofMint = CashuUtils.getMintFromProof(proof, mintsStore.allMints)
        // Check if there's already an array for this keyset, if not, create one
        if(!proofMint) {
          return acc
        }
  
        if (!acc[proofMint.mintUrl]) {
          acc[proofMint.mintUrl] = []
        }                 
        
        // Push the object into the array corresponding to its keyset
        acc[proofMint.mintUrl].push(proof)
        return acc
      }, {})
    }
  
    const groupProofsByKeysets = function (proofsByMint: Proof[]) {
      return proofsByMint.reduce((acc: Record<string, Proof[]>, proof) => {
        // Check if there's already an array for this keyset, if not, create one
        if (!acc[proof.id as string]) {
          acc[proof.id] = []
        }                 
        
        // Push the object into the array corresponding to its keyset
        acc[proof.id].push(proof)
        return acc;
      }, {})
    }


    const copyEncodedTokens = function () {
        try {
            setIsLoading(true)
            const encodedTokens: string[] = []

            if (mintsStore.allMints.length === 0) {
              setInfo(translate("missingMintsForProofsUserMessage"))
            }

            const groupedByMint = groupProofsByMint(proofsStore.proofs)

            for (const mint in groupedByMint) { 
              
              const proofsByMint = groupedByMint[mint]

              if(proofsByMint.length === 0) {
                continue
              }

              const groupedByKeyset = groupProofsByKeysets(proofsByMint)

              for (const keysetId in groupedByKeyset) {
                const proofsByKeysetId = groupedByKeyset[keysetId]
                const proofsToExport: ProofV3[] = []

                for (const p of proofsByKeysetId) {
                  // clean private params
                  const proofToExport: ProofV3 = {
                    id: p.id,
                    amount: p.amount,
                    secret: p.secret,
                    C: p.C
                  }

                  proofsToExport.push(proofToExport)
                }

                const tokenByKeysetId: TokenV3 = {
                  token: [
                      {
                          mint,
                          proofs: proofsToExport
                      }
                  ],
                  unit: proofsByKeysetId[0].unit
                }
                
                log.trace('[copyEncodedTokens]', {tokenByKeysetId})

                const encodedByMint = CashuUtils.encodeToken(tokenByKeysetId)
                encodedTokens.push(encodedByMint)                
              }
            }                       
            
            Clipboard.setString(JSON.stringify(encodedTokens))
            setIsLoading(false)

        } catch (e: any) {
            handleError(e)            
        }
    }


    const copyOrphanedProofs = function() {
      log.trace({orphanedProofs})
      if(orphanedProofs.length > 0) {
        Clipboard.setString(JSON.stringify(orphanedProofs))
      }      
    }


    /* const onRecovery = async function () {
      if (!showUnspentOnly) {
        setInfo(translate("unspentOnlyRecoverable"))
        return
      }

      const balances = proofsStore.getBalances()
      let message: string = ''

      const nonZeroBalances = balances.mintBalances.filter(b => Object.values(b.balances).some(b => b && b > 0))        
      
      log.trace('[onRecovery]', {nonZeroBalances})

      if (nonZeroBalances && nonZeroBalances.length > 0) {
          message = translate("backupWillOverwriteBalanceWarning")
          message += "\n\n"
      }

      message += translate("confirmBackupRecovery")

      Alert.alert(
        translate("attention"),
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
            text: translate("startRecovery"),
            onPress: () => {
              try {
                doLocalRecovery()
              } catch (e: any) {
                handleError(e)
              }
            },
          },
        ],
      )
    }


    const doLocalRecovery = async function () {
      try {
        if(!showUnspentOnly) {
          setInfo(translate('unspentOnlyRecoverable'))
          return
        }

        if(mintsStore.allMints.length === 0) {
          setInfo(translate('missingMintsForProofsUserMessage'))
        }
        
        setIsLoading(true)

        const groupedByMint = groupProofsByMint(proofs)
        await transactionsStore.expireAllAfterRecovery()

          for (const mint in groupedByMint) { 
            
            const proofsByMint = groupedByMint[mint]

            if(proofsByMint.length === 0) {
              continue
            }

            proofsStore.removeOnLocalRecovery(proofsByMint, false)

            const groupedByKeyset = groupProofsByKeysets(proofsByMint)

            for (const keysetId in groupedByKeyset) {
              const proofsByKeysetId = groupedByKeyset[keysetId]
              const proofsToImport: ProofV3[] = []

              for (const proof of proofsByKeysetId) {
                const { tId, unit, isPending, isSpent, updatedAt, ...proofToImport } = proof
                proofsToImport.push(proofToImport)
              }

              if(proofsToImport.length === 0) {
                continue
              }

              const amount = CashuUtils.getProofsAmount(proofsToImport)
              const unit = proofsByKeysetId[0].unit

              log.trace('[doLocalRecovery] to be recovered', {mint, keysetId, unit, amount})

              let transactionData: TransactionData[] = []              

              transactionData.push({
                status: TransactionStatus.PREPARED,
                amount,
                createdAt: new Date(),
              })

              const newTransaction = {
                type: TransactionType.RECEIVE,
                amount,
                fee: 0,
                unit: unit as MintUnit,
                data: JSON.stringify(transactionData),
                memo: 'Recovery from backup',
                mint: mint,
                status: TransactionStatus.PREPARED,
              }

              const transaction = await transactionsStore.addTransaction(newTransaction)              

              const { amountToAdd, addedAmount } = WalletUtils.addCashuProofs(
                  mint,
                  proofsToImport,
                  {
                      unit: unit as MintUnit,
                      transactionId: transaction.id,
                      isPending: false
                  }            
              )                 

              if (amountToAdd !== addedAmount) {
                  transaction.setReceivedAmount(addedAmount)                       
              }

              const balanceAfter = proofsStore.getUnitBalance(unit as MintUnit)?.unitBalance || 0
              transaction.setBalanceAfter(balanceAfter)

              // Finally, update completed transaction
              transactionData.push({
                  status: TransactionStatus.COMPLETED,
                  addedAmount,                       
                  createdAt: new Date(),
              })

              transaction.setStatus(                  
                  TransactionStatus.COMPLETED,
                  JSON.stringify(transactionData),
              )               
            }
          }

          setIsLoading(false)

      } catch (e: any) {
          handleError(e)
      }
  } */


    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    
    const headerBg = useThemeColor('header')    
    const hint = useThemeColor('textDim')    
    const headerTitle = useThemeColor('headerTitle')


    return (
      <Screen contentContainerStyle={$screen} preset="scroll">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            text="Wallet backup"
            style={{color: headerTitle}}
          />
        </View>
        <View style={$contentContainer}>
            <Card
              ContentComponent={
                <>
                {totalProofsCount > 0 && (
                    <ListItem
                      text="Ecash proofs"
                      subText={`Number of proofs: ${proofsStore.proofsCount}`}
                      RightComponent={
                        <View style={$rightContainer}>
                          {proofsStore.proofsCount > OPTIMIZE_FROM_PROOFS_COUNT && (
                            <Button
                              preset='secondary'
                              onPress={optimizeProofAmountsStart}
                              textStyle={{lineHeight: verticalScale(16), fontSize: verticalScale(14)}}
                              style={{minHeight: verticalScale(40), paddingVertical: verticalScale(spacing.tiny)}}
                              text={'Optimize'}
                            />
                          )}
                          <Switch
                              onValueChange={toggleBackupEcashSwitch}
                              value={isEcashInBackup}
                          />
                        </View>
                      }
                    />
                )}
                {mintsStore.mintCount > 0 && (
                    <ListItem
                      text="Mints"
                      subText={`Number of mints: ${mintsStore.mintCount}`}
                      RightComponent={
                        <View style={$rightContainer}>
                          <Switch
                              onValueChange={toggleBackupMintsSwitch}
                              value={isMintsInBackup}
                          />
                        </View>
                      }                       
                      topSeparator={totalProofsCount > 0 ? true : false}                      
                    />
                )}  
                {contactsStore.count > 0 && (
                    <ListItem
                      text="Contacts"
                      subText={`Number of contacts: ${contactsStore.count}`}
                      RightComponent={
                          <View style={$rightContainer}>
                          <Switch
                              onValueChange={toggleBackupContanctsSwitch}
                              value={isContactsInBackup}
                          />
                          </View>
                      }                      
                      topSeparator={mintsStore.mintCount > 0 ? true : false}                       
                    />
                )}
                </>
              }
              style={[$card]}
            />          
          <View style={$bottomContainer}>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center', 
                marginBottom: spacing.small,     
                paddingRight: spacing.medium,
                marginLeft: -spacing.medium
                
              }}
            >
              <Icon icon='faInfoCircle' containerStyle={{marginRight: spacing.extraSmall}}/>
              <Text 
                style={{color: hint}} 
                size='xs'
                preset='formHelper' 
                text='You will still need your seed phrase when using this backup to recover your wallet.'
              />
            </View>
            <View style={$buttonContainer}>              
                <Button                  
                    onPress={copyBackup}
                    text="Copy backup"
                    style={{                  
                        marginRight: spacing.small                           
                    }}                  
                />
            </View>            
          </View>        
          {isLoading && <Loading />}
          {error && <ErrorModal error={error} />}
          {info && <InfoModal message={info} />}
        </View>
        <View style={$bottomContainer}>
          {proofsStore.proofsCount > 0 && (
              <View style={$buttonContainer}>
                  <Button
                      preset="tertiary"
                      onPress={copyEncodedTokens}
                      tx="copyAsEncodedTokens"                  
                      textStyle={{fontSize: 14}}
                  />
                  {orphanedProofs.length > 0 && (
                    <Button
                        preset="tertiary"
                        onPress={copyOrphanedProofs}
                        text="Copy orphaned proofs"                  
                        textStyle={{fontSize: 14, marginLeft: spacing.small}}
                    />
                  )}
              </View>
          )}            
        </View>
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {resultModalInfo?.status === TransactionStatus.COMPLETED && (
                <>
                  <ResultModalInfo
                    icon={'faCheckCircle'}
                    iconColor={colors.palette.success200}
                    title={resultModalInfo.title || translate('common.success')}
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
              {(resultModalInfo?.status === TransactionStatus.ERROR ||
                resultModalInfo?.status === TransactionStatus.BLOCKED) && (
                <>
                  <ResultModalInfo
                    icon="faTriangleExclamation"
                    iconColor={colors.palette.focus300}
                    title={resultModalInfo?.title as string || translate('transactionCommon.receiveFailed')}
                    message={resultModalInfo?.message as string}
                  />
                  <View style={$buttonContainer}>
                    <Button
                        preset="secondary"
                        tx={'common.close'}
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
      </Screen>
    )
}

const $screen: ViewStyle = {
  flex: 1
  // borderWidth: 1,
  // borderColor: 'red'
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.20,
}

const $contentContainer: TextStyle = {
  flex: 1,  
  marginTop: -spacing.extraLarge * 2,
  padding: spacing.extraSmall,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  //paddingTop: 0,
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
}

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: 20,
}

const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}

const $rightContainer: ViewStyle = {
  padding: spacing.extraSmall,
  // alignSelf: 'center',
  marginLeft: spacing.tiny,
  marginRight: -10,
  flexDirection: 'row'
}

const $bottomContainer: ViewStyle = { 
  marginHorizontal: spacing.medium,  
}