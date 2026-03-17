import React, {FC, useState, useEffect} from 'react'
import {
  TextStyle,
  ViewStyle,
  View,
  Switch,
  ScrollView,
  Share,
} from 'react-native'
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
import { CashuProof, CashuUtils } from '../services/cashu/cashuUtils'
import Clipboard from '@react-native-clipboard/clipboard'
import { translate } from '../i18n'
import { ProofsStoreSnapshot } from '../models/ProofsStore'
import { getSnapshot } from 'mobx-state-tree'
import { ContactsStoreSnapshot } from '../models/ContactsStore'
import { MintsStoreSnapshot } from '../models/MintsStore'
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
  const [totalProofsCount, setTotalProofsCount] = useState<number>(0)
  const [isEcashInBackup, setIsEcashInBackup] = useState(true)
  const [isMintsInBackup, setIsMintsInBackup] = useState(true)
  const [isContactsInBackup, setIsContactsInBackup] = useState(true)
  const [isNotificationModalVisible, setIsNotificationModalVisible] = useState(false)
  
  
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



  const openNotificationSettings = async function() {
    await notifee.openNotificationSettings()
  }
  
  const toggleNotificationModal = () =>
    setIsNotificationModalVisible(previousState => !previousState)

  const toggleBackupEcashSwitch = () =>
      setIsEcashInBackup(previousState => !previousState)

  const toggleBackupMintsSwitch = () =>
      setIsMintsInBackup(previousState => !previousState)

  const toggleBackupContanctsSwitch = () =>
      setIsContactsInBackup(previousState => !previousState)


  const copyBackup = async function () {
      try {     
          setIsLoading(true)  

          let exportedProofsStore: ProofsStoreSnapshot = {
              proofs: [],               
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
              lastPendingReceivedCheck: undefined
          }            

          if(isEcashInBackup) {
            // proofsStore is emptied in snapshot postprocess!
            const proofsSnapshot = Array.from(proofsStore.proofs.values())

            exportedProofsStore = {
              proofs: proofsSnapshot,
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

          await Share.share({
            title: 'minibits-backup.txt',
            message: base64Encoded,
          })
          setIsLoading(false)

      } catch (e: any) {
          setInfo(`Could not encode and export wallet backup: ${e.message}`)
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

          const groupedByMint = groupProofsByMint(Array.from(proofsStore.proofs.values()))

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
                            onPress={() => navigation.navigate('OptimizeEcash')}
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
