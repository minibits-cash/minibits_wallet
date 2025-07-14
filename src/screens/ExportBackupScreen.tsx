import React, {FC, useState, useEffect} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  Switch,
  Alert,
  Platform,
  ScrollView,
} from 'react-native'
import {btoa} from 'react-native-quick-base64'
import notifee, { AndroidImportance } from '@notifee/react-native'
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
  Header,
} from '../components'
import {useHeader} from '../utils/useHeader'
import {log} from '../services/logService'
import AppError from '../utils/AppError'
import { Proof } from '../models/Proof'
import { useStores } from '../models'
import EventEmitter from '../utils/eventEmitter'
import { CashuProof, CashuUtils } from '../services/cashu/cashuUtils'
import Clipboard from '@react-native-clipboard/clipboard'
import { translate } from '../i18n'
import { ProofsStoreSnapshot } from '../models/ProofsStore'
import { getSnapshot } from 'mobx-state-tree'
import { ContactsStoreSnapshot } from '../models/ContactsStore'
import { MintsStoreSnapshot } from '../models/MintsStore'
import { NotificationService, SWAP_ALL_TASK, TASK_QUEUE_CHANNEL_ID, TASK_QUEUE_CHANNEL_NAME, WalletTask, WalletTaskResult } from '../services'
import { TransactionStatus } from '../models/Transaction'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { verticalScale } from '@gocodingnow/rn-size-matters'
import { Token, getDecodedToken, getEncodedToken } from '@cashu/cashu-ts'
import { minibitsPngIcon } from '../components/MinibitsIcon'
import { StaticScreenProps, useNavigation } from '@react-navigation/native'

const OPTIMIZE_FROM_PROOFS_COUNT = 4
type Props = StaticScreenProps<undefined>

export const ExportBackupScreen = function ExportBackup({ route }: Props) {
  const navigation = useNavigation()
  const { 
      mintsStore, 
      contactsStore, 
      proofsStore 
  } = useStores()

  /* useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
  }) */

  const [info, setInfo] = useState('')
  const [error, setError] = useState<AppError | undefined>()
  const [orphanedProofs, setOrphanedProofs] = useState<Proof[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSwapAllSentToQueue, setIsSwapAllSentToQueue] = useState<boolean>(false)
  const [totalProofsCount, setTotalProofsCount] = useState<number>(0)
  const [isEcashInBackup, setIsEcashInBackup] = useState(true)
  const [isMintsInBackup, setIsMintsInBackup] = useState(true)
  const [isContactsInBackup, setIsContactsInBackup] = useState(true)
  const [isResultModalVisible, setIsResultModalVisible] = useState(false)
  const [isNotificationModalVisible, setIsNotificationModalVisible] = useState(false) 
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
    // runs for every receive in a batch
    const handleSwapAllTaskResult = async (result: WalletTaskResult) => {
      if(!isSwapAllSentToQueue) {
        return
      }

      setIsLoading(false)
      setResultModalInfo({
        status: result.errors.length > 0 ? TransactionStatus.ERROR : TransactionStatus.COMPLETED,
        message: result.message
      })

      if(result.finalProofsCount && result.finalProofsCount > 0) {
        setTotalProofsCount(result.finalProofsCount)
      }
      
      setIsResultModalVisible(true)
    }
    
    if(isSwapAllSentToQueue) {
      EventEmitter.on(`ev_${SWAP_ALL_TASK}_result`, handleSwapAllTaskResult)      
    }

    return () => {
      EventEmitter.off(`ev_${SWAP_ALL_TASK}_result`, handleSwapAllTaskResult)               
    }

  }, [isSwapAllSentToQueue])


  const openNotificationSettings = async function() {
    await notifee.openNotificationSettings()        
  }
  
  const toggleResultModal = () => {
      setIsResultModalVisible(previousState => !previousState)
      WalletTask.syncStateWithAllMintsQueue({isPending: true})
  }     
  
  const toggleNotificationModal = () =>
    setIsNotificationModalVisible(previousState => !previousState)


  const toggleBackupEcashSwitch = () =>
      setIsEcashInBackup(previousState => !previousState)

  
  const toggleBackupMintsSwitch = () =>
      setIsMintsInBackup(previousState => !previousState)

  
  const toggleBackupContanctsSwitch = () =>
      setIsContactsInBackup(previousState => !previousState)


  const optimizeProofAmountsStart = async function () {
    const enabled = await NotificationService.areNotificationsEnabled()

    if(!enabled) {
      toggleNotificationModal()
      return
    }

    Alert.alert(
      'Optimize ecash proofs',
      'Do you want to swap your wallet ecash for proofs with optimal denominations? The size of your backup will decrease.',
      [
        {
          text: translate('commonCancel'),
          style: 'cancel',
          onPress: () => { /* Action canceled */ },
        },
        {
          text: translate('commonConfirm'),
          onPress: async () => {
            // Moves all wallet proofs to pending in transactions 
            // split by mints and by units and in offline mode.
            // Supports batching in case proofs count is above limit.
            
            setIsLoading(true)
            setIsSwapAllSentToQueue(true)             

            if(Platform.OS === 'android') {
              await NotificationService.createForegroundNotification(
                'Optimizing ecash proofs denominations...',
                {task: SWAP_ALL_TASK}
              )
            } else {
              // iOS does not support fg notifications with long running tasks
              WalletTask.swapAllQueue()
            } 
          }
        }
      ]
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
            exportedMintsStore = JSON.parse(JSON.stringify(getSnapshot(mintsStore)))

            exportedMintsStore.mints.forEach((mint: any) => {
              mint.keys = [];                
            })

            //log.trace({exportedMintsStore})
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
          
          const prefix = 'minibits'
          const version = 'A'

          // CBOR - WIP, not working
          // const encodedData = encodeCBOR(exportedSnapshot)
          // const base64Data = encodeUint8toBase64Url(encodedData)

          // Simple BASE64
          const base64Data = btoa(JSON.stringify(exportedSnapshot))
          
          const base64Encoded = prefix + version + base64Data

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
              const proofsToExport: CashuProof[] = []

              for (const p of proofsByKeysetId) {
                // clean private params
                const proofToExport: CashuProof = {
                  id: p.id,
                  amount: p.amount,
                  secret: p.secret,
                  C: p.C
                }

                proofsToExport.push(proofToExport)
              }

              const tokenByKeysetId: Token = {
                mint,
                proofs: proofsToExport,
                unit: proofsByKeysetId[0].unit
              }
              
              log.trace('[copyEncodedTokens]', {tokenByKeysetId})

              const encodedByMint = getEncodedToken(tokenByKeysetId)
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

  const handleError = function (e: AppError): void {
    setIsLoading(false)
    setError(e)
  }

  
  const headerBg = useThemeColor('header')    
  const hint = useThemeColor('textDim')    
  const headerTitle = useThemeColor('headerTitle')


  return (
    <Screen contentContainerStyle={$screen} preset="fixed">
      <Header            
          leftIcon='faArrowLeft'
          onLeftPress={() => navigation.goBack()}            
      />
      <View style={[$headerContainer, {backgroundColor: headerBg}]}>
        <Text
          preset="heading"
          tx="exportBackupWalletTitle"
          style={{color: headerTitle}}
        />
      </View>
      <ScrollView style={$contentContainer}>
          <Card
            ContentComponent={
              <>
              {totalProofsCount > 0 && (
                  <ListItem
                    tx="exportBackupEcashProofs"
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
                    tx="exportBackupMints"
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
                    tx="contacts"
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
                  tx="exportBackupCopyBackup"
                  style={{                  
                      marginRight: spacing.small                           
                  }}                  
              />
          </View>            
        </View>
      </ScrollView>
      {isLoading && <Loading />}
      {error && <ErrorModal error={error} />}
      {info && <InfoModal message={info} />}
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
                      tx="exportBackupCopyOrphanedProofs"                  
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
                  title={resultModalInfo.title || translate('commonSuccess')}
                  message={resultModalInfo?.message}
                />
                <View style={$buttonContainer}>
                  <Button
                    preset="secondary"
                    tx='commonClose'
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
                  title={resultModalInfo?.title as string || translate('transactionCommon_receiveFailed')}
                  message={resultModalInfo?.message as string}
                />
                <View style={$buttonContainer}>
                  <Button
                      preset="secondary"
                      tx={'commonClose'}
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
      <BottomModal
        isVisible={isNotificationModalVisible ? true : false}          
        ContentComponent={
          <>
            <ResultModalInfo
                  icon="faTriangleExclamation"
                  iconColor={colors.palette.accent300}
                  title={"Permission needed"}
                  message={"Minibits needs a permission to display notification while this task will be running."}
                />
                <View style={$buttonContainer}>
                  <Button
                      preset="secondary"
                      text={'Open settings'}
                      onPress={openNotificationSettings}
                  />                      
                </View>
          </>
        }
        onBackButtonPress={toggleNotificationModal}
        onBackdropPress={toggleNotificationModal}
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
  height: spacing.screenHeight * 0.15,
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
